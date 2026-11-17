import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** True when running inside the Tauri shell (false in a plain browser tab). */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Ask the Rust shell to collapse or expand — this also toggles click-through. */
export async function requestExpanded(expanded: boolean): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke("set_expanded", { expanded });
  } catch (error) {
    console.error("set_expanded failed", error);
  }
}

export async function quitApp(): Promise<void> {
  if (!isTauri()) return;
  await invoke("quit_app");
}

/** Resize the island; the native window follows and re-centers. */
export async function setGeometry(
  width: number,
  height: number,
  capsuleWidth: number,
  capsuleHeight: number,
): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke("set_geometry", {
      width,
      height,
      capsuleWidth,
      capsuleHeight,
    });
  } catch (error) {
    console.error("set_geometry failed", error);
  }
}

/** Tell the native cursor watcher how the island should be woken up. */
export async function setTriggerMode(mode: string): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke("set_trigger_mode", { mode });
  } catch (error) {
    console.error("set_trigger_mode failed", error);
  }
}

/** Switch the collapsed shape: a small dot (true) or the full capsule. */
export async function setDotMode(enabled: boolean): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke("set_dot_mode", { enabled });
  } catch (error) {
    console.error("set_dot_mode failed", error);
  }
}

type Handler = () => void;

function subscribe(event: string, handler: Handler): Promise<UnlistenFn> {
  if (!isTauri()) return Promise.resolve(() => {});
  return listen(event, () => handler());
}

export const onNotchOpen = (handler: Handler) =>
  subscribe("notch-open", handler);

export const onNotchClose = (handler: Handler) =>
  subscribe("notch-close", handler);

/** Tray menu "检查更新" — the panel owns the update UI. */
export const onUpdateCheckRequest = (handler: Handler) =>
  subscribe("updater://check-request", handler);
