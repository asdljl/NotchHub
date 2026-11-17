import { useState } from "react";
import { Play, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Wheel } from "./Wheel";

const PRESETS = [1, 5, 10, 25];

type TimerCreateProps = {
  onCancel: () => void;
  onCreate: (title: string, durationMs: number) => void;
};

export function TimerCreate({ onCancel, onCreate }: TimerCreateProps) {
  const [hours, setHours] = useState(0);
  const [minutes, setMinutes] = useState(5);
  const [seconds, setSeconds] = useState(0);
  const [title, setTitle] = useState("");

  const totalMs = (hours * 3_600 + minutes * 60 + seconds) * 1_000;
  const canStart = totalMs >= 1_000;

  const applyPreset = (minutes_: number) => {
    setHours(Math.floor(minutes_ / 60));
    setMinutes(minutes_ % 60);
    setSeconds(0);
  };

  return (
    <div className="timer-create">
      <div className="create-head">
        <Button
          variant="ghost"
          size="icon-sm"
          className="ghost-btn size-6"
          onClick={onCancel}
          aria-label="返回"
        >
          <X className="size-3" strokeWidth={2.2} />
        </Button>
        <Input
          className="create-title h-8 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="计时器标题（可选）"
          maxLength={40}
          spellCheck={false}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.nativeEvent.isComposing &&
              canStart
            ) {
              onCreate(title, totalMs);
            }
          }}
        />
      </div>

      <div className="create-body">
        <div className="wheels">
          <Wheel value={hours} count={24} suffix="h" onChange={setHours} />
          <span className="wheel-sep">:</span>
          <Wheel value={minutes} count={60} suffix="m" onChange={setMinutes} />
          <span className="wheel-sep">:</span>
          <Wheel value={seconds} count={60} suffix="s" onChange={setSeconds} />
        </div>

        <div className="create-side">
          <Button
            className="play-big size-10 rounded-xl"
            size="icon-lg"
            disabled={!canStart}
            onClick={() => onCreate(title, totalMs)}
            aria-label="开始计时"
          >
            <Play className="size-4 fill-current" />
          </Button>

          <div className="preset-grid">
            {PRESETS.map((preset) => (
              <Button
                key={preset}
                className="preset-chip"
                variant={
                  totalMs === preset * 60_000 ? "default" : "secondary"
                }
                size="xs"
                onClick={() => applyPreset(preset)}
              >
                {preset}m
              </Button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
