//! NotchHub — a Windows "dynamic island" that lives at the top edge of your screen.
//!
//! The window is a transparent, always-on-top, borderless pane pinned to the top
//! center of the primary monitor. While collapsed it is fully click-through, so a
//! native cursor watcher decides when the pointer enters the notch hot-zone and
//! flips the window back into interactive mode.
//!
//! The panel size is user-configurable, so the hot-zones are derived from a shared
//! geometry value rather than hard-coded constants.

use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, LogicalSize, Manager, PhysicalPosition, WebviewWindow};

mod updater;

// ---------------------------------------------------------------------------
// Geometry (logical pixels)
// ---------------------------------------------------------------------------

/// The collapsed capsule defaults; both are user-configurable.
const DEFAULT_CAPSULE_W: f64 = 240.0;
const DEFAULT_CAPSULE_H: f64 = 36.0;

const CAPSULE_MIN_W: f64 = 160.0;
const CAPSULE_MAX_W: f64 = 300.0;
const CAPSULE_MIN_H: f64 = 26.0;
const CAPSULE_MAX_H: f64 = 48.0;

/// Collapsed dot diameter and the invisible comfort margin around it.
/// `DOT_SIZE` in `src/hooks/useSettings.ts` must stay in sync with this value —
/// the CSS draws the lens, the watcher draws the hot-zone around it.
const DOT_VISUAL_SIZE: f64 = 26.0;
const DOT_HOT_PAD_X: f64 = 7.0;
const DOT_HOT_PAD_BOTTOM: f64 = 8.0;

/// Transparent slack around the panel inside the window canvas.
const MARGIN_W: f64 = 40.0;
const MARGIN_H: f64 = 60.0;

/// Allowed panel size range, matching the settings fields.
const PANEL_MIN_W: f64 = 320.0;
const PANEL_MAX_W: f64 = 560.0;
const PANEL_MIN_H: f64 = 360.0;
const PANEL_MAX_H: f64 = 680.0;

const DEFAULT_PANEL_W: f64 = 380.0;
const DEFAULT_PANEL_H: f64 = 480.0;

/// How long the pointer may stay outside the panel before we collapse.
const COLLAPSE_GRACE: Duration = Duration::from_millis(320);

/// Polling cadence for the global cursor watcher.
const POLL_INTERVAL: Duration = Duration::from_millis(45);

#[derive(Clone, Copy)]
struct Panel {
    width: f64,
    height: f64,
    capsule_width: f64,
    capsule_height: f64,
}

impl Default for Panel {
    fn default() -> Self {
        Self {
            width: DEFAULT_PANEL_W,
            height: DEFAULT_PANEL_H,
            capsule_width: DEFAULT_CAPSULE_W,
            capsule_height: DEFAULT_CAPSULE_H,
        }
    }
}

/// How the island is woken up. Mirrors the `trigger` setting in the front end.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Trigger {
    /// Expanding on pointer entry (the original behaviour).
    Hover = 0,
    /// Only a click on the capsule expands.
    Click = 1,
    /// Hover expands, and a click is accepted as well.
    Both = 2,
}

impl Trigger {
    fn from_str(value: &str) -> Option<Self> {
        match value {
            "hover" => Some(Self::Hover),
            "click" => Some(Self::Click),
            "both" => Some(Self::Both),
            _ => None,
        }
    }

    fn from_u8(value: u8) -> Self {
        match value {
            1 => Self::Click,
            2 => Self::Both,
            _ => Self::Hover,
        }
    }

    /// Whether the pointer entering the hot-zone is enough to expand.
    fn expands_on_hover(self) -> bool {
        !matches!(self, Self::Click)
    }
}

struct AppState {
    expanded: Arc<AtomicBool>,
    panel: Arc<Mutex<Panel>>,
    trigger: Arc<AtomicU8>,
    /// True when the collapsed island is a dot rather than the full capsule.
    dot_mode: Arc<AtomicBool>,
}

// ---------------------------------------------------------------------------
// Win32 cursor lookup (zero extra dependencies, just user32)
// ---------------------------------------------------------------------------

