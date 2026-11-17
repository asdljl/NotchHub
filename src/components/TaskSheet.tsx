import { lazy, Suspense, useEffect, useState } from "react";
import { Bell, CalendarDays, Clock, FolderKanban, Pencil } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// react-day-picker + date-fns only matter once a calendar is expanded; keep
// them out of the island's startup bundle.
const Calendar = lazy(() =>
  import("@/components/ui/calendar").then((module) => ({
    default: module.Calendar,
  })),
);
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DUE_MARKER,
  type Project,
  type Reminder,
  type ReminderKind,
  type Todo,
} from "../hooks/useTodos";
import {
  DEFAULT_DUE_TIME,
  dateKey,
  dueClock,
  dueDay,
  normalizeDue,
  todayKey,
  tomorrowKey,
} from "../lib/dates";

/** Radix Select forbids an empty string as an item value. */
const STANDALONE_VALUE = "__standalone__";
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const TIME_KEY = /^\d{2}:\d{2}$/;
const CLOCK_KEY = /^\d{2}:\d{2}:\d{2}$/;

type ReminderChoice = "none" | ReminderKind;

function dayToDate(value: string): Date | undefined {
  const match = DAY_KEY.exec(value);
  if (!match) return undefined;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function dayLabel(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  const now = new Date();
  return year === now.getFullYear()
    ? `${month} 月 ${day} 日`
    : `${year} 年 ${month} 月 ${day} 日`;
}

/** A time input with `step=1` may emit "HH:mm" or "HH:mm:ss". */
function normalizeClock(value: string): string {
  return TIME_KEY.test(value) ? `${value}:00` : value;
}

/** Default one-off reminder: tomorrow at 09:00, split into day + time. */
function initialOnce(existing: Reminder | null): { date: string; time: string } {
  if (existing?.kind === "once") {
    const [date, time] = existing.value.split("T");
    if (date && DAY_KEY.test(date)) {
      return { date, time: time?.slice(0, 5) || "09:00" };
    }
  }
  const next = new Date();
  next.setDate(next.getDate() + 1);
  return { date: dateKey(next), time: "09:00" };
}

/** Upgrade a legacy day-only plan so the editor always shows a full clock. */
function initialDueDate(value: string | null): string {
  const normalized = normalizeDue(value);
  if (!normalized) return "";
  return dueClock(normalized) ? normalized : `${normalized}T${DEFAULT_DUE_TIME}`;
}

export type TaskPatch = {
  text: string;
  dueDate: string | null;
  projectId: string | null;
  reminder: Reminder | null;
};

type TaskSheetProps = {
  todo: Todo;
  projects: Project[];
  onClose: () => void;
  onSave: (patch: TaskPatch) => void;
};

/**
 * Full editor for an existing sub-todo: its text, owning project, planned
 * completion moment and reminder. The plan is day + HH:mm:ss, while reminders
 * can be a daily clock, a fixed moment, or simply "when the plan is due".
 *
 * Dates use shadcn's Calendar instead of the native `input[type=date]`:
 * the island is a small always-on-top window, and native pickers open a
 * separate OS popup that is clipped by the transparent WebView. The calendar
 * is expanded inline inside the scroll region so it never leaves the lens.
 * The action bar lives outside that scroll region — pinning it *inside* a
 * scrolling overlay would cover the last hint or the last calendar row.
 */
export function TaskSheet({ todo, projects, onClose, onSave }: TaskSheetProps) {
  const existing = todo.reminder;

  const [text, setText] = useState(todo.text);
  const [dueDate, setDueDate] = useState(() => initialDueDate(todo.dueDate));
  const [projectId, setProjectId] = useState(
    todo.projectId || STANDALONE_VALUE,
  );
  const [kind, setKind] = useState<ReminderChoice>(existing?.kind ?? "none");
  const [daily, setDaily] = useState(
    existing?.kind === "daily" ? existing.value : "09:00",
  );
  const [once, setOnce] = useState(() => initialOnce(existing));
  const [calendarFor, setCalendarFor] = useState<"due" | "once" | null>(null);

  // Radix's dismissable layer handles Escape on `document`, before React's
  // bubbling handler on DialogContent can run — it would close the whole
  // dialog instead of just the calendar. Intercept at window capture while a
  // calendar is expanded, and let the normal path handle the next Escape.
  useEffect(() => {
    if (!calendarFor) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setCalendarFor(null);
    };
    window.addEventListener("keydown", onEscape, true);
    return () => window.removeEventListener("keydown", onEscape, true);
  }, [calendarFor]);

  // Keep the two halves of the plan in one string so a single save cannot tear.
  const planDay = dueDay(dueDate) ?? "";
  const planClock = dueClock(dueDate) ?? DEFAULT_DUE_TIME;

  const setPlanDay = (day: string) =>
    setDueDate(day ? `${day}T${planClock}` : "");
  const setPlanClock = (clock: string) => {
    if (!planDay) return;
    setDueDate(`${planDay}T${normalizeClock(clock)}`);
  };

  const canSave =
    Boolean(text.trim()) &&
    (!dueDate || CLOCK_KEY.test(dueDate.slice(11))) &&
    (kind !== "daily" || TIME_KEY.test(daily)) &&
    (kind !== "once" || (DAY_KEY.test(once.date) && TIME_KEY.test(once.time))) &&
    (kind !== "due" || Boolean(planDay));

  const save = () => {
    if (!canSave) return;
    let reminder: Reminder | null = null;
    if (kind === "daily") {
      reminder = { kind: "daily", value: daily };
    } else if (kind === "once") {
      reminder = { kind: "once", value: `${once.date}T${once.time}` };
    } else if (kind === "due") {
      // No independent timestamp: the live `dueDate` is the schedule.
      reminder = { kind: "due", value: DUE_MARKER };
    }
    onSave({
      text: text.trim().slice(0, 200),
      dueDate: normalizeDue(dueDate),
      projectId: projectId === STANDALONE_VALUE ? null : projectId || null,
      reminder,
    });
  };

  const dueBadge =
    planDay === todayKey()
      ? "今天"
      : planDay === tomorrowKey()
        ? "明天"
        : planDay
          ? "已排期"
          : "未设置";

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        className="sheet--task max-h-[calc(100%-24px)] gap-0 overflow-hidden"
        showCloseButton
        onOpenAutoFocus={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            // Escape belongs to the editor, not to the shell's global
            // "collapse the island" shortcut. Close the calendar first.
            event.stopPropagation();
            if (calendarFor) setCalendarFor(null);
            else onClose();
          }
        }}
      >
        <div className="task-sheet__scroll flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          <DialogHeader>
            <DialogTitle>编辑任务</DialogTitle>
            <DialogDescription>
              修改名称、所属项目、计划完成日（含时分秒）与提醒
            </DialogDescription>
          </DialogHeader>

          <Separator />

          <div className="task-sheet__name flex items-center gap-2">
            <Label htmlFor="task-name" className="shrink-0 gap-1.5 text-foreground/80">
              <Pencil className="size-3 text-primary" />
              名称
            </Label>
            <Input
              id="task-name"
              className="sheet__input h-8 min-w-0 flex-1"
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                // Enter belongs to the IME candidate window while composing.
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  save();
                }
              }}
              placeholder="子待办名称"
              maxLength={200}
              spellCheck={false}
            />
          </div>

          <div className="flex items-center justify-between">
            <Label className="gap-1.5 text-foreground/80">
              <CalendarDays className="size-3 text-primary" />
              计划完成日
            </Label>
            <Badge variant={planDay ? "default" : "ghost"}>{dueBadge}</Badge>
          </div>
          <div className="task-sheet__chips flex items-center gap-1.5">
            <Button
              variant={planDay === todayKey() ? "default" : "secondary"}
              size="xs"
              onClick={() => setPlanDay(todayKey())}
            >
              今天
            </Button>
            <Button
              variant={planDay === tomorrowKey() ? "default" : "secondary"}
              size="xs"
              onClick={() => setPlanDay(tomorrowKey())}
            >
              明天
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setPlanDay("")}
              disabled={!planDay}
            >
              清除
            </Button>
            <DateTrigger
              value={planDay}
              label="选择日期"
              expanded={calendarFor === "due"}
              ariaLabel="计划完成日"
              onToggle={() =>
                setCalendarFor(calendarFor === "due" ? null : "due")
              }
            />
          </div>
          <div className="task-sheet__clock flex items-center gap-2">
            <Label className="flex w-[62px] shrink-0 items-center gap-1 text-[10px] text-foreground/70">
              <Clock className="size-3 text-primary" />
              完成时刻
            </Label>
            <Input
              className="sheet__input task-sheet__time h-8 w-[116px] [color-scheme:dark]"
              type="time"
              step="1"
              value={planClock}
              disabled={!planDay}
              onChange={(event) => setPlanClock(event.target.value)}
              aria-label="计划完成时刻（时:分:秒）"
            />
            <span className="sheet__hint flex-1">时 : 分 : 秒</span>
          </div>
          {calendarFor === "due" && (
            <InlineCalendar value={planDay} onPick={setPlanDay} />
          )}
          <p className="sheet__hint">
            精确到秒；未设置时按定时提醒的日期归入今天 / 明天。
          </p>

          <Label className="gap-1.5 text-foreground/80">
            <FolderKanban className="size-3 text-success" />
            所属项目
          </Label>
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger className="task-sheet__select h-8" aria-label="所属项目">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={STANDALONE_VALUE}>独立待办</SelectItem>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Label className="gap-1.5 text-foreground/80">
            <Bell className="size-3 text-warning" />
            提醒
          </Label>
          <Tabs
            value={kind}
            onValueChange={(next) => {
              setKind(next as ReminderChoice);
              setCalendarFor(null);
            }}
          >
            <TabsList className="seg task-sheet__seg w-full">
              <TabsTrigger value="none" className="px-1 text-[10px]">
                无
              </TabsTrigger>
              <TabsTrigger value="daily" className="px-1 text-[10px]">
                每日
              </TabsTrigger>
              <TabsTrigger value="once" className="px-1 text-[10px]">
                定时
              </TabsTrigger>
              <TabsTrigger value="due" className="px-1 text-[10px]">
                计划完成时
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="task-sheet__body min-h-8">
            {kind === "daily" ? (
              <Input
                className="sheet__input h-8 [color-scheme:dark]"
                type="time"
                value={daily}
                onChange={(event) => setDaily(event.target.value)}
                aria-label="每日提醒时间"
              />
            ) : kind === "once" ? (
              <>
                <div className="task-sheet__once flex items-center gap-1.5">
                  <DateTrigger
                    value={once.date}
                    label="选择日期"
                    expanded={calendarFor === "once"}
                    ariaLabel="定时提醒日期"
                    onToggle={() =>
                      setCalendarFor(calendarFor === "once" ? null : "once")
                    }
                  />
                  <Input
                    className="sheet__input task-sheet__time h-8 w-[92px] shrink-0 [color-scheme:dark]"
                    type="time"
                    value={once.time}
                    onChange={(event) =>
                      setOnce((prev) => ({ ...prev, time: event.target.value }))
                    }
                    aria-label="定时提醒时间"
                  />
                </div>
                {calendarFor === "once" && (
                  <InlineCalendar
                    value={once.date}
                    onPick={(value) => {
                      setOnce((prev) => ({ ...prev, date: value }));
                      setCalendarFor(null);
                    }}
                  />
                )}
              </>
            ) : kind === "due" ? (
              <p className="sheet__hint text-foreground/70">
                {planDay ? (
                  <>
                    到 {dayLabel(planDay)} {planClock} 提醒，改时间会重新计时。
                  </>
                ) : (
                  <span className="text-warning">
                    请先设置计划完成日，才能使用「计划完成时」提醒。
                  </span>
                )}
              </p>
            ) : (
              <p className="sheet__hint">
                不提醒。设了计划日期的任务仍会出现在今天 / 明天视图里。
              </p>
            )}
          </div>
        </div>

        <DialogFooter className="sheet__actions shrink-0 pt-3">
          <Button variant="secondary" size="sm" className="flex-1" onClick={onClose}>
            取消
          </Button>
          <Button size="sm" className="flex-1" onClick={save} disabled={!canSave}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Button that expands the shadcn Calendar in place. */
function DateTrigger({
  value,
  label,
  expanded,
  ariaLabel,
  onToggle,
}: {
  value: string;
  label: string;
  expanded: boolean;
  ariaLabel: string;
  onToggle: () => void;
}) {
  return (
    <Button
      variant={expanded ? "default" : "outline"}
      size="sm"
      className="task-sheet__date-trigger h-7 min-w-0 flex-1 justify-start gap-1 px-2 text-[10px]"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-label={ariaLabel}
    >
      <CalendarDays className="size-3 shrink-0" />
      <span className="truncate">{value ? dayLabel(value) : label}</span>
    </Button>
  );
}

function InlineCalendar({
  value,
  onPick,
}: {
  value: string;
  onPick: (value: string) => void;
}) {
  const selected = dayToDate(value);
  return (
    <div className="task-sheet__calendar flex justify-center">
      <Suspense
        fallback={
          <span className="py-6 text-[10px] text-muted-foreground">加载日历…</span>
        }
      >
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected ?? new Date()}
          onSelect={(day) => {
            if (day) onPick(dateKey(day));
          }}
        />
      </Suspense>
    </div>
  );
}
