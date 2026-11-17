let context: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  if (!context) context = new Ctor();
  return context;
}

/**
 * A soft three-note chime synthesized on the fly — no audio assets needed.
 */
export function playChime(): void {
  const ctx = getContext();
  if (!ctx) return;

  if (ctx.state === "suspended") void ctx.resume();

  const notes = [880, 1108.73, 1318.51];
  const start = ctx.currentTime + 0.02;

  notes.forEach((frequency, index) => {
    const at = start + index * 0.17;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(frequency, at);

    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.16, at + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.75);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 0.8);
  });
}

/** Unlock audio on the first real user gesture (browser autoplay policy). */
export function warmUpAudio(): void {
  const ctx = getContext();
  if (ctx && ctx.state === "suspended") void ctx.resume();
}
