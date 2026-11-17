//! Online updates backed by GitHub Releases.
//!
//! The flow is deliberately split into three commands so the UI can narrate it:
//!
//! 1. [`update_check`] — read the current version from the bundle metadata,
//!    ask the GitHub REST API for the newest release and compare the tags.
//! 2. [`update_download`] — stream the matching installer into the app cache
//!    directory, emitting `updater://progress` events along the way, and verify
//!    both the advertised size and (when GitHub publishes one) the SHA-256
//!    digest.
//! 3. [`update_install`] — hand over to the downloaded installer and exit, so
//!    the installer can replace the running binary and relaunch it.
//!
//! Why not the official updater plugin: it requires a signing key pair plus a
//! `latest.json` manifest attached to every release. Talking to the Releases
//! API directly keeps "publish a tag + upload the installer" as the whole
//! release procedure, at the cost of trusting GitHub's HTTPS + asset digest
//! instead of a signed manifest.
//!
//! Build-time configuration (all optional, sensible defaults below):
//!
//! * `NOTCHHUB_UPDATE_REPO` — `owner/repo` or a full GitHub URL.
//! * `NOTCHHUB_GITHUB_API` — API base, for GitHub Enterprise or a mirror.
//! * `NOTCHHUB_GITHUB_TOKEN` — runtime-only, raises the 60 req/h anonymous
//!   rate limit (also needed for assets of private repositories).

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Where releases are published when nothing else is configured.
const DEFAULT_REPO: &str = "qdy/NotchHub";
const DEFAULT_API: &str = "https://api.github.com";

/// Event channel the front end listens to for download progress.
const PROGRESS_EVENT: &str = "updater://progress";

/// Keeps a windowless `cmd.exe` from flashing a console when we hand over to
/// the installer.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Release notes are rendered in a small scroll box, so a 40 KB changelog
/// would only cost IPC bandwidth.
const MAX_NOTES_CHARS: usize = 6_000;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

fn env_setting(runtime: &str, build: Option<&'static str>, fallback: &str) -> String {
    if let Ok(value) = std::env::var(runtime) {
        let value = value.trim().to_string();
        if !value.is_empty() {
            return value;
        }
    }
    if let Some(value) = build {
        if !value.trim().is_empty() {
            return value.trim().to_string();
        }
    }
    fallback.to_string()
}

/// `owner/repo`, tolerant of a pasted URL or a `git@` remote.
pub fn repo_slug() -> String {
    normalize_repo(&env_setting(
        "NOTCHHUB_UPDATE_REPO",
        option_env!("NOTCHHUB_UPDATE_REPO"),
        DEFAULT_REPO,
    ))
}

fn normalize_repo(raw: &str) -> String {
    let trimmed = raw.trim().trim_end_matches('/');
    let without_host = trimmed
        .trim_start_matches("https://github.com/")
        .trim_start_matches("http://github.com/")
        .trim_start_matches("git@github.com:");
    without_host
        .trim_end_matches(".git")
        .trim_matches('/')
        .to_string()
}

fn api_base() -> String {
    env_setting(
        "NOTCHHUB_GITHUB_API",
        option_env!("NOTCHHUB_GITHUB_API"),
        DEFAULT_API,
    )
    .trim_end_matches('/')
    .to_string()
}

fn github_token() -> Option<String> {
    std::env::var("NOTCHHUB_GITHUB_TOKEN")
        .ok()
        .map(|token| token.trim().to_string())
        .filter(|token| !token.is_empty())
}

fn user_agent() -> String {
    format!("NotchHub/{}", env!("CARGO_PKG_VERSION"))
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/// Command error payload. `code` is stable enough for the UI to branch on,
/// `message` is already user-facing Chinese, `detail` carries the raw cause for
/// the "展开详情" affordance instead of being thrown away.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateError {
    pub code: &'static str,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl UpdateError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            detail: None,
        }
    }

    fn detail(mut self, detail: impl Into<String>) -> Self {
        let detail = detail.into();
        if !detail.trim().is_empty() {
            self.detail = Some(detail);
        }
        self
    }

    fn io(err: std::io::Error, action: &str) -> Self {
        Self::new("io", format!("{action}失败")).detail(err.to_string())
    }
}

