import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";

import { isTauri } from "./tauri";

/**
 * Single source of truth for the update flow.
 *
 * The settings view is unmounted whenever the user switches tabs, so the state
 * cannot live in the component — a download in progress has to survive that.
 * A tiny module-level store (wired to `useSyncExternalStore`) keeps the view
 * dumb and the installer handover deterministic.
 */

export type UpdateInfo = {
  repo: string;
  currentVersion: string;
  latestVersion: string;
  available: boolean;
  releaseName: string | null;
  notes: string | null;
  notesTruncated: boolean;
  publishedAt: string | null;
  releaseUrl: string | null;
  assetName: string | null;
  assetSize: number | null;
};

export type UpdateError = {
  code: string;
  message: string;
  detail?: string | null;
};

export type DownloadProgress = {
  downloaded: number;
  total: number | null;
  percent: number | null;
  speed: number | null;
};

export type UpdaterPhase =
  | "idle"
  | "checking"
  | "current"
  | "available"
  | "downloading"
  | "ready"
  | "installing"
  | "error";

export type UpdaterSnapshot = {
  phase: UpdaterPhase;
  info: UpdateInfo | null;
  progress: DownloadProgress | null;
  error: UpdateError | null;
  /** Secondary line (dev-mode hand-off, "已下载" etc). */
  note: string | null;
  checkedAt: number | null;
  installerPath: string | null;
  /** Bundle version read from the running binary, before any network call. */
  appVersion: string | null;
};

const PROGRESS_EVENT = "updater://progress";
/** Auto check a few seconds after launch so it never competes with startup. */
const AUTO_CHECK_DELAY = 6_000;

const initial: UpdaterSnapshot = {
  phase: "idle",
  info: null,
  progress: null,
  error: null,
  note: null,
  checkedAt: null,
  installerPath: null,
  appVersion: null,
};

let snapshot: UpdaterSnapshot = initial;
const listeners = new Set<() => void>();

function set(patch: Partial<UpdaterSnapshot>) {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return snapshot;
}

export function useUpdater(): UpdaterSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** The browser (vite-only) preview has no Rust backend to download with. */
export function isDesktopUpdateSupported(): boolean {
  return isTauri();
}

/** Commands reject with the serialised Rust error; keep unknown shapes usable. */
function toUpdateError(raw: unknown): UpdateError {
  if (raw && typeof raw === "object") {
    const candidate = raw as Partial<UpdateError>;
    if (typeof candidate.message === "string" && candidate.message.trim()) {
      return {
        code: typeof candidate.code === "string" ? candidate.code : "unknown",
        message: candidate.message,
        detail: candidate.detail ?? null,
      };
    }
  }
  if (typeof raw === "string" && raw.trim()) {
    return { code: "unknown", message: raw };
  }
  return { code: "unknown", message: "更新操作失败，请稍后重试" };
}

function isBusy(phase: UpdaterPhase): boolean {
  return phase === "checking" || phase === "downloading" || phase === "installing";
}

let initialised = false;

/**
 * Attach the progress listener and kick off one silent background check.
 * Safe to call more than once; only the first call does anything.
 */
export function initUpdater(): void {
  if (initialised) return;
  initialised = true;

  if (!isTauri()) return;

  void invoke<string>("app_version")
    .then((version) => set({ appVersion: version }))
    .catch(() => undefined);

  void listen<DownloadProgress>(PROGRESS_EVENT, (event) => {
    if (snapshot.phase !== "downloading") return;
    const payload = event.payload;
    set({
      progress: {
        downloaded: Number(payload?.downloaded ?? 0),
        total: payload?.total ?? null,
        percent: payload?.percent ?? null,
        speed: payload?.speed ?? null,
      },
    });
  });

  window.setTimeout(() => {
    void checkForUpdate({ silent: true });
  }, AUTO_CHECK_DELAY);
}

type CheckOptions = { silent?: boolean };

export async function checkForUpdate(options: CheckOptions = {}): Promise<void> {
  if (isBusy(snapshot.phase)) return;

  if (!isTauri()) {
    set({
      phase: "error",
      error: {
        code: "desktop_only",
        message: "浏览器预览中无法检查更新，请在桌面应用里使用",
      },
      checkedAt: Date.now(),
    });
    return;
  }

  const previous = snapshot.info;
  set({ phase: "checking", error: null, note: null });

  try {
    const info = await invoke<UpdateInfo>("update_check");
    set({
      phase: info.available ? "available" : "current",
      info,
      appVersion: info.currentVersion,
      // A silent check that finds nothing new should not wipe the version the
      // user is looking at, but it does supply a fresh `checkedAt`.
      checkedAt: Date.now(),
      progress: null,
      installerPath: null,
    });
  } catch (raw) {
    const error = toUpdateError(raw);
    // A failed background check would otherwise greet the user with an error
    // they never asked for; only surface it once they open the panel.
    set({
      phase: "error",
      error,
      info: previous,
      checkedAt: Date.now(),
      note: options.silent ? "后台检查更新失败" : null,
    });
  }
}

export async function downloadUpdate(): Promise<void> {
  if (!isTauri() || isBusy(snapshot.phase)) return;
  if (!snapshot.info?.available) return;

  set({
    phase: "downloading",
    error: null,
    note: null,
    progress: { downloaded: 0, total: snapshot.info.assetSize ?? null, percent: 0, speed: null },
  });

  try {
    const result = await invoke<{
      path: string;
      fileName: string;
      size: number;
      reused: boolean;
    }>("update_download");
    set({
      phase: "ready",
      installerPath: result.path,
      note: result.reused ? "安装包已存在，可直接安装" : "安装包下载完成",
      progress: {
        downloaded: result.size,
        total: result.size,
        percent: 100,
        speed: null,
      },
    });
  } catch (raw) {
    const error = toUpdateError(raw);
    if (error.code === "cancelled") {
      set({ phase: "available", progress: null, note: "已取消下载", error: null });
      return;
    }
    set({ phase: "error", error, progress: null });
  }
}

export async function cancelDownload(): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke<boolean>("update_cancel");
  } catch (raw) {
    console.error("update_cancel failed", raw);
  }
}

export async function installUpdate(): Promise<void> {
  if (!isTauri() || snapshot.phase !== "ready") return;

  set({ phase: "installing", error: null, note: null });
  try {
    const result = await invoke<{ launched: boolean; message: string }>("update_install");
    if (result.launched) {
      set({ note: result.message });
      return;
    }
    // Dev builds are never overwritten — reveal the installer instead.
    set({ phase: "ready", note: result.message });
    if (snapshot.installerPath) {
      await revealItemInDir(snapshot.installerPath).catch(() => undefined);
    }
  } catch (raw) {
    set({ phase: "ready", error: toUpdateError(raw) });
  }
}

export async function openReleasePage(): Promise<void> {
  const url =
    snapshot.info?.releaseUrl ??
    (snapshot.info ? `https://github.com/${snapshot.info.repo}/releases` : null);
  if (!url) return;
  await openUrl(url).catch((raw) => console.error("openUrl failed", raw));
}

export async function revealInstaller(): Promise<void> {
  if (!snapshot.installerPath) return;
  await revealItemInDir(snapshot.installerPath).catch((raw) =>
    console.error("revealItemInDir failed", raw),
  );
}

/** Drop a failed state so the panel goes back to the neutral "idle" look. */
export function dismissError(): void {
  if (snapshot.phase !== "error") return;
  set({ phase: snapshot.info?.available ? "available" : "idle", error: null });
}
