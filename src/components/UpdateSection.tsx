import { useMemo } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Download,
  ExternalLink,
  FolderOpen,
  Loader2,
  RefreshCw,
  Sparkles,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { formatBytes, formatSpeed } from "@/lib/format";
import {
  cancelDownload,
  checkForUpdate,
  downloadUpdate,
  installUpdate,
  isDesktopUpdateSupported,
  openReleasePage,
  revealInstaller,
  useUpdater,
} from "@/lib/updater";

/**
 * Release notes arrive as raw GitHub markdown. Rendering a full markdown tree
 * is overkill for a 340px card, so the syntax that would otherwise leak
 * (`##`, `**`, `[text](url)`, images, HTML comments) is stripped instead.
 */
function normalizeNotes(raw: string): string {
  const lines = raw
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => {
      // Badge rows (`[![x](y)](z)`) are pure noise in a text card.
      if (/^\s*\[!\[/.test(line)) return "";
      return line
        .replace(/<!--.*?-->/g, "")
        .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/^#{1,6}\s*/, "")
        .replace(/^\s*>\s?/, "")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/__([^_]+)__/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/^\s*[-*]\s+/, "· ")
        .trimEnd();
    });

  const collapsed: string[] = [];
  for (const line of lines) {
    if (!line.trim() && collapsed.length > 0 && !collapsed[collapsed.length - 1].trim()) {
      continue;
    }
    collapsed.push(line);
  }
  return collapsed.join("\n").trim();
}