fn snippet(body: &str, limit: usize) -> String {
    let flattened = body.split_whitespace().collect::<Vec<_>>().join(" ");
    if flattened.chars().count() <= limit {
        flattened
    } else {
        let cut: String = flattened.chars().take(limit).collect();
        format!("{cut}…")
    }
}

fn map_request_error(err: reqwest::Error) -> UpdateError {
    let (code, message) = if err.is_timeout() {
        (
            "timeout",
            "连接 GitHub 超时，请检查网络或代理设置后重试",
        )
    } else if err.is_connect() {
        ("connect", "无法连接 GitHub，请检查网络、DNS 或系统代理")
    } else if err.is_decode() {
        ("decode", "更新信息解析失败，请稍后重试")
    } else {
        ("network", "网络请求失败，请稍后重试")
    };
    UpdateError::new(code, message).detail(err.to_string())
}

fn status_error(status: reqwest::StatusCode, body: &str) -> UpdateError {
    let detail = snippet(body, 300);
    match status.as_u16() {
        404 => UpdateError::new(
            "not_found",
            "没有找到可用的发布版本（仓库地址或 Release 可能尚未创建）",
        )
        .detail(detail),
        403 | 429 if body.to_ascii_lowercase().contains("rate limit") => UpdateError::new(
            "rate_limit",
            "GitHub 接口调用次数已达上限，请稍后再试",
        )
        .detail(detail),
        403 => {
            UpdateError::new("forbidden", "更新仓库拒绝访问，请确认仓库是否公开").detail(detail)
        }
        500..=599 => UpdateError::new(
            "server",
            format!("GitHub 服务暂时不可用（HTTP {}）", status.as_u16()),
        )
        .detail(detail),
        code => UpdateError::new("http", format!("检查更新失败（HTTP {code}）")).detail(detail),
    }
}

// ---------------------------------------------------------------------------
// GitHub payloads
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct Release {
    tag_name: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    published_at: Option<String>,
    #[serde(default)]
    html_url: Option<String>,
    #[serde(default)]
    assets: Vec<Asset>,
}

#[derive(Debug, Clone, Deserialize)]
struct Asset {
    name: String,
    #[serde(default)]
    size: u64,
    browser_download_url: String,
    #[serde(default)]
    digest: Option<String>,
}

