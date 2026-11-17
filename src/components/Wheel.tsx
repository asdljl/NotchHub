import { useCallback, useEffect, useRef } from "react";

const ITEM_HEIGHT = 44;
const DRAG_THRESHOLD = 3;

type WheelProps = {
  value: number;
  count: number;
  onChange: (value: number) => void;
  /** Unit rendered next to the number, e.g. "h" / "m" / "s". */
  suffix?: string;
  disabled?: boolean;
};

type DragState = {
  pointerId: number;
  startY: number;
  startTop: number;
  moved: boolean;
};

/**
 * Scroll-snap wheel column, driven by three inputs: the mouse wheel, press-and-
 * drag, and programmatic scrolling from presets.
 *
 * Two things need coordinating. Snapping fights a drag, so it is switched off
 * inline while the pointer is down. And a drag calls `onChange`, which changes
 * `value`, which would normally trigger a programmatic `scrollTo` — so that
 * effect bails out while a drag is in flight.
 */
export function Wheel({
  value,
  count,
  onChange,
  suffix,
  disabled = false,
}: WheelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const programmatic = useRef(false);
  const releaseTimer = useRef<number | null>(null);
  const snapTimer = useRef<number | null>(null);
  const drag = useRef<DragState | null>(null);

  const release = useCallback((delay: number) => {
    if (releaseTimer.current !== null) window.clearTimeout(releaseTimer.current);
    releaseTimer.current = window.setTimeout(() => {
      programmatic.current = false;
      releaseTimer.current = null;
    }, delay);
  }, []);

  const restoreSnap = useCallback((delay: number) => {
    if (snapTimer.current !== null) window.clearTimeout(snapTimer.current);
    snapTimer.current = window.setTimeout(() => {
      const el = ref.current;
      if (el) el.style.scrollSnapType = "";
      snapTimer.current = null;
    }, delay);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const settle = () => {
      programmatic.current = false;
    };
    el.addEventListener("scrollend", settle);

    // initial placement, without letting scroll events rewrite the value
    programmatic.current = true;
    el.scrollTop = value * ITEM_HEIGHT;
    release(120);

    return () => {
      el.removeEventListener("scrollend", settle);
      if (releaseTimer.current !== null) window.clearTimeout(releaseTimer.current);
      if (snapTimer.current !== null) window.clearTimeout(snapTimer.current);
    };
    // mount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Never fight the pointer: while dragging, the drag owns scroll position.
    if (drag.current) return;

    const target = value * ITEM_HEIGHT;
    if (Math.abs(el.scrollTop - target) > 2) {
      programmatic.current = true;
      el.scrollTo({ top: target, behavior: "smooth" });
      release(700);
    }
  }, [value, release]);

  const handleScroll = () => {
    const el = ref.current;
    if (!el || disabled || programmatic.current) return;
    const index = Math.round(el.scrollTop / ITEM_HEIGHT);
    const next = Math.max(0, Math.min(count - 1, index));
    if (next !== value) onChange(next);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) return;
    const el = ref.current;
    if (!el) return;

    if (snapTimer.current !== null) {
      window.clearTimeout(snapTimer.current);
      snapTimer.current = null;
    }

    drag.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startTop: el.scrollTop,
      moved: false,
    };

    el.setPointerCapture(event.pointerId);
    el.style.scrollSnapType = "none";
    el.style.scrollBehavior = "auto";
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    const state = drag.current;
    if (!el || !state || state.pointerId !== event.pointerId) return;

    const delta = event.clientY - state.startY;
    if (!state.moved && Math.abs(delta) > DRAG_THRESHOLD) state.moved = true;
    if (state.moved) el.scrollTop = state.startTop - delta;
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    const state = drag.current;
    drag.current = null;
    if (!el || !state) return;

    if (el.hasPointerCapture(event.pointerId)) {
      el.releasePointerCapture(event.pointerId);
    }

    // Settle on the nearest slot, then hand control back to scroll-snap.
    const index = Math.round(el.scrollTop / ITEM_HEIGHT);
    const next = Math.max(0, Math.min(count - 1, index));

    el.style.scrollSnapType = "none";
    el.scrollTo({ top: next * ITEM_HEIGHT, behavior: "smooth" });
    el.style.scrollBehavior = "";
    restoreSnap(340);

    if (next !== value) onChange(next);
  };

  return (
    <div
      ref={ref}
      className="wheel"
      onScroll={handleScroll}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      style={disabled ? { overflow: "hidden", pointerEvents: "none" } : undefined}
    >
      {Array.from({ length: count }, (_, index) => (
        <div className="wheel__item" key={index} data-active={index === value}>
          <span className="wheel__num">{index < 10 ? `0${index}` : index}</span>
          {suffix ? <span className="wheel__suffix">{suffix}</span> : null}
        </div>
      ))}
    </div>
  );
}
