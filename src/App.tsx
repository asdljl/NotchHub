import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Capsule } from "./components/Capsule";
import { Dot } from "./components/Dot";
import { SettingsView } from "./components/SettingsView";
import { TimerView } from "./components/TimerView";
import { TodoView } from "./components/TodoView";
import { ListTodo, Settings, Timer, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DOT_SIZE, useSettings } from "./hooks/useSettings";
import { useTimers } from "./hooks/useTimers";
import { useTodos, type Todo } from "./hooks/useTodos";
import { notify, warmUpNotifications } from "./lib/notify";
import { describeDuration } from "./lib/format";
import { playChime, warmUpAudio } from "./lib/sound";
import {
  isTauri,
  onNotchClose,
  onNotchOpen,
  onUpdateCheckRequest,
  requestExpanded,
  setDotMode,
  setGeometry,
  setTriggerMode,
} from "./lib/tauri";
import { checkForUpdate, initUpdater, useUpdater } from "./lib/updater";

const TABS = [
  { id: "timer", label: "计时器", Icon: Timer },
  { id: "todo", label: "待办", Icon: ListTodo },
  { id: "settings", label: "设置", Icon: Settings },
] as const;

type TabId = (typeof TABS)[number]["id"];

const TAB_WIDTH = 62;

/**
 * A quiet dot on the 设置 tab is the only in-app hint that a release is
 * waiting — subscribing here keeps the rest of the tree out of the update
 * store's render path.
 */
function UpdateDot() {
  const { phase } = useUpdater();
  if (phase !== "available") return null;
  return <span className="tab__dot" aria-label="有新版本" />;
}

/**
 * A completed timer is an *event*, not a persistent state. The collapsed
 * island answers it briefly, then hands the dot back to whatever is still
 * running. The finished rows themselves stay in the list until cleared.
 */
const FINISH_NOTICE_MS = 8_000;