/// What the settings panel renders.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub repo: String,
    pub current_version: String,
    pub latest_version: String,
    pub available: bool,
    pub release_name: Option<String>,
    pub notes: Option<String>,
    pub notes_truncated: bool,
    pub published_at: Option<String>,
    pub release_url: Option<String>,
    pub asset_name: Option<String>,
    pub asset_size: Option<u64>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DownloadOutcome {
    pub path: String,
    pub file_name: String,
    pub size: u64,
    pub reused: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InstallOutcome {
    pub launched: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressPayload {
    downloaded: u64,
    total: Option<u64>,
    percent: Option<f64>,
    /// Bytes per second over the whole transfer so far.
    speed: Option<f64>,
}

/// Last check result. Kept in Rust so `update_download` never has to trust a
/// URL that travelled through the webview.
#[derive(Clone)]
struct Pending {
    info: UpdateInfo,
    asset: Option<Asset>,
}

#[derive(Default)]
pub struct UpdaterState {
    last: Mutex<Option<Pending>>,
    installer: Mutex<Option<PathBuf>>,
    cancel: AtomicBool,
    busy: AtomicBool,
}

// ---------------------------------------------------------------------------
// Version + asset selection
// ---------------------------------------------------------------------------

fn parse_version(raw: &str) -> Result<Version, UpdateError> {
    let trimmed = raw.trim().trim_start_matches(['v', 'V']);
    Version::parse(trimmed).map_err(|err| {
        UpdateError::new("version", format!("无法识别版本号 “{raw}”")).detail(err.to_string())
    })
}

fn is_installer(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    (lower.ends_with(".exe") || lower.ends_with(".msi"))
        && !lower.ends_with(".sig")
        && !lower.ends_with(".sha256")
}

/// Skip an asset built for a different CPU architecture.
fn arch_matches(name: &str, want_arm: bool) -> bool {
    let lower = name.to_ascii_lowercase();
    let mentions_arm = lower.contains("arm64") || lower.contains("aarch64");
    let mentions_x64 =
        lower.contains("x64") || lower.contains("x86_64") || lower.contains("amd64");
    if want_arm {
        !mentions_x64
    } else {
        !mentions_arm
    }
}

fn asset_score(name: &str) -> u32 {
    let lower = name.to_ascii_lowercase();
    let base = if lower.ends_with(".exe") && lower.contains("setup") {
        100
    } else if lower.ends_with(".exe") && lower.contains("nsis") {
        90
    } else if lower.ends_with(".exe") {
        70
    } else if lower.ends_with(".msi") {
        60
    } else {
        0
    };
    let arch_bonus = if lower.contains("x64") || lower.contains("x86_64") {
        5
    } else {
        0
    };
    base + arch_bonus
}

/// Windows installers first (NSIS beats MSI: it can install silently without
/// elevation), newest and largest as the tie-breaker.
fn pick_asset(assets: &[Asset]) -> Option<Asset> {
    let want_arm = std::env::consts::ARCH == "aarch64";
    assets
        .iter()
        .filter(|asset| is_installer(&asset.name) && arch_matches(&asset.name, want_arm))
        .max_by_key(|asset| (asset_score(&asset.name), asset.size))
        .cloned()
}

// ---------------------------------------------------------------------------
// Check
// ---------------------------------------------------------------------------

async fn fetch_latest_release() -> Result<Release, UpdateError> {
    fetch_release(&repo_slug()).await
}

/// Split from [`fetch_latest_release`] so tests can point at any repository
/// without mutating the process-wide environment.
async fn fetch_release(repo: &str) -> Result<Release, UpdateError> {
    let url = format!("{}/repos/{repo}/releases/latest", api_base());
    let client = reqwest::Client::builder()
        .user_agent(user_agent())
        .connect_timeout(Duration::from_secs(12))
        .timeout(Duration::from_secs(25))
        .build()
        .map_err(map_request_error)?;

    let mut request = client
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28");
    if let Some(token) = github_token() {
        request = request.bearer_auth(token);
    }

    let response = request.send().await.map_err(map_request_error)?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(status_error(status, &body));
    }

    response
        .json::<Release>()
        .await
        .map_err(map_request_error)
}

async fn check_impl(app: &AppHandle) -> Result<Pending, UpdateError> {
    let current_raw = app.package_info().version.to_string();
    let current = parse_version(&current_raw)?;
    let release = fetch_latest_release().await?;
    let latest = parse_version(&release.tag_name)?;
    let available = latest > current;

    let asset = if available { pick_asset(&release.assets) } else { None };

    let (notes, notes_truncated) = match release.body.as_deref() {
        Some(body) if !body.trim().is_empty() => {
            let trimmed = body.trim();
            let count = trimmed.chars().count();
            let text: String = trimmed.chars().take(MAX_NOTES_CHARS).collect();
            (Some(text), count > MAX_NOTES_CHARS)
        }
        _ => (None, false),
    };

    let info = UpdateInfo {
        repo: repo_slug(),
        current_version: current_raw,
        latest_version: latest.to_string(),
        available,
        release_name: release
            .name
            .map(|name| name.trim().to_string())
            .filter(|name| !name.is_empty()),
        notes,
        notes_truncated,
        published_at: release.published_at,
        release_url: release.html_url,
        asset_name: asset.as_ref().map(|item| item.name.clone()),
        asset_size: asset.as_ref().map(|item| item.size),
    };

    Ok(Pending { info, asset })
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

fn updates_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_cache_dir()
        .map(|dir| dir.join("updates"))
        .unwrap_or_else(|_| std::env::temp_dir().join("NotchHub-updates"))
}

/// The asset name comes from the network, so keep it a plain file name.
fn safe_file_name(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name);
    let cleaned: String = base
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() || "._-+".contains(ch) { ch } else { '_' })
        .collect();
    if cleaned.is_empty() {
        "NotchHub-update".to_string()
    } else {
        cleaned
    }
}

fn emit_progress(app: &AppHandle, downloaded: u64, total: Option<u64>, started: Instant) {
    let elapsed = started.elapsed().as_secs_f64();
    let payload = ProgressPayload {
        downloaded,
        total,
        percent: total
            .filter(|total| *total > 0)
            .map(|total| (downloaded as f64 / total as f64 * 100.0).min(100.0)),
        speed: if elapsed > 0.0 {
            Some(downloaded as f64 / elapsed)
        } else {
            None
        },
    };
    let _ = app.emit(PROGRESS_EVENT, payload);
}

