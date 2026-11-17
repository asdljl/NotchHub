import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  Bell,
  Check,
  ChevronDown,
  Layers,
  ListTodo,
  Pencil,
  Plus,
  Star,
  Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { TaskSheet, type TaskPatch } from "./TaskSheet";
import type { Project, Reminder, Todo, TodoApi } from "../hooks/useTodos";
import {
  DEFAULT_DUE_TIME,
  describeDue,
  describePlanFull,
  dueBucket,
  dueTone,
  effectivePlan,
  planSortKey,
  todayKey,
  tomorrowKey,
} from "../lib/dates";

type Filter = "all" | "today" | "tomorrow";

const FILTERS: Array<{ id: Filter; label: string; empty: string }> = [
  { id: "all", label: "未完成", empty: "全部完成，休息一下" },
  { id: "today", label: "今天", empty: "今天没有安排" },
  { id: "tomorrow", label: "明天", empty: "明天没有安排" },
];

const STANDALONE = "standalone";
/** Radix Select forbids an empty string as an item value. */
const STANDALONE_VALUE = "__standalone__";
const PROJECT_COLORS = [
  "#0a84ff",
  "#30d158",
  "#ff9f0a",
  "#bf5af2",
  "#64d2ff",
  "#ff6482",
  "#5e5ce6",
];

function projectColor(id: string | null): string {
  if (!id) return "rgba(255, 255, 255, 0.3)";
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return PROJECT_COLORS[hash % PROJECT_COLORS.length];
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

const SNOOZE_WINDOW_MS = 15 * 60 * 1000;

/** Offer "remind me later" for a while after a reminder actually rang. */
function shouldOfferSnooze(todo: Todo): boolean {
  if (todo.done || !todo.reminder) return false;
  if (todo.reminder.snoozeUntil) return false;
  const firedAt = todo.reminder.lastFiredAt;
  return typeof firedAt === "number" && Date.now() - firedAt < SNOOZE_WINDOW_MS;
}

function describeReminder(reminder: Reminder): string {
  if (reminder.snoozeUntil) {
    const at = new Date(reminder.snoozeUntil);
    return `稍后 ${pad2(at.getHours())}:${pad2(at.getMinutes())}`;
  }
  if (reminder.kind === "daily") return `每天 ${reminder.value}`;
  if (reminder.kind === "due") return "计划完成时";

  const at = new Date(reminder.value);
  if (Number.isNaN(at.getTime())) return "定时";

  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);

  const time = `${pad2(at.getHours())}:${pad2(at.getMinutes())}`;
  if (at.toDateString() === now.toDateString()) return `今天 ${time}`;
  if (at.toDateString() === tomorrow.toDateString()) return `明天 ${time}`;
  return `${at.getMonth() + 1} 月 ${at.getDate()} 日 ${time}`;
}

type Group = {
  key: string;
  project: Project | null;
  all: Todo[];
  visible: Todo[];
  done: Todo[];
};

