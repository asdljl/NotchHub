import { formatClock, formatCompact } from "../lib/format";
import type { TimersApi } from "../hooks/useTimers";

export type CapsuleReminder = { text: string; count: number } | null;

/** A short-lived completion notice, never derived from persisted done rows. */
export type CapsuleFinish = { id: string; title: string; count: number } | null;

type Activity = "timer" | "todo" | "both" | "idle";

type CapsuleProps = {
  timers: TimersApi;
  reminder: CapsuleReminder;
  finish: CapsuleFinish;
  activeCount: number;
  clock: Date;
  onActivate: () => void;
};

/**
 * The notch (collapsed capsule). Its display rules, in priority order:
 *
 *   reminder (a todo just rang) > finish (a timer just ended, 8s)
 *   > running timer > clock
 *
 * When a timer AND unfinished todos coexist the primary slot always belongs
 * to the timer (it is the time-critical one): progress ring + remaining time.
 * Todos are reported by the green badge, and extra running timers by the blue
 * one — the same blue/green vocabulary the dot uses. `data-activity` records
 * which combination is on screen so the rule is observable and styleable.
 */
export function Capsule({
  timers,
  reminder,
  finish,
  activeCount,
  clock,
  onActivate,
}: CapsuleProps) {
  const next = timers.nextTimer;
  const running = timers.runningCount;

  const activity: Activity =
    running > 0 && activeCount > 0
      ? "both"
      : running > 0
        ? "timer"
        : activeCount > 0
          ? "todo"
          : "idle";

  // A todo reminder outranks everything else: something is asking for you.
  if (reminder) {
    return (
      <div
        className="capsule"
        data-mode="reminder"
        data-activity={activity}
        onClick={onActivate}
        role="button"
        tabIndex={-1}
        aria-label={`待办提醒：${reminder.text}，展开 NotchHub`}
      >
        <BellMark />
        <span className="capsule__event-title" title={reminder.text}>
          {reminder.text}
        </span>
        {reminder.count > 1 ? (
          <span className="capsule__badge" data-visible="true" data-tone="warn">
            {reminder.count}
          </span>
        ) : null}
      </div>
    );
  }

  // A fresh completion. The notice expires by itself; the finished rows stay
  // in the timer list, so reopening the panel always shows the full history.
  if (finish) {
    const badgeCount = finish.count > 1 ? finish.count : running;
    const badgeTone = finish.count > 1 ? "done" : "timer";

    return (
      <div
        className="capsule"
        data-mode="done"
        data-activity={activity}
        onClick={onActivate}
        role="button"
        tabIndex={-1}
        aria-label={`${finish.title}，展开 NotchHub`}
      >
        <DoneMark />
        <span className="capsule__event-title" title={finish.title}>
          {finish.title}
        </span>
        {badgeCount > 0 ? (
          <span
            className="capsule__badge"
            data-visible="true"
            data-tone={badgeTone}
          >
            {badgeCount}
          </span>
        ) : null}
      </div>
    );
  }

  let main: string;
  let tone: "timer" | "clock";
  if (next) {
    main = formatCompact(timers.remainingOf(next));
    tone = "timer";
  } else {
    main = formatClock(clock);
    tone = "clock";
  }

  const dotTone = next ? "timer" : activeCount > 0 ? "todo" : "idle";
  // Blue = additional running timers, green = unfinished todos. Two separate
  // badges keep both facts visible when several timers and todos coexist.
  const timerCount = running > 1 ? running : 0;

  return (
    <div
      className="capsule"
      data-mode={next ? "timer" : "idle"}
      data-activity={activity}
      onClick={onActivate}
      role="button"
      tabIndex={-1}
      aria-label="展开 NotchHub"
    >
      {next ? (
        <CapsuleRing
          progress={
            next.durationMs > 0 ? timers.remainingOf(next) / next.durationMs : 0
          }
        />
      ) : (
        <span className="capsule__dot" data-tone={dotTone} />
      )}
      <span className="capsule__main" data-tone={tone}>
        {main}
      </span>
      <span className="capsule__badges">
        {timerCount > 0 ? (
          <span
            className="capsule__badge"
            data-visible="true"
            data-tone="timer"
            title={`${timerCount} 个计时器运行中`}
          >
            {timerCount}
          </span>
        ) : null}
        {activeCount > 0 ? (
          <span
            className="capsule__badge"
            data-visible="true"
            data-tone="active"
            title={`${activeCount} 项待办未完成`}
          >
            {activeCount}
          </span>
        ) : null}
      </span>
    </div>
  );
}

/** The running countdown's remaining fraction, as a small ring. */
function CapsuleRing({ progress }: { progress: number }) {
  const radius = 6.2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, progress));

  return (
    <svg className="capsule-ring" viewBox="0 0 16 16" aria-hidden="true">
      <circle className="capsule-ring__track" cx="8" cy="8" r={radius} />
      <circle
        className="capsule-ring__value"
        cx="8"
        cy="8"
        r={radius}
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - clamped)}
      />
    </svg>
  );
}

/**
 * Completion mark: an outer pulse, six sparks flying outward, and a check that
 * draws itself. Plays once — the finished state then rests on the check.
 */
function DoneMark() {
  return (
    <svg className="done-mark" viewBox="0 0 24 24" aria-hidden="true">
      <circle className="done-mark__ring" cx="12" cy="12" r="9.6" />

      <g className="done-mark__sparks">
        {Array.from({ length: 6 }, (_, index) => (
          <g key={index} transform={`rotate(${index * 60} 12 12)`}>
            <line className="done-mark__spark" x1="12" y1="8.4" x2="12" y2="4.6" />
          </g>
        ))}
      </g>

      <circle className="done-mark__pulse" cx="12" cy="12" r="9.6" />

      <path className="done-mark__check" d="M7.4 12.3l3.1 3.1 6.2-6.6" />
    </svg>
  );
}

/**
 * Todo reminder mark: a bell that swings, with a sound ring expanding from it.
 */
function BellMark() {
  return (
    <svg className="bell-mark" viewBox="0 0 24 24" aria-hidden="true">
      <circle className="bell-mark__halo" cx="12" cy="12" r="9.6" />
      <circle className="bell-mark__pulse" cx="12" cy="12" r="9.6" />

      <g className="bell-mark__body">
        <path
          className="bell-mark__shape"
          d="M12 3.6a5.1 5.1 0 0 0-5.1 5.1c0 4.1-1.5 5.4-1.5 5.4h13.2s-1.5-1.3-1.5-5.4A5.1 5.1 0 0 0 12 3.6z"
        />
        <path className="bell-mark__clapper" d="M10.4 17.5a1.8 1.8 0 0 0 3.2 0" />
      </g>
    </svg>
  );
}
