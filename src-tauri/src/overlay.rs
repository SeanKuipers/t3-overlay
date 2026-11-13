//! The overlay window: a transparent, always-on-top window covering the monitor.
//!
//! Mouse input passes through to the game everywhere except over the regions the UI marks
//! as interactive (the inbox card). Keyboard focus is only taken when you ask for it
//! (hotkey or click), and handed back to the window that had it before.

use serde::Deserialize;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

pub const LABEL: &str = "overlay";

/// A rectangle in the page's CSS pixels, relative to the overlay window.
#[derive(Debug, Clone, Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    /// Set for regions that react to hover (e.g. the dock): reported via `overlay://hover`.
    #[serde(default)]
    pub id: Option<String>,
}

impl Rect {
    fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x && y >= self.y && x <= self.x + self.width && y <= self.y + self.height
    }
}

#[derive(Default)]
pub struct OverlayState {
    pub hit_regions: Mutex<Vec<Rect>>,
    /// The page's viewport in CSS pixels. Regions are scaled to the window's real size with
    /// it, rather than trusting devicePixelRatio (which can disagree with the window).
    pub viewport: Mutex<Option<(f64, f64)>>,
    /// The overlay has become focusable (shortly after it first appears).
    pub focusable: std::sync::atomic::AtomicBool,
    /// What the overlay page last reported, for Settings → Diagnostics.
    pub diag: Mutex<PageReport>,
    /// The window that had focus before the overlay took it (an HWND on Windows).
    pub previous_foreground: Mutex<Option<isize>>,
}

#[derive(Default, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageReport {
    /// Unix ms of the page's last "I'm alive and rendered" ping.
    pub last_heartbeat_ms: Option<u64>,
    /// Most recent errors from the page (newest last).
    pub errors: Vec<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostics {
    pub window_exists: bool,
    pub visible: Option<bool>,
    pub minimized: Option<bool>,
    pub position: Option<(i32, i32)>,
    pub size: Option<(u32, u32)>,
    pub ex_style: Option<String>,
    pub focusable_now: bool,
    /// Page viewport (CSS px) and the factor from CSS px to window pixels.
    pub viewport: Option<(f64, f64)>,
    pub scale: Option<(f64, f64)>,
    pub heartbeat_age_ms: Option<u64>,
    pub errors: Vec<String>,
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Window pixels per CSS pixel, from the window's real size and the page's viewport.
fn scale_of(window: &WebviewWindow, state: &OverlayState) -> Option<(f64, f64)> {
    let (vw, vh) = (*state.viewport.lock().unwrap())?;
    let size = window.inner_size().ok()?;
    (vw > 0.0 && vh > 0.0).then(|| (size.width as f64 / vw, size.height as f64 / vh))
}

pub fn diagnostics(app: &AppHandle) -> Diagnostics {
    let state = app.state::<OverlayState>();
    let report = state.diag.lock().unwrap().clone();
    let w = window(app);
    let viewport = *state.viewport.lock().unwrap();
    let scale = w.as_ref().and_then(|w| scale_of(w, &state));
    Diagnostics {
        window_exists: w.is_some(),
        visible: w.as_ref().and_then(|w| w.is_visible().ok()),
        minimized: w.as_ref().and_then(|w| w.is_minimized().ok()),
        position: w.as_ref().and_then(|w| w.outer_position().ok()).map(|p| (p.x, p.y)),
        size: w.as_ref().and_then(|w| w.outer_size().ok()).map(|s| (s.width, s.height)),
        ex_style: w.as_ref().and_then(platform::ex_style).map(|s| format!("{s:#010x}")),
        focusable_now: state.focusable.load(std::sync::atomic::Ordering::SeqCst),
        viewport,
        scale,
        heartbeat_age_ms: report.last_heartbeat_ms.map(|t| now_ms().saturating_sub(t)),
        errors: report.errors,
    }
}

/// Shows the overlay again if something left it hidden (checked shortly after startup).
pub fn spawn_visibility_watchdog(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        for _ in 0..3 {
            tokio::time::sleep(Duration::from_secs(3)).await;
            if let Some(w) = window(&app) {
                if !w.is_visible().unwrap_or(true) {
                    log::warn!("overlay was hidden after startup; showing it again");
                    let _ = w.show();
                }
            }
        }
    });
}

pub fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(LABEL)
}

