//! The overlay window: a transparent, always-on-top window covering the monitor.
//!
//! Mouse input passes through to the game everywhere except over the regions the UI marks
//! as interactive (the inbox card). Keyboard focus is only taken when you ask for it
//! (hotkey or click), and handed back to the window that had it before.

use serde::Deserialize;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

pub const LABEL: &str = "overlay";

/// A rectangle in physical pixels, relative to the overlay window.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Rect {
    fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x && y >= self.y && x <= self.x + self.width && y <= self.y + self.height
    }
}

#[derive(Default)]
pub struct OverlayState {
    pub hit_regions: Mutex<Vec<Rect>>,
    /// The window that had focus before the overlay took it (an HWND on Windows).
    pub previous_foreground: Mutex<Option<isize>>,
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
    let _ = window.set_ignore_cursor_events(true);
    let _ = window.set_always_on_top(true);
    let _ = window.show();
    platform::make_non_activating(&window);
}

/// Toggles click-through depending on whether the cursor is over an interactive region.
pub fn spawn_hit_test_loop(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut interactive = false;
        loop {
            tokio::time::sleep(Duration::from_millis(40)).await;
            let Some(window) = window(&app) else { continue };
            let state = app.state::<OverlayState>();
            let over = match (window.cursor_position(), window.outer_position()) {
                (Ok(cursor), Ok(origin)) => {
                    let x = cursor.x - origin.x as f64;
                    let y = cursor.y - origin.y as f64;
                    state.hit_regions.lock().unwrap().iter().any(|r| r.contains(x, y))
                }
                _ => false,
            };
            if over != interactive {
                interactive = over;
                let _ = window.set_ignore_cursor_events(!over);
            }
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

#[cfg(windows)]
mod platform {
    use tauri::WebviewWindow;
    use windows::core::{w, PCWSTR};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
    use windows::Win32::UI::WindowsAndMessaging::{
        BringWindowToTop, FindWindowW, GetForegroundWindow, GetWindowLongPtrW,
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

    pub fn foreground() -> Option<isize> {
        let h = unsafe { GetForegroundWindow() };
        (!h.0.is_null()).then_some(h.0 as isize)
    }

    /// Keeps the window out of Alt+Tab.
    pub fn make_non_activating(window: &WebviewWindow) {
        if let Some(h) = raw(window) {
            unsafe {
                let style = GetWindowLongPtrW(h, GWL_EXSTYLE);
                SetWindowLongPtrW(h, GWL_EXSTYLE, style | WS_EX_TOOLWINDOW.0 as isize);
            }
        }
    }

    /// Windows only lets the foreground thread change focus. Briefly attaching to its input
    /// queue lets us take focus right after a global hotkey.
    pub fn force_focus(window: &WebviewWindow) {
        let Some(target) = raw(window) else { return };
        unsafe {
            let fg = GetForegroundWindow();
            let fg_thread = GetWindowThreadProcessId(fg, None);
            let our_thread = GetCurrentThreadId();
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
    pub fn force_focus(window: &WebviewWindow) {
        let _ = window.set_focus();
    }
    pub fn restore_focus(_previous: Option<isize>) {}
}
