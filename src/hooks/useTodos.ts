import { useCallback, useEffect, useMemo, useRef } from "react";
import { normalizeDue, parseDueAt } from "../lib/dates";
import { usePersistentState } from "../lib/storage";

export type ReminderKind = "daily" | "once" | "due";

/** Sentinel for `kind: "due"`: the real moment always comes from `todo.dueDate`. */
export const DUE_MARKER = "due";

export type Reminder = {
  kind: ReminderKind;
  /** daily → "HH:mm"; once → "YYYY-MM-DDTHH:mm"; due → DUE_MARKER. */
  value: string;
  /** Marker of the last firing, prevents duplicate alerts. */
  firedKey?: string;
  /** When this reminder last rang, used to offer the snooze bar. */
  lastFiredAt?: number;
  /** Timestamp to ring again; takes over from `kind`/`value` until it fires. */
  snoozeUntil?: number;
};

/** A big piece of work that owns a set of sub-todos. */
export type Project = {
  id: string;
  name: string;
  createdAt: number;
};

export type Todo = {
  id: string;
  text: string;
  done: boolean;
  starred: boolean;
  createdAt: number;
  completedAt: number | null;
  reminder: Reminder | null;
  /** Owning project, or null for a standalone todo ("独立待办"). */
  projectId: string | null;
  /**
   * Planned completion moment, "YYYY-MM-DDTHH:mm:ss" local. Archived tasks
   * created before the clock was added may still be a bare "YYYY-MM-DD".
   */
  dueDate: string | null;
};

const STORAGE_KEY = "notchhub.todos.v1";
const PROJECTS_KEY = "notchhub.projects.v1";
const STALE_ONCE_MS = 24 * 60 * 60 * 1000;

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function reviveReminder(raw: unknown): Reminder | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<Reminder>;
  if (value.kind !== "daily" && value.kind !== "once" && value.kind !== "due") {
    return null;
  }
  if (typeof value.value !== "string" || !value.value) return null;
  return {
    kind: value.kind,
    value: value.value,
    firedKey: typeof value.firedKey === "string" ? value.firedKey : undefined,
    lastFiredAt:
      typeof value.lastFiredAt === "number" ? value.lastFiredAt : undefined,
    snoozeUntil:
      typeof value.snoozeUntil === "number" ? value.snoozeUntil : undefined,
  };
}

function revive(raw: unknown): Todo[] {
  if (!Array.isArray(raw)) return [];
  const out: Todo[] = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Partial<Todo>;
    if (typeof item.text !== "string" || !item.text.trim()) continue;

    const reminder = reviveReminder(item.reminder);
    const dueDate = normalizeDue(item.dueDate);

    // A reminder more than a day past its moment is stale: mark it fired so the
    // app does not blast a backlog of notifications after a restart.
    if (reminder?.kind === "once" && !reminder.firedKey) {
      const at = new Date(reminder.value).getTime();
      if (!Number.isNaN(at) && Date.now() - at > STALE_ONCE_MS) {
        reminder.firedKey = "once-fired";
      }
    }
    if (reminder?.kind === "due" && !reminder.firedKey && dueDate) {
      const at = parseDueAt(dueDate);
      if (at !== null && Date.now() - at > STALE_ONCE_MS) {
        reminder.firedKey = `due-fired:${dueDate}`;
      }
    }

    out.push({
      id: typeof item.id === "string" ? item.id : createId(),
      text: item.text.slice(0, 200),
      done: Boolean(item.done),
      starred: Boolean(item.starred),
      createdAt: typeof item.createdAt === "number" ? item.createdAt : Date.now(),
      completedAt:
        typeof item.completedAt === "number" ? item.completedAt : null,
      reminder,
      // Pre-project archives simply become standalone todos.
      projectId: typeof item.projectId === "string" ? item.projectId : null,
      dueDate,
    });
  }

  return out;
}

function reviveProjects(raw: unknown): Project[] {
  if (!Array.isArray(raw)) return [];
  const out: Project[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Partial<Project>;
    if (typeof item.name !== "string" || !item.name.trim()) continue;
    out.push({
      id: typeof item.id === "string" ? item.id : createId(),
      name: item.name.trim().slice(0, 60),
      createdAt: typeof item.createdAt === "number" ? item.createdAt : Date.now(),
    });
  }
  return out.sort((a, b) => a.createdAt - b.createdAt);
}

