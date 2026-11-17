import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePersistentState } from "../lib/storage";

export type TimerPhase = "running" | "paused" | "done";

export type TimerItem = {
  id: string;
  title: string;
  /** Total length of this countdown. */
  durationMs: number;
  /** Wall-clock timestamp the countdown ends at (running only). */
  endsAt: number | null;
  /** Remaining time captured while paused. */
  remainingMs: number;
  phase: TimerPhase;
  createdAt: number;
};

const STORAGE_KEY = "notchhub.timers.v2";
const MAX_TIMERS = 12;
const MAX_DURATION = 99 * 3_600_000 + 59 * 60_000 + 59_000;

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function revive(raw: unknown): TimerItem[] {
  if (!Array.isArray(raw)) return [];

  const out: TimerItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Partial<TimerItem>;
    if (typeof item.durationMs !== "number" || item.durationMs <= 0) continue;

    const phase: TimerPhase =
      item.phase === "running" || item.phase === "paused" || item.phase === "done"
        ? item.phase
        : "paused";

    const durationMs = Math.min(item.durationMs, MAX_DURATION);

    if (phase === "running") {
      const endsAt = typeof item.endsAt === "number" ? item.endsAt : null;
      if (endsAt == null) {
        out.push({
          id: typeof item.id === "string" ? item.id : createId(),
          title: typeof item.title === "string" ? item.title : "",
          durationMs,
          endsAt: null,
          remainingMs: durationMs,
          phase: "paused",
          createdAt: typeof item.createdAt === "number" ? item.createdAt : Date.now(),
        });
        continue;
      }
      if (endsAt - Date.now() <= 0) {
        out.push({
          id: typeof item.id === "string" ? item.id : createId(),
          title: typeof item.title === "string" ? item.title : "",
          durationMs,
          endsAt: null,
          remainingMs: 0,
          phase: "done",
          createdAt: typeof item.createdAt === "number" ? item.createdAt : Date.now(),
        });
        continue;
      }
      out.push({
        id: typeof item.id === "string" ? item.id : createId(),
        title: typeof item.title === "string" ? item.title : "",
        durationMs,
        endsAt,
        remainingMs: Math.max(0, endsAt - Date.now()),
        phase: "running",
        createdAt: typeof item.createdAt === "number" ? item.createdAt : Date.now(),
      });
      continue;
    }

    const remainingMs =
      typeof item.remainingMs === "number"
        ? Math.max(0, Math.min(item.remainingMs, durationMs))
        : phase === "done"
          ? 0
          : durationMs;

    out.push({
      id: typeof item.id === "string" ? item.id : createId(),
      title: typeof item.title === "string" ? item.title : "",
      durationMs,
      endsAt: null,
      remainingMs,
      phase,
      createdAt: typeof item.createdAt === "number" ? item.createdAt : Date.now(),
    });
  }

  return out.slice(0, MAX_TIMERS);
}

const PHASE_RANK: Record<TimerPhase, number> = { running: 0, paused: 1, done: 2 };

export function useTimers(onFinish: (timer: TimerItem) => void) {
  const [timers, setTimers] = usePersistentState<TimerItem[]>(
    STORAGE_KEY,
    [],
    revive,
  );
  const [now, setNow] = useState(() => Date.now());

  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;

  const hasRunning = timers.some((timer) => timer.phase === "running");

  useEffect(() => {
    if (!hasRunning) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 120);
    return () => window.clearInterval(id);
  }, [hasRunning]);

  // Flip every elapsed countdown to "done" in one pass.
  useEffect(() => {
    const due = timers.filter(
      (timer) =>
        timer.phase === "running" &&
        timer.endsAt != null &&
        timer.endsAt <= now,
    );
    if (due.length === 0) return;

    setTimers((prev) =>
      prev.map((timer) =>
        due.some((item) => item.id === timer.id)
          ? { ...timer, phase: "done" as TimerPhase, endsAt: null, remainingMs: 0 }
          : timer,
      ),
    );
    due.forEach((timer) => onFinishRef.current(timer));
  }, [now, timers, setTimers]);

  const remainingOf = useCallback(
    (timer: TimerItem) =>
      timer.phase === "running" && timer.endsAt != null
        ? Math.max(0, timer.endsAt - now)
        : timer.remainingMs,
    [now],
  );

  const create = useCallback(
    (title: string, durationMs: number) => {
      const duration = Math.round(
        Math.min(MAX_DURATION, Math.max(1_000, durationMs)),
      );
      setTimers((prev) => {
        if (prev.length >= MAX_TIMERS) return prev;
        return [
          ...prev,
          {
            id: createId(),
            title: title.trim().slice(0, 40),
            durationMs: duration,
            endsAt: Date.now() + duration,
            remainingMs: duration,
            phase: "running" as TimerPhase,
            createdAt: Date.now(),
          },
        ];
      });
      setNow(Date.now());
    },
    [setTimers],
  );

  const pause = useCallback(
    (id: string) => {
      setTimers((prev) =>
        prev.map((timer) =>
          timer.id === id && timer.phase === "running" && timer.endsAt != null
            ? {
                ...timer,
                phase: "paused" as TimerPhase,
                endsAt: null,
                remainingMs: Math.max(0, timer.endsAt - Date.now()),
              }
            : timer,
        ),
      );
    },
    [setTimers],
  );

  const resume = useCallback(
    (id: string) => {
      setTimers((prev) =>
        prev.map((timer) =>
          timer.id === id && timer.phase === "paused"
            ? {
                ...timer,
                phase: "running" as TimerPhase,
                endsAt: Date.now() + Math.max(1_000, timer.remainingMs),
              }
            : timer,
        ),
      );
      setNow(Date.now());
    },
    [setTimers],
  );

  const restart = useCallback(
    (id: string) => {
      setTimers((prev) =>
        prev.map((timer) =>
          timer.id === id
            ? {
                ...timer,
                phase: "running" as TimerPhase,
                endsAt: Date.now() + timer.durationMs,
                remainingMs: timer.durationMs,
              }
            : timer,
        ),
      );
      setNow(Date.now());
    },
    [setTimers],
  );

  const remove = useCallback(
    (id: string) => {
      setTimers((prev) => prev.filter((timer) => timer.id !== id));
    },
    [setTimers],
  );

  const clearDone = useCallback(() => {
    setTimers((prev) => prev.filter((timer) => timer.phase !== "done"));
  }, [setTimers]);

  const sorted = useMemo(
    () =>
      [...timers].sort(
        (a, b) =>
          PHASE_RANK[a.phase] - PHASE_RANK[b.phase] || a.createdAt - b.createdAt,
      ),
    [timers],
  );

  const running = useMemo(
    () => sorted.filter((timer) => timer.phase === "running"),
    [sorted],
  );

  const nextTimer = useMemo(() => {
    let best: TimerItem | null = null;
    for (const timer of running) {
      if (!best || remainingOf(timer) < remainingOf(best)) best = timer;
    }
    return best;
  }, [running, remainingOf]);

  return {
    timers: sorted,
    count: timers.length,
    runningCount: running.length,
    nextTimer,
    remainingOf,
    create,
    pause,
    resume,
    restart,
    remove,
    clearDone,
    isFull: timers.length >= MAX_TIMERS,
  };
}

export type TimersApi = ReturnType<typeof useTimers>;