/// Covers the primary monitor and shows the window without taking focus.
pub fn place_and_show(app: &AppHandle) {
    let Some(window) = window(app) else { return };
    let monitor = window
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| window.current_monitor().ok().flatten());
    if let Some(monitor) = monitor {
        let pos = monitor.position();
        let size = monitor.size();
        let _ = window.set_position(PhysicalPosition::new(pos.x, pos.y));
        let _ = window.set_size(PhysicalSize::new(size.width, size.height));
    }
    // The window is created non-focusable (`focusable: false` in tauri.conf.json): it has
    // WS_EX_NOACTIVATE at the moment it appears, which is the only moment tiling window
    // managers (GlazeWM) decide whether to manage a window. So it's never tiled or hidden
    // with a workspace. A moment later it becomes a normal focusable window, so typing works.
    let _ = window.set_always_on_top(true);
    let _ = window.set_ignore_cursor_events(true);
    platform::make_non_activating(&window);
    // A non-focusable window can't steal focus when shown, but hand it back just in case.
    let before = platform::foreground();
    let _ = window.show();
    platform::make_non_activating(&window);
    platform::keep_on_top(&window);
    if before.is_some() && platform::foreground() == platform::hwnd(&window) {
        platform::restore_focus(before);
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(1500)).await;
        if let Some(w) = self::window(&app) {
            let _ = w.set_focusable(true);
            app.state::<OverlayState>().focusable.store(true, std::sync::atomic::Ordering::SeqCst);
        }
    });
}

/// Toggles click-through depending on whether the cursor is over an interactive region, and
/// keeps the overlay above the game.
pub fn spawn_hit_test_loop(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut interactive = false;
        // The page can't see the mouse leave once the window is click-through again, so
        // hover for named regions is tracked here.
        let mut hovered: Option<String> = None;
        let mut last_foreground = None;
        let mut tick: u32 = 0;
        loop {
            tokio::time::sleep(Duration::from_millis(40)).await;
            let Some(window) = window(&app) else { continue };

            // "Always on top" alone isn't enough: League (and other topmost windows) jump
            // above us when they're activated. Re-assert our place whenever the foreground
            // window changes, and once a second regardless.
            tick = tick.wrapping_add(1);
            let foreground = platform::foreground();
            if foreground != last_foreground || tick % 25 == 0 {
                last_foreground = foreground;
                platform::keep_on_top(&window);
            }

            let state = app.state::<OverlayState>();
            let scale = scale_of(&window, &state).unwrap_or((1.0, 1.0));
            let (over, hover) = match (window.cursor_position(), window.inner_position()) {
                (Ok(cursor), Ok(origin)) => {
                    // Cursor in the page's CSS pixels.
                    let x = (cursor.x - origin.x as f64) / scale.0;
                    let y = (cursor.y - origin.y as f64) / scale.1;
                    let regions = state.hit_regions.lock().unwrap();
                    let over = regions.iter().any(|r| r.contains(x, y));
                    let hover = regions.iter().find(|r| r.id.is_some() && r.contains(x, y)).and_then(|r| r.id.clone());
                    (over, hover)
                }
                _ => (false, None),
            };
            if hover != hovered {
                hovered = hover;
                let _ = app.emit("overlay://hover", hovered.clone());
            }
            if over != interactive {
                interactive = over;
                let _ = window.set_ignore_cursor_events(!over);
            }
            // Out of Alt+Tab (Tauri drops this bit whenever it rewrites the window style).
            platform::make_non_activating(&window);
        }
    });
}

/// Gives the overlay keyboard focus, remembering who had it.
pub fn take_focus(app: &AppHandle) {
    let Some(window) = window(app) else { return };
    let state = app.state::<OverlayState>();
    let previous = platform::foreground();
    if previous.is_some() && previous != platform::hwnd(&window) {
        *state.previous_foreground.lock().unwrap() = previous;
    }
    platform::force_focus(&window);
}

/// Hands focus back to the game (or whatever had it before).
pub fn release_focus(app: &AppHandle) {
    let state = app.state::<OverlayState>();
    let previous = state.previous_foreground.lock().unwrap().take();
    platform::restore_focus(previous);
}

/// Lets the next app we launch (the browser) come to the front. Without this Windows keeps
/// it behind the current window and only flashes it in the taskbar.
pub fn allow_others_to_take_focus() {
    platform::allow_any_foreground();
}

/// Brings any of our windows (e.g. Settings) to the front, even when another app has focus.
pub fn bring_to_front(window: &WebviewWindow) {
    let _ = window.unminimize();
    let _ = window.show();
    platform::force_focus(window);
}