async fn save_stream(
    app: &AppHandle,
    response: reqwest::Response,
    target: &Path,
    total: Option<u64>,
    cancel: &AtomicBool,
    expected_digest: Option<&str>,
) -> Result<u64, UpdateError> {
    let mut file = tokio::fs::File::create(target)
        .await
        .map_err(|err| UpdateError::io(err, "创建安装包文件"))?;
    let mut stream = response.bytes_stream();
    let mut hasher = Sha256::new();
    let started = Instant::now();
    let mut downloaded: u64 = 0;
    let mut last_emit = Instant::now();

    while let Some(chunk) = stream.next().await {
        if cancel.load(Ordering::SeqCst) {
            drop(file);
            let _ = tokio::fs::remove_file(target).await;
            return Err(UpdateError::new("cancelled", "已取消下载"));
        }
        let chunk = chunk.map_err(|err| {
            UpdateError::new("download", "下载中断，请重试").detail(err.to_string())
        })?;
        file.write_all(&chunk)
            .await
            .map_err(|err| UpdateError::io(err, "写入安装包"))?;
        hasher.update(&chunk);
        downloaded += chunk.len() as u64;

        if last_emit.elapsed() >= Duration::from_millis(120) {
            last_emit = Instant::now();
            emit_progress(app, downloaded, total, started);
        }
    }

    file.flush()
        .await
        .map_err(|err| UpdateError::io(err, "写入安装包"))?;
    drop(file);

    if let Some(expected) = expected_digest {
        let actual = format!("sha256:{}", hex(&hasher.finalize()));
        if !expected.eq_ignore_ascii_case(&actual) {
            return Err(UpdateError::new(
                "digest",
                "安装包校验失败，文件可能不完整，请重新下载",
            )
            .detail(format!("期望 {expected}，实际 {actual}")));
        }
    }

    emit_progress(app, downloaded, total, started);
    Ok(downloaded)
}

fn hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

async fn download_impl(
    app: &AppHandle,
    state: &UpdaterState,
) -> Result<DownloadOutcome, UpdateError> {
    let pending = state
        .last
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| UpdateError::new("no_check", "请先检查更新"))?;

    if !pending.info.available {
        return Err(UpdateError::new("no_update", "当前已是最新版本"));
    }
    let asset = pending
        .asset
        .clone()
        .ok_or_else(|| UpdateError::new("no_asset", "该版本没有提供 Windows 安装包"))?;

    let dir = updates_dir(app);
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|err| UpdateError::io(err, "创建下载目录"))?;
    let file_name = safe_file_name(&asset.name);
    let target = dir.join(&file_name);

    // A previous attempt may have finished (or been interrupted); only a
    // complete file of the advertised size is reused.
    if let Ok(meta) = std::fs::metadata(&target) {
        if meta.is_file() && asset.size > 0 && meta.len() == asset.size {
            let _ = app.emit(
                PROGRESS_EVENT,
                ProgressPayload {
                    downloaded: meta.len(),
                    total: Some(asset.size),
                    percent: Some(100.0),
                    speed: None,
                },
            );
            *state.installer.lock().unwrap() = Some(target.clone());
            return Ok(DownloadOutcome {
                path: target.to_string_lossy().to_string(),
                file_name,
                size: meta.len(),
                reused: true,
            });
        }
        let _ = std::fs::remove_file(&target);
    }

    // Drop installers from older versions so the cache does not grow forever.
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let same_file = path
                .file_name()
                .map(|name| name.to_string_lossy() == file_name)
                .unwrap_or(false);
            if path.is_file() && !same_file {
                let _ = std::fs::remove_file(path);
            }
        }
    }

    let client = reqwest::Client::builder()
        .user_agent(user_agent())
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(60))
        .build()
        .map_err(map_request_error)?;

    let mut request = client
        .get(&asset.browser_download_url)
        .header("Accept", "application/octet-stream");
    if let Some(token) = github_token() {
        request = request.bearer_auth(token);
    }

    let response = request.send().await.map_err(map_request_error)?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(status_error(status, &body));
    }

    let total = response
        .content_length()
        .or(if asset.size > 0 { Some(asset.size) } else { None });

    let digest = asset.digest.as_deref().filter(|value| value.starts_with("sha256:"));
    let result = save_stream(app, response, &target, total, &state.cancel, digest).await;

    let written = match result {
        Ok(written) => written,
        Err(err) => {
            if err.code != "cancelled" {
                let _ = tokio::fs::remove_file(&target).await;
            }
            return Err(err);
        }
    };

    if let Some(expected) = total {
        if expected > 0 && written != expected {
            let _ = tokio::fs::remove_file(&target).await;
            return Err(UpdateError::new(
                "size",
                "安装包下载不完整，请检查网络后重试",
            )
            .detail(format!("期望 {expected} 字节，实际 {written} 字节")));
        }
    }

    *state.installer.lock().unwrap() = Some(target.clone());

    Ok(DownloadOutcome {
        path: target.to_string_lossy().to_string(),
        file_name,
        size: written,
        reused: false,
    })
}

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------

