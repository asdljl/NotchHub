import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { isTauri } from "./tauri";

let permissionChecked = false;
let granted = false;

async function ensurePermission(): Promise<boolean> {
  if (permissionChecked) return granted;
  permissionChecked = true;

  try {
    granted = await isPermissionGranted();
    if (!granted) {
      granted = (await requestPermission()) === "granted";
    }
  } catch {
    granted = false;
  }

  return granted;
}

/** Ask for the notification permission up-front so the first alert is not lost. */
export async function warmUpNotifications(): Promise<void> {
  if (!isTauri()) return;
  await ensurePermission();
}

/**
 * Fire a system notification. Falls back to a no-op in a plain browser, where
 * the in-app banner still communicates what happened.
 */
export async function notify(title: string, body: string): Promise<void> {
  if (!isTauri()) return;

  try {
    if (!(await ensurePermission())) return;
    sendNotification({ title, body });
  } catch {
    /* permission denied or plugin unavailable — the UI already reacted */
  }
}
