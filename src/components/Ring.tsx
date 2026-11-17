type RingProps = {
  /** Remaining fraction, 1 = full, 0 = elapsed. */
  progress: number;
  time: string;
  label: string;
  done: boolean;
};

const SIZE = 206;
const CENTER = SIZE / 2;
const STROKE = 5;
const RADIUS = CENTER - STROKE - 4;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function Ring({ progress, time, label, done }: RingProps) {
  const clamped = Math.max(0, Math.min(1, progress));

  return (
    <div className="ring" data-done={done}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <defs>
          <linearGradient id="ring-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ffc45e" />
            <stop offset="100%" stopColor="#ff9500" />
          </linearGradient>
        </defs>

        <circle
          cx={CENTER}
          cy={CENTER}
          r={RADIUS}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={STROKE}
        />

        <circle
          className="ring__progress"
          cx={CENTER}
          cy={CENTER}
          r={RADIUS}
          fill="none"
          stroke={done ? "rgba(255,159,10,0.45)" : "url(#ring-gradient)"}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - clamped)}
          style={{ filter: done ? "none" : "drop-shadow(0 0 6px rgba(255,159,10,0.35))" }}
        />
      </svg>

      <div className="ring__center">
        <span className="ring__time">{time}</span>
        <span className="ring__label">{label}</span>
      </div>
    </div>
  );
}