#[cfg(windows)]
mod win32 {
    use core::ffi::c_void;

    #[repr(C)]
    #[derive(Default)]
    pub struct Point {
        pub x: i32,
        pub y: i32,
    }

    #[link(name = "user32")]
    unsafe extern "system" {
        pub fn GetCursorPos(point: *mut Point) -> i32;
        pub fn GetAsyncKeyState(key: i32) -> i16;
    }

    #[link(name = "dwmapi")]
    unsafe extern "system" {
        pub fn DwmSetWindowAttribute(
            hwnd: isize,
            attribute: u32,
            value: *const c_void,
            size: u32,
        ) -> i32;
    }
}

#[cfg(windows)]
fn cursor_position() -> Option<(f64, f64)> {
    let mut point = win32::Point::default();
    let ok = unsafe { win32::GetCursorPos(&mut point) };
    if ok != 0 {
        Some((point.x as f64, point.y as f64))
    } else {
        None
    }
}

#[cfg(not(windows))]
fn cursor_position() -> Option<(f64, f64)> {
    None
}

/// Whether the primary mouse button is held down right now. Used by the click
/// trigger: the collapsed window is click-through, so a click on the capsule has
/// to be observed globally rather than waited for in the webview.
#[cfg(windows)]
fn left_button_down() -> bool {
    const VK_LBUTTON: i32 = 0x01;
    unsafe { (win32::GetAsyncKeyState(VK_LBUTTON) as u16 & 0x8000) != 0 }
}

#[cfg(not(windows))]
fn left_button_down() -> bool {
    false
}

/// Windows 11 rounds every window corner via DWM, which would carve visible
/// notches out of the top edge and stop the island from hugging the screen.
#[cfg(windows)]
fn square_off_corners(window: &WebviewWindow) {
    const DWMWA_WINDOW_CORNER_PREFERENCE: u32 = 33;
    const DWMWCP_DONOTROUND: i32 = 1;

    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    let preference: i32 = DWMWCP_DONOTROUND;
    unsafe {
        win32::DwmSetWindowAttribute(
            hwnd.0 as isize,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            &preference as *const i32 as *const core::ffi::c_void,
            std::mem::size_of::<i32>() as u32,
        );
    }
}

