import { Pause, Play, Plus, Timer, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDuration } from "../lib/format";
import type { TimerItem, TimersApi } from "../hooks/useTimers";

type TimerListProps = {
  timers: TimersApi;
  onCreate: () => void;
};

export function TimerList({ timers, onCreate }: TimerListProps) {
  const doneCount = timers.timers.filter(
    (timer) => timer.phase === "done",
  ).length;

  return (
    <div className="timer-list">
      <div className="timer-list__head">
        <Button
          className="add-timer"
          size="sm"
          onClick={onCreate}
          disabled={timers.isFull}
          title={timers.isFull ? "最多同时运行 12 个计时器" : "新建计时器"}
        >
          <Plus className="size-3.5" strokeWidth={2.6} />
          新建计时器
        </Button>

        {doneCount > 0 ? (
          <Button
            variant="ghost"
            size="xs"
            className="clear-done text-success hover:bg-success/12 hover:text-success"
            onClick={timers.clearDone}
            title="从列表中移除已完成的计时器"
          >
            清除已完成 · {doneCount}
          </Button>
        ) : null}
      </div>

      {timers.timers.length === 0 ? (
        <div className="timer-empty">
          <Timer className="size-7 opacity-40" strokeWidth={1.2} />
          <span className="empty__title">还没有计时器</span>
          <span className="empty__hint">用上面的按钮选好时长开始</span>
        </div>
      ) : (
        <div className="timer-rows">
          {timers.timers.map((timer) => (
            <TimerRow key={timer.id} timer={timer} api={timers} />
          ))}
        </div>
      )}
    </div>
  );
}

function TimerRow({ timer, api }: { timer: TimerItem; api: TimersApi }) {
  const remaining = api.remainingOf(timer);
  const done = timer.phase === "done";
  const paused = timer.phase === "paused";
  const progress =
    timer.durationMs > 0 ? Math.max(0, Math.min(1, remaining / timer.durationMs)) : 0;

  const toggle = () => {
    if (timer.phase === "running") api.pause(timer.id);
    else if (timer.phase === "paused") api.resume(timer.id);
    else api.restart(timer.id);
  };

  return (
    <div className="timer-row" data-phase={timer.phase}>
      <ProgressRing progress={progress} done={done} paused={paused} />

      <div className="timer-row__body">
        {timer.title || done || paused ? (
          <span className="timer-row__meta">
            <span className="timer-row__title" title={timer.title}>
              {timer.title}
            </span>
            {done ? (
              <Badge variant="success">已完成</Badge>
            ) : paused ? (
              <Badge variant="secondary">已暂停</Badge>
            ) : null}
          </span>
        ) : null}
        <span className="timer-row__time">
          {done ? "0:00" : formatDuration(remaining)}
        </span>
      </div>

      <Button
        variant="ghost"
        size="icon-sm"
        className="row-btn size-6"
        onClick={toggle}
        aria-label={timer.phase === "running" ? "暂停" : "开始"}
      >
        {timer.phase === "running" ? (
          <Pause className="size-3" />
        ) : (
          <Play className="size-3" />
        )}
      </Button>

      <Button
        variant="ghost"
        size="icon-sm"
        className="row-btn size-6 hover:text-destructive"
        onClick={() => api.remove(timer.id)}
        aria-label="删除计时器"
      >
        <X className="size-3" strokeWidth={2.2} />
      </Button>
    </div>
  );
}

function ProgressRing({
  progress,
  done,
  paused,
}: {
  progress: number;
  done: boolean;
  paused: boolean;
}) {
  const radius = 9;
  const circumference = 2 * Math.PI * radius;

  return (
    <svg className="progress-ring" viewBox="0 0 24 24" width={24} height={24}>
      <circle
        cx="12"
        cy="12"
        r={radius}
        fill="none"
        stroke="rgba(255,255,255,0.16)"
        strokeWidth="2"
      />
      <circle
        cx="12"
        cy="12"
        r={radius}
        fill="none"
        stroke={done ? "var(--ok)" : paused ? "rgba(255,255,255,0.45)" : "var(--accent)"}
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - progress)}
        transform="rotate(-90 12 12)"
        style={{ transition: "stroke-dashoffset 140ms linear" }}
      />
      <circle
        cx="12"
        cy="12"
        r="1.9"
        fill={done ? "var(--ok)" : paused ? "rgba(255,255,255,0.4)" : "rgba(89,167,255,0.75)"}
      />
    </svg>
  );
}