export default function App() {
  // In a plain browser (vite dev without the Tauri shell) start expanded so the
  // UI can be inspected without the native hover trigger.
  const [open, setOpen] = useState(() => !isTauri());
  const [tab, setTab] = useState<TabId>("timer");
  const [clock, setClock] = useState(() => new Date());

  const settingsApi = useSettings();
  const { settings } = settingsApi;

  // Todos whose reminder just fired while the island was collapsed. They drive
  // the ringing bell on the capsule until the user opens the panel.
  const [ringing, setRinging] = useState<Todo[]>([]);

  // In-memory on purpose: a reload must never resurrect an old "done" dot.
  const [finished, setFinished] = useState<
    Array<{ id: string; title: string; at: number }>
  >([]);

  // Brief cross-fade while the collapsed shape morphs between dot and notch.
  const [morphing, setMorphing] = useState(false);

  const openRef = useRef(open);
  openRef.current = open;

  const timers = useTimers((timer) => {
    playChime();
    void notify(
      timer.title.trim() || "计时器结束",
      `${describeDuration(timer.durationMs)}的计时已经结束`,
    );
    setTab("timer");
    // If the panel is already open the finished row is visible, so there is
    // nothing to announce on the collapsed dot once the user closes it.
    if (!openRef.current) {
      const notice = {
        id: timer.id,
        title: timer.title.trim(),
        at: Date.now(),
      };
      setFinished((prev) =>
        prev.some((item) => item.id === notice.id) ? prev : [...prev, notice],
      );
    }
  });

  const todos = useTodos((todo) => {
    playChime();
    void notify("待办提醒", todo.text);
    setTab("todo");
    // Already looking at the panel? The list highlight and the toast are enough.
    if (!openRef.current) {
      setRinging((prev) =>
        prev.some((item) => item.id === todo.id) ? prev : [...prev, todo],
      );
    }
  });

  /**
   * Collapsed shape follows the work in progress:
   *   - a running countdown OR an unfinished todo -> full notch (capsule)
   *   - neither -> the quiet dot
   * Completion notices and ringing reminders are one-off events, not ongoing
   * work: once they fire, the shape is free to return to the dot. Paused
   * timers are deliberately excluded — they are not "running".
   * Turning the dot-mode switch off still forces the notch at all times.
   */
  const hasActivity = timers.runningCount > 0 || todos.activeCount > 0;
  const showDot = settings.dotMode && !hasActivity;

  // Only the shape change gets a cross-fade; the existing open/close animation
  // keeps its own timing and is not affected.
  const prevShape = useRef(showDot);
  // Layout effect, not a passive one: the flag must land in the same paint as
  // the new component, otherwise the content shows at full opacity for one
  // frame before the fade-in starts.
  useLayoutEffect(() => {
    if (prevShape.current === showDot) return;
    prevShape.current = showDot;
    setMorphing(true);
    const id = window.setTimeout(() => setMorphing(false), 300);
    return () => window.clearTimeout(id);
  }, [showDot]);

  // Drop reminders that were completed or deleted in the meantime.
  const activeRinging = useMemo(
    () =>
      ringing.filter((item) =>
        todos.todos.some((todo) => todo.id === item.id && !todo.done),
      ),
    [ringing, todos.todos],
  );

  // Opening the panel counts as "seen" — but keep the todo highlight for a few
  // seconds so the user can tell which of several items actually rang. A finish
  // notice is acknowledged immediately.
  useEffect(() => {
    if (!open) return;
    setFinished([]);
    const id = window.setTimeout(() => setRinging([]), 4000);
    return () => window.clearTimeout(id);
  }, [open]);

  // Completion notices retire on their own. One timer handles the whole batch;
  // filtering by timestamp keeps a newer completion alive when an older one
  // expires, and also copes with a machine that slept through the timeout.
  useEffect(() => {
    if (finished.length === 0) return;
    const oldest = Math.min(...finished.map((item) => item.at));
    const delay = Math.max(0, oldest + FINISH_NOTICE_MS - Date.now());
    const id = window.setTimeout(() => {
      const now = Date.now();
      setFinished((prev) =>
        prev.filter((item) => item.at + FINISH_NOTICE_MS > now),
      );
    }, delay + 40);
    return () => window.clearTimeout(id);
  }, [finished]);

  // Native open/close events come from the Rust cursor watcher.
  useEffect(() => {
    let disposed = false;
    const unsubscribers: Array<() => void> = [];

    const attach = (promise: Promise<() => void>) => {
      void promise.then((unlisten) => {
        if (disposed) unlisten();
        else unsubscribers.push(unlisten);
      });
    };

    attach(onNotchOpen(() => setOpen(true)));
    attach(onNotchClose(() => setOpen(false)));
    // Tray → "检查更新": open the panel on the settings tab and run the check
    // so the result lands where the user can see it.
    attach(
      onUpdateCheckRequest(() => {
        setOpen(true);
        setTab("settings");
        void requestExpanded(true);
        void checkForUpdate();
      }),
    );

    return () => {
      disposed = true;
      unsubscribers.forEach((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setClock(new Date()), 1_000);
    return () => window.clearInterval(id);
  }, []);

  // Wires the download-progress listener and schedules one silent check.
  useEffect(() => {
    initUpdater();
  }, []);

  useEffect(() => {
    const preventMenu = (event: MouseEvent) => event.preventDefault();
    window.addEventListener("contextmenu", preventMenu);
    return () => window.removeEventListener("contextmenu", preventMenu);
  }, []);

  // Audio + notification permissions need a real user gesture to unlock.
  useEffect(() => {
    const unlock = () => {
      warmUpAudio();
      void warmUpNotifications();
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  // Debounced so typing in a size field does not resize the native window on
  // every keystroke.
  useEffect(() => {
    const id = window.setTimeout(() => {
      void setGeometry(
        settings.panelWidth,
        settings.panelHeight,
        settings.capsuleWidth,
        settings.capsuleHeight,
      );
    }, 120);
    return () => window.clearTimeout(id);
  }, [
    settings.panelWidth,
    settings.panelHeight,
    settings.capsuleWidth,
    settings.capsuleHeight,
  ]);

  // The native watcher owns the collapsed state, so it needs to know how the
  // island should respond to the pointer.
  useEffect(() => {
    void setTriggerMode(settings.trigger);
  }, [settings.trigger]);

  // The native watcher must receive the *effective* shape, not the raw
  // preference: when activity turns the dot into a notch, the whole capsule
  // width has to become hoverable/clickable again.
  useEffect(() => {
    void setDotMode(showDot);
  }, [showDot]);

  const collapse = useCallback(() => {
    setOpen(false);
    void requestExpanded(false);
  }, []);

  const expand = useCallback(() => {
    setOpen(true);
    void requestExpanded(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Escape belongs to whichever editor is open: an inline rename or a
      // task dialog. Closing those must not also collapse the island. Radix
      // may unmount the dialog before this window listener runs, so check the
      // event target as well as the live DOM.
      const target = event.target;
      const inEditor =
        target instanceof Element &&
        Boolean(
          target.closest(
            "[data-slot='dialog-content'], [role='dialog'], .item__edit",
          ),
        );
      if (
        inEditor ||
        document.querySelector("[data-slot='dialog-content'], .item__edit")
      ) {
        return;
      }
      collapse();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, collapse]);

  const activeTabIndex = TABS.findIndex((item) => item.id === tab);

  const reminder =
    activeRinging.length > 0
      ? {
          text: activeRinging[activeRinging.length - 1].text,
          count: activeRinging.length,
        }
      : null;

  // The newest completion supplies the title; count also covers a batch that
  // finished in the same tick (or within the notice window).
  const finishNotice = useMemo(() => {
    const latest = finished[finished.length - 1];
    if (!latest) return null;
    return {
      id: latest.id,
      title: latest.title || "计时结束",
      count: finished.length,
    };
  }, [finished]);

  const ringingIds = useMemo(
    () => activeRinging.map((item) => item.id),
    [activeRinging],
  );

  const islandStyle = {
    "--island-alpha": String(settings.opacity),
    "--panel-w": `${settings.panelWidth}px`,
    "--panel-h": `${settings.panelHeight}px`,
    "--capsule-w": `${settings.capsuleWidth}px`,
    "--capsule-h": `${settings.capsuleHeight}px`,
    "--dot-size": `${DOT_SIZE}px`,
  } as CSSProperties;

  return (
    <div className="stage">
      <div
        className="island"
        data-open={open}
        data-dot={showDot}
        data-morphing={morphing}
        style={islandStyle}
      >
        {showDot ? (
          <Dot
            timers={timers}
            reminder={reminder}
            finish={finishNotice}
            activeCount={todos.activeCount}
            onActivate={expand}
          />
        ) : (
          <Capsule
            timers={timers}
            reminder={reminder}
            finish={finishNotice}
            activeCount={todos.activeCount}
            clock={clock}
            onActivate={expand}
          />
        )}

        <div className="panel" id="notch-panel">
          <div className="panel__header">
            <div className="tabs">
              <div
                className="tabs__thumb"
                style={{ transform: `translateX(${activeTabIndex * TAB_WIDTH}px)` }}
              />
              {TABS.map((item) => (
                <Button
                  key={item.id}
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "tab h-[26px] w-[62px] gap-1 rounded-md px-0 text-[11px] hover:bg-white/8",
                    tab === item.id
                      ? "text-foreground hover:bg-transparent"
                      : "text-muted-foreground",
                  )}
                  data-active={tab === item.id}
                  onClick={() => setTab(item.id)}
                >
                  <item.Icon className="size-3" strokeWidth={2} />
                  <span>{item.label}</span>
                  {item.id === "settings" && <UpdateDot />}
                  {item.id === "todo" && todos.activeCount > 0 && (
                    <Badge
                      variant="success"
                      className="tab__count min-w-[13px] justify-center rounded-[5px] border-0 px-1 text-[8.5px]"
                    >
                      {todos.activeCount}
                    </Badge>
                  )}
                </Button>
              ))}
            </div>

            <Button
              variant="ghost"
              size="icon-sm"
              className="panel__close size-[22px]"
              onClick={collapse}
              aria-label="收起"
            >
              <X className="size-3" />
            </Button>
          </div>

          <div className="panel__body">
            <div className="panel__view" key={tab}>
              {tab === "timer" ? (
                <TimerView timers={timers} />
              ) : tab === "todo" ? (
                <TodoView todos={todos} ringingIds={ringingIds} />
              ) : (
                <SettingsView settings={settingsApi} />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