#[cfg(not(windows))]
fn square_off_corners(_window: &WebviewWindow) {}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Front-end driven state change (Esc key, close button, auto-collapse).
#[tauri::command]
fn set_expanded(
    window: WebviewWindow,
    state: tauri::State<'_, AppState>,
    expanded: bool,
) -> Result<(), String> {
    apply_expanded(&window, &state.expanded, expanded);
    Ok(())
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

/// Switch how the island is woken up: `hover`, `click` or `both`.
#[tauri::command]
fn set_trigger_mode(state: tauri::State<'_, AppState>, mode: String) -> Result<(), String> {
    let trigger = Trigger::from_str(&mode).ok_or_else(|| format!("unknown trigger: {mode}"))?;
    state.trigger.store(trigger as u8, Ordering::SeqCst);
    Ok(())
}

/// Switch between the compact dot and the full capsule. The collapsed window
/// is click-through, so the cursor hot-zone has to follow the visible shape.
#[tauri::command]
fn set_dot_mode(state: tauri::State<'_, AppState>, enabled: bool) -> Result<(), String> {
    state.dot_mode.store(enabled, Ordering::SeqCst);
    Ok(())
}

/// Resize the island: the window canvas grows with the panel and re-centers on
/// top of the primary monitor, and the cursor hot-zones follow automatically.
#[tauri::command]
fn set_geometry(
    window: WebviewWindow,
    state: tauri::State<'_, AppState>,
    width: f64,
    height: f64,
    capsule_width: f64,
    capsule_height: f64,
) -> Result<(), String> {
    let panel = Panel {
        width: width.clamp(PANEL_MIN_W, PANEL_MAX_W),
        height: height.clamp(PANEL_MIN_H, PANEL_MAX_H),
        capsule_width: capsule_width.clamp(CAPSULE_MIN_W, CAPSULE_MAX_W),
        capsule_height: capsule_height.clamp(CAPSULE_MIN_H, CAPSULE_MAX_H),
    };

    *state.panel.lock().unwrap() = panel;
    apply_panel_geometry(&window, panel);

    Ok(())
}

fn apply_expanded(window: &WebviewWindow, flag: &AtomicBool, expanded: bool) {
    // Click-through always follows the expanded flag. This runs before the
    // early return so that callers which disagree about the current state still
    // end up with a window that matches it.
    let _ = window.set_ignore_cursor_events(!expanded);

    if flag.swap(expanded, Ordering::SeqCst) == expanded {
        return;
    }
    let _ = window.emit(
        if expanded { "notch-open" } else { "notch-close" },
        (),
    );
}

// ---------------------------------------------------------------------------
// Window placement + cursor watcher
// ---------------------------------------------------------------------------

fn window_size(panel: Panel) -> (f64, f64) {
    (panel.width + MARGIN_W, panel.height + MARGIN_H)
}

fn apply_panel_geometry(window: &WebviewWindow, panel: Panel) {
    let (win_w, win_h) = window_size(panel);
    let _ = window.set_size(LogicalSize::new(win_w, win_h));
    place_at_top_center(window, win_w);
}

fn place_at_top_center(window: &WebviewWindow, win_w: f64) {
    let monitor = match window.primary_monitor() {
        Ok(Some(m)) => m,
        _ => return,
    };
    let scale = monitor.scale_factor();
    let origin = monitor.position();
    let size = monitor.size();

    let width = win_w * scale;
    let x = origin.x as f64 + (size.width as f64 - width) / 2.0;
    let y = origin.y as f64;

    let _ = window.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32));
}

fn watch_cursor(
    window: WebviewWindow,
    expanded: Arc<AtomicBool>,
    panel: Arc<Mutex<Panel>>,
    trigger: Arc<AtomicU8>,
    dot_mode: Arc<AtomicBool>,
) {
    std::thread::spawn(move || {
        // `armed` prevents an open -> close -> open loop while the pointer is
        // still resting inside the hot-zone.
        let mut armed = true;
        let mut leave_deadline: Option<Instant> = None;

        // Whether we flipped the collapsed window out of click-through mode so
        // the capsule can receive a click.
        let mut clickable = false;
        let mut was_pressed = false;

        loop {
            std::thread::sleep(POLL_INTERVAL);

            let Some((cursor_x, cursor_y)) = cursor_position() else {
                continue;
            };
            let Ok(position) = window.outer_position() else {
                continue;
            };
            let scale = window.scale_factor().unwrap_or(1.0);

            let local_x = (cursor_x - position.x as f64) / scale;
            let local_y = (cursor_y - position.y as f64) / scale;

            let current = *panel.lock().unwrap();
            let (win_w, _) = window_size(current);

            // Collapsed shape sits centered at the top edge of the canvas. In
            // dot mode it is only a small lens, so the rest of the old capsule
            // width must stay genuinely click-through.
            let (hot_x_min, hot_x_max, hot_y_max) = if dot_mode.load(Ordering::Relaxed) {
                let dot_left = (win_w - DOT_VISUAL_SIZE) / 2.0;
                (
                    dot_left - DOT_HOT_PAD_X,
                    dot_left + DOT_VISUAL_SIZE + DOT_HOT_PAD_X,
                    DOT_VISUAL_SIZE + DOT_HOT_PAD_BOTTOM,
                )
            } else {
                let capsule_left = (win_w - current.capsule_width) / 2.0;
                (
                    capsule_left - 6.0,
                    capsule_left + current.capsule_width + 6.0,
                    current.capsule_height + 6.0,
                )
            };

            // Expanded panel is centered as well, with a little slack.
            let panel_left = (win_w - current.width) / 2.0;
            let panel_x_min = panel_left - 10.0;
            let panel_x_max = panel_left + current.width + 10.0;
            let panel_y_max = current.height + 18.0;

            let mode = Trigger::from_u8(trigger.load(Ordering::Relaxed));

            // Rising edge only, so holding the button does not keep expanding.
            let pressed = left_button_down();
            let clicked = pressed && !was_pressed;
            was_pressed = pressed;

            let is_open = expanded.load(Ordering::SeqCst);

            if !is_open {
                leave_deadline = None;
                let in_hot_zone =
                    local_x >= hot_x_min && local_x <= hot_x_max && local_y <= hot_y_max;

                // The whole canvas is transparent, so only the capsule island
                // itself may swallow clicks: while the pointer is on it the
                // window becomes interactive, and it goes back to click-through
                // as soon as the pointer leaves.
                if in_hot_zone != clickable {
                    clickable = in_hot_zone;
                    let _ = window.set_ignore_cursor_events(!in_hot_zone);
                }

                if in_hot_zone {
                    // A click works in every mode — hovering may have been
                    // suppressed by `armed` while the pointer already rested
                    // here (e.g. right after pressing Esc).
                    let hovered = mode.expands_on_hover() && armed;
                    if hovered {
                        armed = false;
                    }
                    if hovered || clicked {
                        apply_expanded(&window, &expanded, true);
                    }
                } else {
                    armed = true;
                }
            } else {
                clickable = false;

                let inside = local_x >= panel_x_min
                    && local_x <= panel_x_max
                    && local_y >= -2.0
                    && local_y <= panel_y_max;

                if inside {
                    leave_deadline = None;
                } else {
                    let now = Instant::now();
                    match leave_deadline {
                        None => leave_deadline = Some(now + COLLAPSE_GRACE),
                        Some(deadline) => {
                            if now >= deadline {
                                leave_deadline = None;
                                apply_expanded(&window, &expanded, false);
                            }
                        }
                    }
                }
            }
        }
    });
}

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------

fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let toggle = MenuItem::with_id(app, "toggle", "显示 / 隐藏", true, None::<&str>)?;
    let check = MenuItem::with_id(app, "check-update", "检查更新", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出 NotchHub", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&toggle, &check, &quit])?;

    let mut builder = TrayIconBuilder::with_id("notchhub-tray")
        .tooltip("NotchHub")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "quit" => app.exit(0),
            "toggle" => {
                if let Some(window) = app.get_webview_window("main") {
                    if window.is_visible().unwrap_or(true) {
                        let _ = window.hide();
                    } else {
                        let _ = window.show();
                    }
                }
            }
            // The panel owns the update UI, so hand the request to the webview.
            "check-update" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.emit("updater://check-request", ());
                }
            }
            _ => {}
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder.build(app)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            set_expanded,
            set_geometry,
            set_trigger_mode,
            set_dot_mode,
            quit_app,
            updater::app_version,
            updater::update_check,
            updater::update_download,
            updater::update_cancel,
            updater::update_install
        ])
        .setup(|app| {
            let window = app
                .get_webview_window("main")
                .expect("main window must exist");

            let panel = Panel::default();
            apply_panel_geometry(&window, panel);
            square_off_corners(&window);
            let _ = window.set_ignore_cursor_events(true);
            window.show()?;

            let expanded = Arc::new(AtomicBool::new(false));
            let panel_ref = Arc::new(Mutex::new(panel));
            // Hover + dot mode are the defaults until the front end reports its
            // settings (both match DEFAULT_SETTINGS on a fresh install).
            let trigger = Arc::new(AtomicU8::new(Trigger::Hover as u8));
            let dot_mode = Arc::new(AtomicBool::new(true));

            app.manage(AppState {
                expanded: expanded.clone(),
                panel: panel_ref.clone(),
                trigger: trigger.clone(),
                dot_mode: dot_mode.clone(),
            });
            app.manage(updater::UpdaterState::default());

            watch_cursor(window.clone(), expanded, panel_ref, trigger, dot_mode);
            build_tray(app.handle())?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running NotchHub");
}