#[cfg(windows)]
fn spawn_installer(installer: &Path, exe: &Path) -> Result<(), UpdateError> {
    let is_msi = installer
        .extension()
        .map(|ext| ext.eq_ignore_ascii_case("msi"))
        .unwrap_or(false);

    // The `ping` sleeps give this process time to exit before the installer
    // replaces the binary; `start` brings the new build back up afterwards.
    let script = if is_msi {
        format!(
            "ping -n 3 127.0.0.1 >nul & msiexec /i \"{}\" /qb /norestart & ping -n 2 127.0.0.1 >nul & del /f /q \"{}\" & start \"\" \"{}\"",
            installer.display(),
            installer.display(),
            exe.display()
        )
    } else {
        format!(
            "ping -n 3 127.0.0.1 >nul & \"{}\" /S & ping -n 2 127.0.0.1 >nul & del /f /q \"{}\" & start \"\" \"{}\"",
            installer.display(),
            installer.display(),
            exe.display()
        )
    };

    Command::new("cmd")
        .arg("/C")
        .arg(script)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|err| UpdateError::io(err, "启动安装程序"))?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Current bundle version, so the UI can show it before any network call.
#[tauri::command]
pub fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
pub async fn update_check(
    app: AppHandle,
    state: tauri::State<'_, UpdaterState>,
) -> Result<UpdateInfo, UpdateError> {
    if state.busy.load(Ordering::SeqCst) {
        return Err(UpdateError::new("busy", "正在下载安装包，请稍候"));
    }

    let pending = check_impl(&app).await?;
    let info = pending.info.clone();

    // A fresh check invalidates whatever was downloaded before.
    let stale = state.installer.lock().unwrap().take();
    if let Some(path) = stale {
        let _ = std::fs::remove_file(path);
    }

    *state.last.lock().unwrap() = Some(pending);
    Ok(info)
}

#[tauri::command]
pub async fn update_download(
    app: AppHandle,
    state: tauri::State<'_, UpdaterState>,
) -> Result<DownloadOutcome, UpdateError> {
    if state.busy.swap(true, Ordering::SeqCst) {
        return Err(UpdateError::new("busy", "已有下载正在进行"));
    }
    state.cancel.store(false, Ordering::SeqCst);

    let result = download_impl(&app, state.inner()).await;

    state.busy.store(false, Ordering::SeqCst);
    result
}

#[tauri::command]
pub fn update_cancel(state: tauri::State<'_, UpdaterState>) -> bool {
    if !state.busy.load(Ordering::SeqCst) {
        return false;
    }
    state.cancel.store(true, Ordering::SeqCst);
    true
}