#[cfg(windows)]
mod platform {
    use tauri::WebviewWindow;
    use windows::core::{w, PCWSTR};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
    use windows::Win32::UI::WindowsAndMessaging::{
        AllowSetForegroundWindow, BringWindowToTop, SetWindowPos, ASFW_ANY, HWND_TOPMOST,
        SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER, SWP_NOSIZE, FindWindowW, GetForegroundWindow, GetWindowLongPtrW,
        GetWindowThreadProcessId, IsWindow, SetForegroundWindow, SetWindowLongPtrW, ShowWindow,
        GWL_EXSTYLE, SW_SHOW, WS_EX_TOOLWINDOW,
    };

    /// Tauri's HWND comes from its own `windows` crate version; convert via the raw pointer.
    fn raw(window: &WebviewWindow) -> Option<HWND> {
        window.hwnd().ok().map(|h| HWND(h.0 as *mut core::ffi::c_void))
    }

    pub fn hwnd(window: &WebviewWindow) -> Option<isize> {
        raw(window).map(|h| h.0 as isize)
    }

    pub fn ex_style(window: &WebviewWindow) -> Option<isize> {
        raw(window).map(|h| unsafe { GetWindowLongPtrW(h, GWL_EXSTYLE) })
    }

    pub fn foreground() -> Option<isize> {
        let h = unsafe { GetForegroundWindow() };
        (!h.0.is_null()).then_some(h.0 as isize)
    }

    /// Marks the window as a tool window: out of Alt+Tab, and ignored by tiling window
    /// managers (GlazeWM). Cheap to call repeatedly; only writes when the bit is missing.
    pub fn make_non_activating(window: &WebviewWindow) {
        if let Some(h) = raw(window) {
            unsafe {
                let style = GetWindowLongPtrW(h, GWL_EXSTYLE);
                let tool = WS_EX_TOOLWINDOW.0 as isize;
                if style & tool == 0 {
                    SetWindowLongPtrW(h, GWL_EXSTYLE, style | tool);
                }
            }
        }
    }

    /// Moves the window to the top of the topmost band without activating it.
    pub fn keep_on_top(window: &WebviewWindow) {
        let Some(h) = raw(window) else { return };
        unsafe {
            let _ = SetWindowPos(
                h,
                Some(HWND_TOPMOST),
                0,
                0,
                0,
                0,
                SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_NOOWNERZORDER,
            );
        }
    }

    pub fn allow_any_foreground() {
        unsafe {
            let _ = AllowSetForegroundWindow(ASFW_ANY);
        }
    }

    /// Windows only lets the foreground thread change focus. Briefly attaching the window's
    /// thread to the foreground thread's input queue lets us take focus anyway. Uses the
    /// window's own thread (not the calling one) so this also works from async tasks.
    pub fn force_focus(window: &WebviewWindow) {
        let Some(target) = raw(window) else { return };
        unsafe {
            let fg = GetForegroundWindow();
            let fg_thread = GetWindowThreadProcessId(fg, None);
            let our_thread = match GetWindowThreadProcessId(target, None) {
                0 => GetCurrentThreadId(),
                t => t,
            };
            let attached = fg_thread != 0
                && fg_thread != our_thread
                && AttachThreadInput(our_thread, fg_thread, true).as_bool();
            let _ = ShowWindow(target, SW_SHOW);
            let _ = BringWindowToTop(target);
            let _ = SetForegroundWindow(target);
            if attached {
                let _ = AttachThreadInput(our_thread, fg_thread, false);
            }
        }
        let _ = window.set_focus();
    }

    pub fn restore_focus(previous: Option<isize>) {
        unsafe {
            let target = previous
                .map(|h| HWND(h as *mut _))
                .filter(|h| IsWindow(Some(*h)).as_bool())
                // Fall back to the League game window.
                .or_else(|| FindWindowW(w!("RiotWindowClass"), PCWSTR::null()).ok());
            if let Some(target) = target {
                let _ = SetForegroundWindow(target);
            }
        }
    }
}

#[cfg(not(windows))]
mod platform {
    //! League runs on Windows; elsewhere these are best-effort so the app still builds and runs.
    use tauri::WebviewWindow;

    pub fn hwnd(_window: &WebviewWindow) -> Option<isize> {
        None
    }
    pub fn foreground() -> Option<isize> {
        None
    }
    pub fn make_non_activating(_window: &WebviewWindow) {}
    pub fn ex_style(_window: &WebviewWindow) -> Option<isize> {
        None
    }

    pub fn allow_any_foreground() {}
    pub fn keep_on_top(_window: &WebviewWindow) {}
    pub fn force_focus(window: &WebviewWindow) {
        let _ = window.set_focus();
    }
    pub fn restore_focus(_previous: Option<isize>) {}
}
