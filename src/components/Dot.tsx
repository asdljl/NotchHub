import type { TimersApi } from "../hooks/useTimers";
import type { CapsuleFinish, CapsuleReminder } from "./Capsule";

/**
 * The dot is the whole collapsed island when "dot mode" is on: a small dark
 * lens with a coloured core. It carries the same information as the capsule —
 * running timer, a just-finished timer, todo reminder, pending todos — but
 * compressed into colour, a progress ring and a mark instead of text.
 *
 * A finish is a short-lived notice supplied by App, never a latched state read
 * from the persisted timer rows. While it shows, the badge keeps reporting how
 * many timers are still running.
 */
export type DotState = "reminder" | "done" | "timer" | "todo" | "idle";

type DotProps = {
  timers: TimersApi;
  reminder: CapsuleReminder;
  finish: CapsuleFinish;
  activeCount: number;
  onActivate: () => void;
};

const RING_RADIUS = 10.4;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export function Dot({
  timers,
  reminder,
  finish,
  activeCount,
  onActivate,
}: DotProps) {
  const next = timers.nextTimer;
  const running = timers.runningCount;

  // Priority: a ringing todo wins over a fresh completion, which wins over a
  // running timer. The completion expires on its own (App.tsx), so it can only
  // mask the progress ring for a few seconds instead of forever.
  const state: DotState = reminder
    ? "reminder"
    : finish
      ? "done"
      : next
        ? "timer"
        : activeCount > 0
          ? "todo"
          : "idle";

  const progress =
    next && next.durationMs > 0
      ? Math.max(0, Math.min(1, timers.remainingOf(next) / next.durationMs))
      : 0;

  // While the green check is showing, report every running timer (even one):
  // the user needs to know the check is not the whole story. In the other
  // states a single running timer is obvious from the ring, so only 2+ counts.
  const badgeCount = state === "done" ? running : running > 1 ? running : 0;

  const labels: Record<DotState, string> = {
    reminder: `待办提醒：${reminder?.text ?? ""}，展开 NotchHub`,
    done: `${finish?.title ?? "计时结束"}${
      running > 0 ? `，还有 ${running} 个计时器在跑` : ""
    }，展开 NotchHub`,
    timer: `${
      running > 0 ? `${running} 个计时器在跑，` : ""
    }展开 NotchHub`,
    todo: `${activeCount} 项待办，展开 NotchHub`,
    idle: "展开 NotchHub",
  };

  return (
    <div
      className="dot"
      data-state={state}
      onClick={onActivate}
      role="button"
      tabIndex={-1}
      aria-label={labels[state]}
    >
      {/* Three concentric rings drifting outward — the "wave" that every
          state shares; colour, speed and brightness come from data-state. */}
      <span className="dot__waves" aria-hidden="true">
        <span className="dot__wave" />
        <span className="dot__wave" />
        <span className="dot__wave" />
      </span>

      {state === "done" && finish ? (
        // Keyed by timer id so a second completion replays the arrival wave
        // even while the dot is already in the "done" state.
        <span
          className="dot__done-wave"
          key={finish.id}
          aria-hidden="true"
        />
      ) : null}

      <span className="dot__halo" aria-hidden="true" />

      {state === "timer" ? (
        <svg className="dot__ring" viewBox="0 0 26 26" aria-hidden="true">
          <circle
            className="dot__ring-track"
            cx="13"
            cy="13"
            r={RING_RADIUS}
          />
          <circle
            className="dot__ring-scan"
            cx="13"
            cy="13"
            r={RING_RADIUS}
          />
          <circle
            className="dot__ring-value"
            cx="13"
            cy="13"
            r={RING_RADIUS}
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={RING_CIRCUMFERENCE * (1 - progress)}
          />
        </svg>
      ) : null}

      {state === "reminder" ? (
        <span className="dot__pulse" aria-hidden="true" />
      ) : null}

      <span className="dot__core" aria-hidden="true" />

      {state === "done" && finish ? (
        <svg
          className="dot__check"
          key={finish.id}
          viewBox="0 0 26 26"
          aria-hidden="true"
        >
          <path d="M8.7 13.3l3 3 5.8-6.2" />
        </svg>
      ) : null}

      {badgeCount > 0 ? (
        <span className="dot__badge" aria-hidden="true">
          {badgeCount}
        </span>
      ) : null}
    </div>
  );
}