#[tauri::command]
pub fn update_install(
    app: AppHandle,
    state: tauri::State<'_, UpdaterState>,
) -> Result<InstallOutcome, UpdateError> {
    let installer = state
        .installer
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| UpdateError::new("no_download", "还没有下载安装包"))?;

    if !installer.is_file() {
        return Err(UpdateError::new(
            "missing_file",
            "安装包已被移动或删除，请重新下载",
        ));
    }

    // `cargo tauri dev` runs the debug binary out of `target/`, so replacing it
    // would be pointless (and install a second copy on the developer machine).
    if cfg!(debug_assertions) {
        return Ok(InstallOutcome {
            launched: false,
            message: "开发模式下不会替换正在运行的程序，请在文件管理器中手动运行安装包。".into(),
        });
    }

    #[cfg(windows)]
    {
        let exe = std::env::current_exe().map_err(|err| UpdateError::io(err, "定位当前程序"))?;
        spawn_installer(&installer, &exe)?;

        // Give the response a chance to reach the webview, then get out of the
        // installer's way.
        let handle = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(700));
            handle.exit(0);
        });

        Ok(InstallOutcome {
            launched: true,
            message: "正在安装新版本，应用会自动重启。".into(),
        })
    }

    #[cfg(not(windows))]
    {
        let _ = app;
        Err(UpdateError::new(
            "unsupported",
            "当前系统不支持自动安装，请手动运行下载的安装包",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn asset(name: &str, size: u64) -> Asset {
        Asset {
            name: name.to_string(),
            size,
            browser_download_url: "https://example.com/asset".to_string(),
            digest: None,
        }
    }

    #[test]
    fn accepts_prefixed_tags() {
        assert_eq!(parse_version("v1.2.3").unwrap(), Version::new(1, 2, 3));
        assert_eq!(parse_version(" 1.2.3 ").unwrap(), Version::new(1, 2, 3));
        assert_eq!(parse_version("2.0.0-beta.1").unwrap().major, 2);
        assert!(parse_version("nightly").is_err());
    }

    #[test]
    fn nsis_setup_wins_over_msi() {
        let assets = [
            asset("NotchHub_0.2.0_x64_en-US.msi", 3_000),
            asset("NotchHub_0.2.0_x64-setup.exe", 2_000),
        ];
        assert_eq!(
            pick_asset(&assets).unwrap().name,
            "NotchHub_0.2.0_x64-setup.exe"
        );
    }

    #[test]
    fn ignores_signatures_and_archives() {
        let assets = [
            asset("NotchHub_0.2.0_x64-setup.exe.sig", 64),
            asset("NotchHub_0.2.0_x64-setup.nsis.zip", 9_000),
        ];
        assert!(pick_asset(&assets).is_none());
    }

    #[test]
    fn skips_foreign_architecture() {
        if std::env::consts::ARCH == "aarch64" {
            return;
        }
        let assets = [
            asset("NotchHub_0.2.0_aarch64-setup.exe", 9_000),
            asset("NotchHub_0.2.0_x64-setup.exe", 1_000),
        ];
        assert_eq!(
            pick_asset(&assets).unwrap().name,
            "NotchHub_0.2.0_x64-setup.exe"
        );
    }

    #[test]
    fn asset_names_cannot_escape_the_cache_dir() {
        // Only the last path segment survives, then odd characters are folded.
        assert_eq!(safe_file_name("../../evil.exe"), "evil.exe");
        assert_eq!(safe_file_name("C:\\Windows\\evil.exe"), "evil.exe");
        assert_eq!(safe_file_name("a b/evil?.exe"), "evil_.exe");
        assert_eq!(
            safe_file_name("NotchHub_0.2.0_x64-setup.exe"),
            "NotchHub_0.2.0_x64-setup.exe"
        );
        assert_eq!(safe_file_name(""), "NotchHub-update");
    }

    /// Network smoke test: a missing repo must surface as `not_found`, not as
    /// a panic or an opaque network error.
    #[tokio::test]
    #[ignore = "hits the GitHub API"]
    async fn missing_repository_maps_to_not_found() {
        let error = fetch_release("qdy/notchhub-does-not-exist-xyz")
            .await
            .unwrap_err();
        assert_eq!(error.code, "not_found", "{error:?}");
    }

    /// Network smoke test: a public repo with plain `vX.Y.Z` tags must parse.
    #[tokio::test]
    #[ignore = "hits the GitHub API"]
    async fn public_repository_is_parsed() {
        let release = fetch_release("sharkdp/bat").await.expect("release");
        let version = parse_version(&release.tag_name).expect("semver tag");
        assert_ne!(version, Version::new(0, 0, 0));
        assert!(!release.assets.is_empty());
    }

    #[test]
    fn repo_inputs_are_normalised() {
        assert_eq!(
            normalize_repo("https://github.com/qdy/NotchHub.git"),
            "qdy/NotchHub"
        );
        assert_eq!(normalize_repo("qdy/NotchHub/"), "qdy/NotchHub");
        assert_eq!(
            normalize_repo("git@github.com:qdy/NotchHub.git"),
            "qdy/NotchHub"
        );
    }
}