function clockLabel(timestamp: number | null): string {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function UpdateSection() {
  const state = useUpdater();
  const { phase, info, progress, error, note, checkedAt, appVersion } = state;

  const version = info?.currentVersion ?? appVersion;
  const notes = useMemo(
    () => (info?.notes ? normalizeNotes(info.notes) : ""),
    [info?.notes],
  );

  const busy = phase === "checking" || phase === "downloading" || phase === "installing";
  const desktop = isDesktopUpdateSupported();

  const status = (() => {
    switch (phase) {
      case "checking":
        return "正在连接 GitHub…";
      case "current":
        return checkedAt ? `已是最新版本 · ${clockLabel(checkedAt)}` : "已是最新版本";
      case "available":
        return info?.publishedAt
          ? `发现新版本 · 发布于 ${info.publishedAt.slice(0, 10)}`
          : "发现新版本";
      case "downloading":
        return "正在下载安装包";
      case "ready":
        return note ?? "安装包已就绪";
      case "installing":
        return "正在安装，应用即将重启";
      case "error":
        return note ?? "检查更新时出错";
      default:
        return desktop ? "尚未检查更新" : "浏览器预览不支持更新";
    }
  })();

  const percent = progress?.percent ?? 0;
  const downloaded = progress?.downloaded ?? 0;
  const total = progress?.total ?? info?.assetSize ?? null;
  const speed = formatSpeed(progress?.speed ?? null);
  const repo = info?.repo ?? null;

  return (
    <>
      <div className="settings__intro">
        <span className="flex items-center gap-1.5">
          <Sparkles className="size-3 text-primary" />
          更新
        </span>
        <span className="settings__sub">
          {version ? `当前 v${version}` : desktop ? "尚未读取版本" : "仅桌面端可用"}
        </span>
      </div>

      <div className="settings__list">
        <div className="update__head">
          <div className="update__version">
            <span className="update__version-line">
              {info?.available ? (
                <>
                  v{info.currentVersion}
                  <ArrowRight className="mx-1 inline size-3 align-[-2px] text-primary" />
                  <span className="text-primary">v{info.latestVersion}</span>
                </>
              ) : (
                <>NotchHub {version ? `v${version}` : ""}</>
              )}
            </span>
            <span className="update__version-sub">
              {busy && <Loader2 className="mr-1 inline size-2.5 animate-spin" />}
              {status}
            </span>
          </div>

          <Button
            size="xs"
            variant="outline"
            className="shrink-0"
            onClick={() => void checkForUpdate()}
            disabled={busy || !desktop}
            aria-label="检查更新"
          >
            <RefreshCw className={phase === "checking" ? "size-3 animate-spin" : "size-3"} />
            {phase === "current" ? "重新检查" : "检查更新"}
          </Button>
        </div>

        {info?.available && notes && (
          <div className="update__notes" tabIndex={0}>
            <div className="update__notes-title">
              更新内容
              {info.notesTruncated && <span className="update__notes-more">（已截断）</span>}
            </div>
            {notes}
          </div>
        )}

        {info?.available && !info.assetName && (
          <div className="update__body">
            <div className="update__error">
              <AlertTriangle className="size-3 shrink-0" />
              <span>该版本没有提供 Windows 安装包，请到发布页手动下载。</span>
            </div>
            <Button size="xs" variant="outline" onClick={() => void openReleasePage()}>
              <ExternalLink className="size-3" />
              打开发布页
            </Button>
          </div>
        )}

        {phase === "downloading" && (
          <div className="update__body">
            <div className="update__progress">
              <Progress value={percent} />
              <div className="update__meta">
                <span>
                  {formatBytes(downloaded)}
                  {total ? ` / ${formatBytes(total)}` : ""}
                </span>
                <span>
                  {percent > 0 ? `${Math.floor(percent)}%` : "准备中"}
                  {speed ? ` · ${speed}` : ""}
                </span>
              </div>
            </div>
            <div className="update__actions">
              <Button size="xs" variant="ghost" onClick={() => void cancelDownload()}>
                取消下载
              </Button>
            </div>
          </div>
        )}

        {error && (
          <div className="update__body">
            <div className="update__error">
              <AlertTriangle className="mt-px size-3 shrink-0" />
              <div>
                <div>{error.message}</div>
                {error.detail && (
                  <div className="update__error-detail" title={error.detail}>
                    {error.detail}
                  </div>
                )}
              </div>
            </div>
            <div className="update__actions">
              {state.installerPath ? (
                <>
                  <Button size="xs" variant="outline" onClick={() => void installUpdate()}>
                    <Download className="size-3" />
                    重新安装
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => void revealInstaller()}>
                    <FolderOpen className="size-3" />
                    打开文件
                  </Button>
                </>
              ) : (
                <>
                  <Button size="xs" variant="outline" onClick={() => void checkForUpdate()}>
                    <RefreshCw className="size-3" />
                    重试
                  </Button>
                  {(info?.releaseUrl || repo) && (
                    <Button size="xs" variant="ghost" onClick={() => void openReleasePage()}>
                      <ExternalLink className="size-3" />
                      发布页
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {phase === "available" && info?.assetName && (
          <div className="update__body">
            <div className="update__meta">
              <span className="truncate">{info.assetName}</span>
              {info.assetSize ? <span>{formatBytes(info.assetSize)}</span> : null}
            </div>
            <div className="update__actions">
              <Button size="xs" className="flex-1" onClick={() => void downloadUpdate()}>
                <Download className="size-3" />
                下载并安装
              </Button>
              <Button size="xs" variant="ghost" onClick={() => void openReleasePage()}>
                <ExternalLink className="size-3" />
                发布页
              </Button>
            </div>
          </div>
        )}

        {phase === "ready" && !error && (
          <div className="update__body">
            <div className="update__ready">
              <CheckCircle2 className="size-3 text-success" />
              <span>安装包已下载，安装时应用会退出并自动重启。</span>
            </div>
            <div className="update__actions">
              <Button size="xs" className="flex-1" onClick={() => void installUpdate()}>
                <Download className="size-3" />
                安装并重启
              </Button>
              <Button size="xs" variant="ghost" onClick={() => void revealInstaller()}>
                <FolderOpen className="size-3" />
                打开文件
              </Button>
            </div>
          </div>
        )}

        {phase === "current" && (
          <div className="update__body">
            <div className="update__ready">
              <CheckCircle2 className="size-3 text-success" />
              <span>当前已是最新版本，无需更新。</span>
            </div>
          </div>
        )}

        <div className="update__foot">
          <span className="update__hint">
            {repo ? `发布源 github.com/${repo}` : "通过 GitHub Releases 获取更新"}
          </span>
          {info?.available && (
            <Badge variant="default" className="shrink-0">
              有新版本
            </Badge>
          )}
        </div>
      </div>
    </>
  );
}
