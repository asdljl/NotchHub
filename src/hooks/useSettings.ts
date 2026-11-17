import { useCallback } from "react";
import { usePersistentState } from "../lib/storage";

export type TriggerMode = "hover" | "click" | "both";

export const TRIGGER_MODES: Array<{
  id: TriggerMode;
  label: string;
  hint: string;
}> = [
  {
    id: "hover",
    label: "悬浮展开",
    hint: "鼠标移到刘海上就展开，离开后自动收起",
  },
  {
    id: "click",
    label: "点击展开",
    hint: "鼠标经过不会展开，点一下刘海才展开",
  },
  {
    id: "both",
    label: "悬浮或点击",
    hint: "悬浮即展开，点击同样有效",
  },
];

/** Collapsed dot diameter in logical pixels. Mirrors `DOT_SIZE` in lib.rs. */
export const DOT_SIZE = 26;

export type Settings = {
  /**
   * When true the collapsed island is just a small round dot instead of the
   * full capsule. This is the default look.
   */
  dotMode: boolean;
  /** Background opacity of the island, 0.72 - 1. */
  opacity: number;
  /** Expanded panel width in logical pixels. */
  panelWidth: number;
  /** Expanded panel height in logical pixels. */
  panelHeight: number;
  /** Collapsed capsule width in logical pixels. */
  capsuleWidth: number;
  /** Collapsed capsule height in logical pixels. */
  capsuleHeight: number;
  /** What wakes the island up. */
  trigger: TriggerMode;
};

export const SETTINGS_LIMITS = {
  opacity: { min: 0.72, max: 1, step: 0.01 },
  panelWidth: { min: 320, max: 560, step: 10 },
  panelHeight: { min: 360, max: 680, step: 10 },
  capsuleWidth: { min: 160, max: 300, step: 4 },
  capsuleHeight: { min: 26, max: 48, step: 1 },
} as const;

export const DEFAULT_SETTINGS: Settings = {
  dotMode: true,
  opacity: 1,
  panelWidth: 380,
  panelHeight: 480,
  capsuleWidth: 240,
  capsuleHeight: 36,
  trigger: "hover",
};

const STORAGE_KEY = "notchhub.settings.v1";

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function revive(raw: unknown): Settings {
  if (!raw || typeof raw !== "object") return DEFAULT_SETTINGS;
  const value = raw as Partial<Settings>;
  return {
    // Missing on installs from before dot mode existed — the default look wins.
    dotMode:
      typeof value.dotMode === "boolean"
        ? value.dotMode
        : DEFAULT_SETTINGS.dotMode,
    opacity: clamp(
      value.opacity,
      SETTINGS_LIMITS.opacity.min,
      SETTINGS_LIMITS.opacity.max,
      DEFAULT_SETTINGS.opacity,
    ),
    panelWidth: Math.round(
      clamp(
        value.panelWidth,
        SETTINGS_LIMITS.panelWidth.min,
        SETTINGS_LIMITS.panelWidth.max,
        DEFAULT_SETTINGS.panelWidth,
      ),
    ),
    panelHeight: Math.round(
      clamp(
        value.panelHeight,
        SETTINGS_LIMITS.panelHeight.min,
        SETTINGS_LIMITS.panelHeight.max,
        DEFAULT_SETTINGS.panelHeight,
      ),
    ),
    capsuleWidth: Math.round(
      clamp(
        value.capsuleWidth,
        SETTINGS_LIMITS.capsuleWidth.min,
        SETTINGS_LIMITS.capsuleWidth.max,
        DEFAULT_SETTINGS.capsuleWidth,
      ),
    ),
    capsuleHeight: Math.round(
      clamp(
        value.capsuleHeight,
        SETTINGS_LIMITS.capsuleHeight.min,
        SETTINGS_LIMITS.capsuleHeight.max,
        DEFAULT_SETTINGS.capsuleHeight,
      ),
    ),
    trigger: TRIGGER_MODES.some((mode) => mode.id === value.trigger)
      ? (value.trigger as TriggerMode)
      : DEFAULT_SETTINGS.trigger,
  };
}

export function useSettings() {
  const [settings, setSettings] = usePersistentState<Settings>(
    STORAGE_KEY,
    DEFAULT_SETTINGS,
    revive,
  );

  const update = useCallback(
    <K extends keyof Settings>(key: K, value: Settings[K]) => {
      setSettings((prev) => ({ ...prev, [key]: value }));
    },
    [setSettings],
  );

  const reset = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
  }, [setSettings]);

  const isDefault = (Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>).every(
    (key) => settings[key] === DEFAULT_SETTINGS[key],
  );

  return { settings, update, reset, isDefault };
}

export type SettingsApi = ReturnType<typeof useSettings>;