export function TodoView({
  todos,
  ringingIds,
}: {
  todos: TodoApi;
  ringingIds: string[];
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [draft, setDraft] = useState("");
  const [targetProject, setTargetProject] = useState(STANDALONE_VALUE);
  const [creatingProject, setCreatingProject] = useState(false);
  const [projectDraft, setProjectDraft] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [showDone, setShowDone] = useState<Record<string, boolean>>({});
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [inlineDraft, setInlineDraft] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  // Keep only the id: if a reminder fires, a snooze lands, or the task is
  // deleted while the sheet is open, the editor must read the live object.
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingTodo = todos.todos.find((todo) => todo.id === editingId) ?? null;

  // Grouping is memoised, so the calendar day must be a dependency: otherwise
  // a panel left open overnight keeps calling yesterday "today".
  const [day, setDay] = useState(todayKey);
  useEffect(() => {
    const id = window.setInterval(() => setDay(todayKey()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  // A plan created from the today/tomorrow view should land in that view.
  // Day-only values are still accepted, but new ones always carry a clock.
  const filterDueDate =
    filter === "today"
      ? `${todayKey()}T${DEFAULT_DUE_TIME}`
      : filter === "tomorrow"
        ? `${tomorrowKey()}T${DEFAULT_DUE_TIME}`
        : null;

  const targetId =
    targetProject === STANDALONE_VALUE ? null : targetProject || null;

  const counts = useMemo(() => {
    let today = 0;
    let tomorrow = 0;
    for (const todo of todos.active) {
      const bucket = dueBucket(todo);
      if (bucket === "today") today += 1;
      if (bucket === "tomorrow") tomorrow += 1;
    }
    return { all: todos.activeCount, today, tomorrow };
  }, [todos.active, todos.activeCount, day]);

  const groups = useMemo<Group[]>(() => {
    const known = new Map(todos.projects.map((project) => [project.id, project]));
    const ownerKey = (todo: Todo) =>
      todo.projectId && known.has(todo.projectId) ? todo.projectId : STANDALONE;

    // Standalone first: it is the default target of the quick-add row, so new
    // tasks must be visible immediately without a scroll to the bottom.
    const order: Array<{ key: string; project: Project | null }> = [
      { key: STANDALONE, project: null },
      ...todos.projects.map((project) => ({ key: project.id, project })),
    ];

    return order
      .map(({ key, project }) => {
        const all = todos.todos.filter((todo) => ownerKey(todo) === key);
        const done = all
          .filter((todo) => todo.done)
          .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
        const visible = all
          .filter((todo) => !todo.done)
          .filter((todo) => {
            if (filter === "all") return true;
            return dueBucket(todo) === filter;
          })
          .sort((a, b) => {
            if (Number(b.starred) !== Number(a.starred)) {
              return Number(b.starred) - Number(a.starred);
            }
            // "未完成" keeps the familiar newest-first order: a freshly added
            // task must never sink below older tasks that happen to have a date.
            // The day views sort by the full planned moment, so two tasks on
            // the same day still appear in chronological order.
            if (filter !== "all") {
              const byDue = planSortKey(effectivePlan(a)).localeCompare(
                planSortKey(effectivePlan(b)),
              );
              if (byDue !== 0) return byDue;
            }
            return b.createdAt - a.createdAt;
          });
        return { key, project, all, visible, done };
      })
      .filter((group) => {
        // In "未完成" every real project keeps a card — a freshly created empty
        // project still needs somewhere to receive its first sub-todo. The
        // standalone group is virtual, so it only appears once it has work.
        if (filter !== "all") return group.visible.length > 0;
        if (group.key === STANDALONE) return group.all.length > 0;
        return true;
      });
  }, [todos.todos, todos.projects, filter, day]);

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    todos.add(text, { projectId: targetId, dueDate: filterDueDate });
    setDraft("");
  };

  const createProject = () => {
    const name = projectDraft.trim();
    if (!name) return;
    const id = todos.addProject(name);
    if (id) setTargetProject(id);
    setProjectDraft("");
    setCreatingProject(false);
  };

  const startInlineAdd = (key: string) => {
    setAddingTo(key);
    setInlineDraft("");
  };

  const submitInlineAdd = (group: Group) => {
    const text = inlineDraft.trim();
    if (!text) return;
    todos.add(text, {
      projectId: group.project?.id ?? null,
      dueDate: filterDueDate,
    });
    setInlineDraft("");
  };

  /** "完成" closes the inline row, but must first save whatever was typed. */
  const finishInlineAdd = (group: Group) => {
    submitInlineAdd(group);
    setInlineDraft("");
    setAddingTo(null);
  };

  const saveRename = (id: string) => {
    todos.renameProject(id, renameDraft);
    setRenaming(null);
  };

  const isEmpty = todos.todos.length === 0 && todos.projects.length === 0;

  return (
    <div className="todo">
      <div className="todo__toolbar">
        <Tabs
          value={filter}
          onValueChange={(next) => setFilter(next as Filter)}
          className="min-w-0 flex-1"
        >
          <TabsList className="todo__filters h-7 w-full rounded-lg border-0 bg-white/6 p-0.5">
            {FILTERS.map((item) => (
              <TabsTrigger
                key={item.id}
                value={item.id}
                className="todo__filter h-6 flex-1 gap-1 rounded-md px-1.5 text-[11px]"
                aria-label={`${item.label}视图`}
              >
                {item.label}
                {counts[item.id] > 0 && (
                  <Badge
                    variant={filter === item.id ? "default" : "secondary"}
                    className="todo__filter-count min-w-4 justify-center rounded-full border-0 px-1 text-[9px] leading-4"
                  >
                    {counts[item.id]}
                  </Badge>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Button
          variant="secondary"
          size="sm"
          className="todo__new-project h-8 gap-1 rounded-lg px-2.5 text-[11px]"
          onClick={() => {
            setCreatingProject(true);
            setDraft("");
          }}
          title="新建项目"
        >
          <Layers className="size-3 text-success" />
          项目
        </Button>
      </div>

      {creatingProject ? (
        <div className="todo__new todo__new--project">
          <Button
            className="todo__add"
            size="icon-sm"
            onClick={createProject}
            disabled={!projectDraft.trim()}
            aria-label="创建项目"
          >
            <Check className="size-3" strokeWidth={2.6} />
          </Button>
          <Input
            autoFocus
            className="todo__new-input h-7 w-auto min-w-0 flex-1 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0"
            value={projectDraft}
            onChange={(event) => setProjectDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setCreatingProject(false);
                setProjectDraft("");
              }
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                createProject();
              }
            }}
            placeholder="项目名称"
            maxLength={60}
            spellCheck={false}
          />
          <Button
            variant="ghost"
            size="xs"
            className="todo__new-cancel"
            onClick={() => {
              setCreatingProject(false);
              setProjectDraft("");
            }}
          >
            取消
          </Button>
        </div>
      ) : (
        <div className="todo__new">
          <Button
            className="todo__add"
            size="icon-sm"
            onClick={submit}
            disabled={!draft.trim()}
            aria-label="添加任务"
          >
            <Plus className="size-3" strokeWidth={2} />
          </Button>
          <Input
            className="todo__new-input h-7 w-auto min-w-0 flex-1 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // While an IME is composing, Enter belongs to the candidate window.
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                submit();
              }
            }}
            placeholder="添加子待办"
            maxLength={200}
            spellCheck={false}
          />
          <Select value={targetProject} onValueChange={setTargetProject}>
            <SelectTrigger
              className="todo__target h-6 w-[84px] shrink-0 rounded-md border-0 bg-white/8 px-1.5 text-[10px] shadow-none"
              aria-label="添加到项目"
              title="添加到项目"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={STANDALONE_VALUE}>独立</SelectItem>
              {todos.projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* A real button, not a hint badge: clicking it adds the task too. */}
          <Button
            variant="ghost"
            size="xs"
            className="todo__new-hint todo__new-submit shrink-0 px-1 text-[9px] hover:bg-white/8 hover:text-foreground/80"
            onClick={submit}
            disabled={!draft.trim()}
            title="添加任务（或按回车）"
            aria-label="添加子待办"
          >
            添加
          </Button>
        </div>
      )}

      <div className="todo__list">
        {isEmpty ? (
          <EmptyState />
        ) : groups.length === 0 ? (
          <div className="todo__empty">
            <ListTodo className="size-6 opacity-40" strokeWidth={1.2} />
            <span className="empty__title">
              {FILTERS.find((item) => item.id === filter)?.empty}
            </span>
            <span className="empty__hint">
              点子待办下方的「+ 计划」设置完成时间，或切换上方筛选
            </span>
          </div>
        ) : (
          groups.map((group) => (
            <ProjectCard
              key={group.key}
              group={group}
              filter={filter}
              todos={todos}
              ringingIds={ringingIds}
              collapsed={Boolean(collapsed[group.key])}
              onToggleCollapse={() =>
                setCollapsed((prev) => ({ ...prev, [group.key]: !prev[group.key] }))
              }
              showDone={Boolean(showDone[group.key])}
              onToggleDone={() =>
                setShowDone((prev) => ({ ...prev, [group.key]: !prev[group.key] }))
              }
              adding={addingTo === group.key}
              inlineDraft={inlineDraft}
              onInlineDraft={setInlineDraft}
              onStartAdd={() => startInlineAdd(group.key)}
              onCancelAdd={() => setAddingTo(null)}
              onSubmitAdd={() => submitInlineAdd(group)}
              onFinishAdd={() => finishInlineAdd(group)}
              renaming={renaming === group.key}
              renameDraft={renameDraft}
              onRenameDraft={setRenameDraft}
              onStartRename={() => {
                setRenameDraft(group.project?.name ?? "");
                setRenaming(group.key);
              }}
              onSaveRename={() => group.project && saveRename(group.project.id)}
              onCancelRename={() => setRenaming(null)}
              confirming={confirmDelete === group.key}
              onAskDelete={() => setConfirmDelete(group.key)}
              onCancelDelete={() => setConfirmDelete(null)}
              onConfirmDelete={() => {
                if (group.project) todos.removeProject(group.project.id);
                setConfirmDelete(null);
              }}
              onEdit={setEditingId}
            />
          ))
        )}
      </div>

      <div className="todo__footer">
        <span>
          {todos.activeCount > 0 ? `${todos.activeCount} 项待办` : "全部完成"}
          {todos.projects.length > 0 ? ` · ${todos.projects.length} 个项目` : ""}
          {todos.reminderCount > 0 ? ` · ${todos.reminderCount} 个提醒` : ""}
        </span>
        <Button
          variant="ghost"
          size="xs"
          disabled={todos.completed.length === 0}
          onClick={todos.clearCompleted}
        >
          清除已完成
        </Button>
      </div>

      {editingTodo && (
        <TaskSheet
          key={editingTodo.id}
          todo={editingTodo}
          projects={todos.projects}
          onClose={() => setEditingId(null)}
          onSave={(patch: TaskPatch) => {
            todos.updateTask(editingTodo.id, patch);
            setEditingId(null);
          }}
        />
      )}
    </div>
  );
}

type ProjectCardProps = {
  group: Group;
  filter: Filter;
  todos: TodoApi;
  ringingIds: string[];
  collapsed: boolean;
  onToggleCollapse: () => void;
  showDone: boolean;
  onToggleDone: () => void;
  adding: boolean;
  inlineDraft: string;
  onInlineDraft: (value: string) => void;
  onStartAdd: () => void;
  onCancelAdd: () => void;
  onSubmitAdd: () => void;
  onFinishAdd: () => void;
  renaming: boolean;
  renameDraft: string;
  onRenameDraft: (value: string) => void;
  onStartRename: () => void;
  onSaveRename: () => void;
  onCancelRename: () => void;
  confirming: boolean;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  onEdit: (id: string) => void;
};

function ProjectCard(props: ProjectCardProps) {
  const { group, todos, filter } = props;
  const standalone = !group.project;
  const doneCount = group.done.length;
  const total = group.all.length;
  const progress = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  return (
    <Card
      className="project gap-0 border-white/8 bg-white/[0.035] py-0 shadow-none"
      data-standalone={standalone}
      data-collapsed={props.collapsed}
      style={
        { "--project-color": projectColor(group.project?.id ?? null) } as CSSProperties
      }
    >
      <header className="project__head">
        <Button
          variant="ghost"
          size="icon-sm"
          className="project__fold size-5"
          onClick={props.onToggleCollapse}
          aria-label={props.collapsed ? "展开项目" : "收起项目"}
        >
          <ChevronDown
            className={cn(
              "size-3 transition-transform duration-200",
              props.collapsed && "-rotate-90",
            )}
            strokeWidth={2.2}
          />
        </Button>
        <span className="project__dot size-2 rounded-full bg-[var(--project-color)]" />
        {props.renaming ? (
          <Input
            className="project__rename h-6 flex-1 border-0 bg-white/8 px-1.5 text-[11px] shadow-none"
            autoFocus
            value={props.renameDraft}
            onChange={(event) => props.onRenameDraft(event.target.value)}
            onBlur={props.onSaveRename}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                props.onSaveRename();
              }
              if (event.key === "Escape") props.onCancelRename();
            }}
            maxLength={60}
            spellCheck={false}
          />
        ) : (
          <span className="project__name flex-1 truncate text-[11.5px] font-semibold" title={group.project?.name}>
            {standalone ? "独立待办" : group.project?.name}
          </span>
        )}
        <Badge variant="secondary" className="project__meta border-0 px-1.5">
          {filter === "all" ? `${doneCount}/${total}` : `${group.visible.length} 项`}
        </Badge>
        {!standalone && (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              className="project__action size-5"
              onClick={props.onStartRename}
              aria-label="重命名项目"
            >
              <Pencil className="size-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="project__action size-5 hover:text-destructive"
              onClick={props.onAskDelete}
              aria-label="删除项目"
            >
              <Trash2 className="size-3" />
            </Button>
          </>
        )}
      </header>

      <Progress
        value={progress}
        className="project__bar h-1 bg-white/8"
        indicatorClassName="bg-[var(--project-color)]"
      />

      {props.confirming && (
        <div className="project__confirm flex items-center gap-2 rounded-md bg-destructive/10 px-2 py-1.5">
          <span className="flex-1 text-[10px] text-foreground/70">
            删除项目？子待办保留为独立待办
          </span>
          <Button variant="ghost" size="xs" onClick={props.onCancelDelete}>
            取消
          </Button>
          <Button variant="destructive" size="xs" onClick={props.onConfirmDelete}>
            删除
          </Button>
        </div>
      )}

      {!props.collapsed && (
        <>
          <div className="project__items">
            {group.visible.map((todo) => (
              <Fragment key={todo.id}>
                <TodoRow
                  todo={todo}
                  todos={todos}
                  ringing={props.ringingIds.includes(todo.id)}
                  onEdit={props.onEdit}
                />
                {shouldOfferSnooze(todo) ? (
                  <SnoozeBar todoId={todo.id} onSnooze={todos.snooze} />
                ) : null}
              </Fragment>
            ))}

            {group.visible.length === 0 && filter === "all" && (
              <span className="project__all-done">
                {group.all.length === 0
                  ? "还没有子待办，点下方添加"
                  : "都完成了"}
              </span>
            )}

            {filter === "all" && doneCount > 0 && (
              <>
                <Button
                  variant="ghost"
                  size="xs"
                  className="project__done-toggle w-full justify-between"
                  onClick={props.onToggleDone}
                >
                  已完成 {doneCount}
                  <span className="text-muted-foreground">
                    {props.showDone ? "收起" : "展开"}
                  </span>
                </Button>
                {props.showDone &&
                  group.done.map((todo) => (
                    <TodoRow
                      key={todo.id}
                      todo={todo}
                      todos={todos}
                      ringing={false}
                      onEdit={props.onEdit}
                    />
                  ))}
              </>
            )}
          </div>

          {props.adding ? (
            <div className="project__inline">
              <Button
                className="project__inline-add"
                size="icon-sm"
                onClick={props.onSubmitAdd}
                disabled={!props.inlineDraft.trim()}
                aria-label="添加子待办"
              >
                <Plus className="size-3" />
              </Button>
              <Input
                className="project__inline-input h-6 w-auto min-w-0 flex-1 border-0 bg-transparent px-1 text-[11px] shadow-none focus-visible:ring-0"
                autoFocus
                value={props.inlineDraft}
                onChange={(event) => props.onInlineDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    // Keep Escape inside the row: the shell would otherwise
                    // collapse the whole island.
                    event.stopPropagation();
                    props.onCancelAdd();
                  }
                  if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                    props.onSubmitAdd();
                  }
                }}
                placeholder={
                  filter === "all"
                    ? "子待办，回车连续添加"
                    : `子待办 · 自动设为${filter === "today" ? "今天" : "明天"}`
                }
                maxLength={200}
                spellCheck={false}
              />
              <Button
                variant="ghost"
                size="xs"
                className="project__inline-cancel"
                onClick={props.onFinishAdd}
                title="保存当前输入并结束添加"
              >
                完成
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="xs"
              className="project__add w-full justify-start"
              onClick={props.onStartAdd}
            >
              <Plus className="size-3" strokeWidth={2.2} />
              添加子待办
            </Button>
          )}
        </>
      )}
    </Card>
  );
}

