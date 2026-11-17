import type { Todo } from "../hooks/useTodos";

/** Local calendar day, "YYYY-MM-DD". Never use toISOString() here — UTC would
 *  shift the day for anyone east/west of Greenwich. */
export function dateKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayKey(): string {
  return dateKey(new Date());
}

export function tomorrowKey(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return dateKey(date);
}

/**
 * A planned completion is "YYYY-MM-DDTHH:mm:ss" in local time, without a zone
 * suffix so string comparison stays chronological. Task archives written
 * before the clock was added still use the bare "YYYY-MM-DD" form and remain
 * valid — they simply have no time of day until edited.
 */
const DUE_KEY = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2}))?$/;

/** Clock used when a day-only plan is upgraded, and for quick-add in a day view. */
export const DEFAULT_DUE_TIME = "23:59:59";

/** Validate a plan value; returns null for anything malformed or impossible. */
export function normalizeDue(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const match = DUE_KEY.exec(value.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  if (hour !== undefined) {
    if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) {
      return null;
    }
  }
  // `new Date(2026, 1, 31)` silently rolls into March — reject impossible days.
  const probe = new Date(Number(year), Number(month) - 1, Number(day));
  if (
    probe.getFullYear() !== Number(year) ||
    probe.getMonth() + 1 !== Number(month) ||
    probe.getDate() !== Number(day)
  ) {
    return null;
  }
  return hour === undefined
    ? value.trim()
    : `${year}-${month}-${day}T${hour}:${minute}:${second}`;
}

/** The "YYYY-MM-DD" part of any plan value. */
export function dueDay(value: string | null | undefined): string | null {
  return value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}

/** "HH:mm:ss" when the plan has a clock, null for legacy day-only plans. */
export function dueClock(value: string | null | undefined): string | null {
  return value && value.length >= 19 ? value.slice(11, 19) : null;
}

/**
 * Local epoch ms for a plan. Legacy day-only values end at 23:59:59, so a
 * "planned time" reminder never rings at midnight for an old task.
 */
export function parseDueAt(value: string | null | undefined): number | null {
  const day = dueDay(value);
  if (!day) return null;
  const [year, month, date] = day.split("-").map(Number);
  const clock = dueClock(value) ?? DEFAULT_DUE_TIME;
  const [hour, minute, second] = clock.split(":").map(Number);
  const at = new Date(year, month - 1, date, hour, minute, second, 0);
  return Number.isNaN(at.getTime()) ? null : at.getTime();
}

/** Comparable key for sorting: day + clock, with a stable tail for undated. */
export function planSortKey(value: string | null | undefined): string {
  const day = dueDay(value);
  if (!day) return "9999";
  return `${day}T${dueClock(value) ?? DEFAULT_DUE_TIME}`;
}

/**
 * Explicit `dueDate` wins. Otherwise a one-off reminder already carries a day,
 * so old tasks (and tasks whose owner only set a reminder) still show up in the
 * today/tomorrow views without a second data entry step. Daily and "planned
 * time" reminders have no independent date and are deliberately ignored.
 */
export function effectiveDue(todo: Todo): string | null {
  if (todo.dueDate) return dueDay(todo.dueDate);
  const value = todo.reminder?.kind === "once" ? todo.reminder.value : null;
  return value && /^\d{4}-\d{2}-\d{2}T/.test(value) ? value.slice(0, 10) : null;
}

/** Full planned moment (day + clock) for display and sorting. */
export function effectivePlan(todo: Todo): string | null {
  if (todo.dueDate) return todo.dueDate;
  const value = todo.reminder?.kind === "once" ? todo.reminder.value : null;
  return value && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)
    ? `${value.slice(0, 10)}T${value.slice(11, 16)}:00`
    : null;
}

export type DueTone = "overdue" | "today" | "tomorrow" | "later" | null;

export function dueTone(todo: Todo): DueTone {
  if (todo.done) return null;
  const due = effectiveDue(todo);
  if (!due) return null;
  const today = todayKey();
  if (due < today) return "overdue";
  if (due === today) return "today";
  if (due === tomorrowKey()) return "tomorrow";
  return "later";
}

/** Overdue work belongs in "today" too — it still needs doing now. */
export type DueBucket = "today" | "tomorrow" | "later" | null;

export function dueBucket(todo: Todo): DueBucket {
  if (todo.done) return null;
  const due = effectiveDue(todo);
  if (!due) return null;
  const today = todayKey();
  if (due <= today) return "today";
  if (due === tomorrowKey()) return "tomorrow";
  return "later";
}

/** Short label for the plan chip; includes HH:mm:ss once a clock is known. */
export function describeDue(tone: DueTone, todo: Todo): string {
  const due = effectiveDue(todo);
  if (!due || !tone) return "";
  const clock = dueClock(effectivePlan(todo));
  const at = clock ? ` ${clock}` : "";
  if (tone === "today") return `今天${at}`;
  if (tone === "tomorrow") return `明天${at}`;

  const [year, month, day] = due.split("-").map(Number);
  if (tone === "overdue") {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(year, month - 1, day);
    const days = Math.max(
      1,
      Math.round((today.getTime() - target.getTime()) / 86_400_000),
    );
    return `逾期 ${days} 天${at}`;
  }
  return `${month} 月 ${day} 日${at}`;
}

/** Unabridged plan for tooltips. */
export function describePlanFull(todo: Todo): string {
  const plan = effectivePlan(todo);
  if (!plan) return "未设置计划完成时间";
  const day = dueDay(plan);
  const clock = dueClock(plan);
  return `${day}${clock ? ` ${clock}` : "（仅日期）"}`;
}