export function useTodos(onRemind: (todo: Todo) => void) {
  const [todos, setTodos] = usePersistentState<Todo[]>(STORAGE_KEY, [], revive);
  const [projects, setProjects] = usePersistentState<Project[]>(
    PROJECTS_KEY,
    [],
    reviveProjects,
  );

  const onRemindRef = useRef(onRemind);
  onRemindRef.current = onRemind;

  const todosRef = useRef(todos);
  todosRef.current = todos;

  // Poll once every 20s — minute-level precision is enough for reminders.
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const hm = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
      const dayKey = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
      const minuteKey = `${dayKey}${hm}`;

      const updates = new Map<string, Partial<Reminder>>();
      const due: Todo[] = [];

      for (const todo of todosRef.current) {
        if (todo.done || !todo.reminder) continue;
        const reminder = todo.reminder;

        // A snoozed reminder owns the schedule until it rings again, then drops
        // back to the original daily/once rule untouched.
        if (reminder.snoozeUntil) {
          if (now.getTime() >= reminder.snoozeUntil) {
            updates.set(todo.id, {
              snoozeUntil: undefined,
              lastFiredAt: now.getTime(),
            });
            due.push(todo);
          }
          continue;
        }

        if (reminder.kind === "daily") {
          if (hm === reminder.value && reminder.firedKey !== minuteKey) {
            updates.set(todo.id, {
              firedKey: minuteKey,
              lastFiredAt: now.getTime(),
            });
            due.push(todo);
          }
          continue;
        }

        // "Planned time" reminders have no independent schedule: they ring at
        // whatever `dueDate` says right now. Encoding the plan in `firedKey`
        // means moving the deadline re-arms the reminder automatically, while
        // a rename or a project change cannot replay a reminder that rang.
        if (reminder.kind === "due") {
          const plannedAt = parseDueAt(todo.dueDate);
          const firedKey = todo.dueDate
            ? `due-fired:${todo.dueDate}`
            : null;
          if (
            plannedAt !== null &&
            firedKey &&
            now.getTime() >= plannedAt &&
            reminder.firedKey !== firedKey
          ) {
            updates.set(todo.id, {
              firedKey,
              lastFiredAt: now.getTime(),
            });
            due.push(todo);
          }
          continue;
        }

        const at = new Date(reminder.value).getTime();
        if (
          !Number.isNaN(at) &&
          now.getTime() >= at &&
          reminder.firedKey !== "once-fired"
        ) {
          updates.set(todo.id, {
            firedKey: "once-fired",
            lastFiredAt: now.getTime(),
          });
          due.push(todo);
        }
      }

      if (due.length === 0) return;

      const markFired = (list: Todo[]) =>
        list.map((todo) => {
          const patch = updates.get(todo.id);
          if (!patch || !todo.reminder) return todo;
          return { ...todo, reminder: { ...todo.reminder, ...patch } };
        });

      // Update the ref synchronously: StrictMode runs mount effects twice, and
      // the second tick would otherwise still see the old `firedKey` and fire
      // the same reminder again.
      todosRef.current = markFired(todosRef.current);
      setTodos(markFired);

      due.forEach((todo) => onRemindRef.current(todo));
    };

    tick();
    const id = window.setInterval(tick, 20_000);
    return () => window.clearInterval(id);
  }, [setTodos]);

  const add = useCallback(
    (
      text: string,
      options: { projectId?: string | null; dueDate?: string | null } = {},
    ) => {
      const trimmed = text.trim().slice(0, 200);
      if (!trimmed) return;
      setTodos((prev) => [
        {
          id: createId(),
          text: trimmed,
          done: false,
          starred: false,
          createdAt: Date.now(),
          completedAt: null,
          reminder: null,
          projectId: options.projectId ?? null,
          dueDate: normalizeDue(options.dueDate),
        },
        ...prev,
      ]);
    },
    [setTodos],
  );

  // --- projects -----------------------------------------------------------

  const addProject = useCallback(
    (name: string): string | null => {
      const trimmed = name.trim().slice(0, 60);
      if (!trimmed) return null;
      const id = createId();
      setProjects((prev) => [
        ...prev,
        { id, name: trimmed, createdAt: Date.now() },
      ]);
      return id;
    },
    [setProjects],
  );

  const renameProject = useCallback(
    (id: string, name: string) => {
      const trimmed = name.trim().slice(0, 60);
      if (!trimmed) return;
      setProjects((prev) =>
        prev.map((project) =>
          project.id === id ? { ...project, name: trimmed } : project,
        ),
      );
    },
    [setProjects],
  );

  /**
   * Deleting a project never deletes its work: sub-todos fall back to the
   * standalone group. Losing a whole backlog to one misclick is worse than a
   * few ungrouped rows.
   */
  const removeProject = useCallback(
    (id: string) => {
      setProjects((prev) => prev.filter((project) => project.id !== id));
      setTodos((prev) =>
        prev.map((todo) =>
          todo.projectId === id ? { ...todo, projectId: null } : todo,
        ),
      );
    },
    [setProjects, setTodos],
  );

  const setDueDate = useCallback(
    (id: string, dueDate: string | null) => {
      setTodos((prev) =>
        prev.map((todo) =>
          todo.id === id ? { ...todo, dueDate: normalizeDue(dueDate) } : todo,
        ),
      );
    },
    [setTodos],
  );

  const setProject = useCallback(
    (id: string, projectId: string | null) => {
      setTodos((prev) =>
        prev.map((todo) =>
          todo.id === id ? { ...todo, projectId } : todo,
        ),
      );
    },
    [setTodos],
  );

  const toggle = useCallback(
    (id: string) => {
      setTodos((prev) =>
        prev.map((todo) =>
          todo.id === id
            ? {
                ...todo,
                done: !todo.done,
                completedAt: !todo.done ? Date.now() : null,
                // Completing a task retires its reminder.
                reminder: !todo.done ? null : todo.reminder,
              }
            : todo,
        ),
      );
    },
    [setTodos],
  );

  const remove = useCallback(
    (id: string) => {
      setTodos((prev) => prev.filter((todo) => todo.id !== id));
    },
    [setTodos],
  );

  const toggleStar = useCallback(
    (id: string) => {
      setTodos((prev) =>
        prev.map((todo) =>
          todo.id === id ? { ...todo, starred: !todo.starred } : todo,
        ),
      );
    },
    [setTodos],
  );

  const setReminder = useCallback(
    (id: string, reminder: Reminder | null) => {
      setTodos((prev) =>
        prev.map((todo) =>
          todo.id === id
            ? { ...todo, reminder: reminder ? { ...reminder, firedKey: undefined } : null }
            : todo,
        ),
      );
    },
    [setTodos],
  );

  /** Push the current reminder out by N minutes without losing its rule. */
  const snooze = useCallback(
    (id: string, minutes: number) => {
      const until = Date.now() + Math.max(1, minutes) * 60_000;
      setTodos((prev) =>
        prev.map((todo) =>
          todo.id === id && todo.reminder
            ? {
                ...todo,
                reminder: {
                  ...todo.reminder,
                  snoozeUntil: until,
                  lastFiredAt: undefined,
                },
              }
            : todo,
        ),
      );
    },
    [setTodos],
  );

  /**
   * One write for the whole task sheet, so the fields cannot tear. `text` also
   * lives here: renaming is a task edit, not a delete-and-recreate, so the id,
   * star, creation time and completion state all survive.
   */
  const updateTask = useCallback(
    (
      id: string,
      patch: {
        text?: string;
        reminder?: Reminder | null;
        dueDate?: string | null;
        projectId?: string | null;
      },
    ) => {
      setTodos((prev) =>
        prev.map((todo) => {
          if (todo.id !== id) return todo;
          const next = { ...todo };
          if (typeof patch.text === "string") {
            const text = patch.text.trim().slice(0, 200);
            if (text && text !== todo.text) next.text = text;
          }
          if ("reminder" in patch) {
            if (!patch.reminder) {
              next.reminder = null;
            } else {
              const previous = todo.reminder;
              const sameRule =
                previous !== null &&
                previous.kind === patch.reminder.kind &&
                previous.value === patch.reminder.value;
              // Renaming a task must not replay a reminder that already rang,
              // nor silently cancel a pending snooze. A changed rule does
              // start fresh so the new time is allowed to fire.
              next.reminder = sameRule
                ? {
                    ...patch.reminder,
                    firedKey: previous?.firedKey,
                    lastFiredAt: previous?.lastFiredAt,
                    snoozeUntil: previous?.snoozeUntil,
                  }
                : { ...patch.reminder, firedKey: undefined };
            }
          }
          if ("dueDate" in patch) {
            next.dueDate = normalizeDue(patch.dueDate);
          }
          if ("projectId" in patch) {
            next.projectId = patch.projectId ?? null;
          }
          return next;
        }),
      );
    },
    [setTodos],
  );

  const clearCompleted = useCallback(() => {
    setTodos((prev) => prev.filter((todo) => !todo.done));
  }, [setTodos]);

  const active = useMemo(
    () =>
      todos
        .filter((todo) => !todo.done)
        .sort(
          (a, b) =>
            Number(b.starred) - Number(a.starred) || b.createdAt - a.createdAt,
        ),
    [todos],
  );

  const completed = useMemo(
    () =>
      todos
        .filter((todo) => todo.done)
        .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0)),
    [todos],
  );

  const reminderCount = useMemo(
    () => active.filter((todo) => todo.reminder).length,
    [active],
  );

  return {
    todos,
    projects,
    active,
    completed,
    activeCount: active.length,
    reminderCount,
    add,
    toggle,
    remove,
    toggleStar,
    setReminder,
    setDueDate,
    setProject,
    updateTask,
    snooze,
    clearCompleted,
    addProject,
    renameProject,
    removeProject,
  };
}

export type TodoApi = ReturnType<typeof useTodos>;