function TodoRow({
  todo,
  todos,
  ringing,
  onEdit,
}: {
  todo: Todo;
  todos: TodoApi;
  ringing: boolean;
  onEdit: (id: string) => void;
}) {
  const tone = dueTone(todo);
  const plan = describeDue(tone, todo);

  // Inline rename: click the text to edit it right where it sits. The pencil /
  // plan / bell buttons open the full editor instead.
  const [draft, setDraft] = useState<string | null>(null);
  const skipBlurRef = useRef(false);

  const startRename = () => {
    skipBlurRef.current = false;
    setDraft(todo.text);
  };

  const cancelRename = () => {
    skipBlurRef.current = true;
    setDraft(null);
  };

  const commitRename = () => {
    // Enter/Escape unmount the input, which can emit one more blur.
    if (skipBlurRef.current) {
      skipBlurRef.current = false;
      return;
    }
    if (draft === null) return;
    skipBlurRef.current = true;
    const next = draft.trim();
    if (next && next !== todo.text) todos.updateTask(todo.id, { text: next });
    setDraft(null);
  };

  return (
    <div className="item" data-done={todo.done} data-ringing={ringing || undefined}>
      <Checkbox
        className="item__check size-[15px] rounded-full border-white/25 data-[state=checked]:border-success data-[state=checked]:bg-success"
        checked={todo.done}
        onCheckedChange={() => todos.toggle(todo.id)}
        aria-label={todo.done ? "标记为未完成" : "标记为完成"}
      />

      <div className="item__body">
        {draft === null ? (
          <button
            type="button"
            className="item__text"
            title={`${todo.text} · 点击改名`}
            onClick={startRename}
          >
            {todo.text}
          </button>
        ) : (
          <Input
            className="item__edit h-6 w-full min-w-0 border-0 bg-white/10 px-1.5 text-[12px] shadow-none focus-visible:ring-1"
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                // The shell listens on window for Escape to collapse the
                // island; an inline rename must swallow it.
                event.stopPropagation();
                cancelRename();
              }
              // Enter belongs to the IME candidate window while composing.
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                commitRename();
              }
            }}
            maxLength={200}
            spellCheck={false}
            aria-label="编辑子待办名称"
          />
        )}
        {!todo.done && (
          <span className="item__meta">
            <Badge
              asChild
              variant={
                tone === "overdue"
                  ? "destructive"
                  : tone === "today"
                    ? "warning"
                    : tone === "tomorrow"
                      ? "default"
                      : "secondary"
              }
              className={cn(
                "item__plan border-0 px-1.5",
                !plan && "bg-white/6 text-muted-foreground",
              )}
            >
              <button
                data-tone={tone ?? undefined}
                data-empty={!plan || undefined}
                onClick={() => onEdit(todo.id)}
                title={`${describePlanFull(todo)} · 点击编辑`}
              >
                {plan || "+ 计划"}
              </button>
            </Badge>
            {todo.reminder ? (
              <Badge variant="outline" className="item__reminder border-0 bg-warning/12 px-1.5 text-warning">
                <Bell className="size-2.5" />
                {describeReminder(todo.reminder)}
              </Badge>
            ) : null}
          </span>
        )}
      </div>

      <Button
        variant="ghost"
        size="icon-sm"
        className="item__action size-6"
        onClick={() => onEdit(todo.id)}
        aria-label="编辑任务"
        title="编辑任务（名称 / 项目 / 完成时间 / 提醒）"
      >
        <Pencil className="size-3" />
      </Button>

      <Button
        variant="ghost"
        size="icon-sm"
        className={cn(
          "item__action size-6",
          todo.reminder && !todo.done && "text-warning",
        )}
        data-bell="true"
        data-reminder={Boolean(todo.reminder) && !todo.done}
        onClick={() => onEdit(todo.id)}
        aria-label="计划完成时间与提醒"
      >
        <Bell className="size-3" />
      </Button>

      <Button
        variant="ghost"
        size="icon-sm"
        className={cn(
          "item__action size-6",
          todo.starred && "text-warning",
        )}
        data-starred={todo.starred}
        onClick={() => todos.toggleStar(todo.id)}
        aria-label={todo.starred ? "取消星标" : "添加星标"}
      >
        <Star
          className={cn(
            "size-3",
            todo.starred && "fill-warning",
          )}
        />
      </Button>

      <Button
        variant="ghost"
        size="icon-sm"
        className="item__action size-6 hover:text-destructive"
        onClick={() => todos.remove(todo.id)}
        aria-label="删除任务"
      >
        <Trash2 className="size-3" />
      </Button>
    </div>
  );
}

function SnoozeBar({
  todoId,
  onSnooze,
}: {
  todoId: string;
  onSnooze: (id: string, minutes: number) => void;
}) {
  return (
    <div className="snooze">
      <span className="snooze__label">稍后提醒</span>
      {[5, 15, 60].map((minutes) => (
        <Button
          key={minutes}
          variant="outline"
          size="xs"
          className="snooze__chip h-5 rounded-md px-1.5 text-[10px]"
          onClick={() => onSnooze(todoId, minutes)}
        >
          {minutes >= 60 ? `${minutes / 60} 小时` : `${minutes} 分钟`}
        </Button>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="todo__empty">
      <ListTodo className="size-6 opacity-40" strokeWidth={1.2} />
      <span className="empty__title">还没有任务</span>
      <span className="empty__hint">
        输入子待办回车添加，或点右上角「项目」先建一个大项目
      </span>
    </div>
  );
}
