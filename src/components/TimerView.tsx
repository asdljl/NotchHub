import { useState } from "react";
import { TimerCreate } from "./TimerCreate";
import { TimerList } from "./TimerList";
import type { TimersApi } from "../hooks/useTimers";

export function TimerView({ timers }: { timers: TimersApi }) {
  const [creating, setCreating] = useState(false);

  if (creating) {
    return (
      <TimerCreate
        onCancel={() => setCreating(false)}
        onCreate={(title, durationMs) => {
          timers.create(title, durationMs);
          setCreating(false);
        }}
      />
    );
  }

  return <TimerList timers={timers} onCreate={() => setCreating(true)} />;
}
