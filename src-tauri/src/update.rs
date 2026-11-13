//! Rolling updates from GitHub Releases.
//!
//! Every push to `main` publishes a signed release. The overlay checks for one every few
//! minutes, downloads it in the background, and installs it silently as soon as you're not
//! using the overlay (inbox closed, not dictating). The installer restarts the app, which
//! then shows a short "updated" notice.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;
use tokio::sync::Notify;

const FIRST_CHECK: Duration = Duration::from_secs(15);
const CHECK_EVERY: Duration = Duration::from_secs(5 * 60);
/// The overlay must be idle this long before an update is installed.
const IDLE_FOR: Duration = Duration::from_secs(3);

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "phase", rename_all = "camelCase")]
pub enum Status {
    Idle,
    Checking,
    UpToDate,
    Downloading { version: String },
    Ready { version: String },
    Installing { version: String },
    Error { message: String },
}

/// Written right before installing, read once after the restart.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Installed {
    pub version: String,
    pub notes: String,
}

pub struct Updates {
    status: Mutex<Status>,
    /// Automatic checks are on (from settings).
    pub auto: AtomicBool,
    /// The overlay UI is in use (inbox open, dictating, sending).
    pub overlay_busy: AtomicBool,
    /// "Check now" was pressed: install even if the Settings window is open.
    manual: AtomicBool,
    /// "Install now" was pressed in the inbox: don't wait for the overlay to be idle.
    force: AtomicBool,
    wake: Notify,
    /// The update we just restarted from, if any.
    installed: Mutex<Option<Installed>>,
}

impl Updates {
    pub fn new(auto: bool, app: &AppHandle) -> Self {
        let installed = notice_path(app).and_then(|path| {
            let text = std::fs::read_to_string(&path).ok()?;
            let _ = std::fs::remove_file(&path);
            serde_json::from_str(&text).ok()
        });
        Self {
            status: Mutex::new(Status::Idle),
            auto: AtomicBool::new(auto),
            overlay_busy: AtomicBool::new(false),
            manual: AtomicBool::new(false),
            force: AtomicBool::new(false),
            wake: Notify::new(),
            installed: Mutex::new(installed),
        }
    }

    pub fn status(&self) -> Status {
        self.status.lock().unwrap().clone()
    }

    pub fn check_now(&self) {
        self.manual.store(true, Ordering::SeqCst);
        self.wake.notify_one();
    }

    /// Check (if needed) and install right away, even with the inbox open.
    pub fn install_now(&self) {
        self.force.store(true, Ordering::SeqCst);
        self.check_now();
    }

    pub fn take_installed(&self) -> Option<Installed> {
        self.installed.lock().unwrap().take()
    }
}

fn notice_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("updated.json"))
}

fn set(app: &AppHandle, status: Status) {
    *app.state::<Updates>().status.lock().unwrap() = status.clone();
    let _ = app.emit("update://status", status);
}

pub fn spawn(app: AppHandle) {
    // Dev builds (`npm run app:dev`) never replace themselves.
    if cfg!(debug_assertions) {
        return;
    }
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_CHECK).await;
        loop {
            let updates = app.state::<Updates>();
            if updates.auto.load(Ordering::SeqCst) || updates.manual.load(Ordering::SeqCst) {
                if let Err(e) = check_and_install(&app).await {
                    log::warn!("update failed: {e:#}");
                    set(&app, Status::Error { message: format!("{e:#}") });
                }
                updates.manual.store(false, Ordering::SeqCst);
                updates.force.store(false, Ordering::SeqCst);
            }
            tokio::select! {
                _ = tokio::time::sleep(CHECK_EVERY) => {}
                _ = updates.wake.notified() => {}
            }
        }
    });
}

async fn check_and_install(app: &AppHandle) -> anyhow::Result<()> {
    set(app, Status::Checking);
    let Some(update) = app.updater()?.check().await? else {
        set(app, Status::UpToDate);
        return Ok(());
    };
    let version = update.version.clone();
    set(app, Status::Downloading { version: version.clone() });
    let bytes = update.download(|_, _| {}, || {}).await?;
    set(app, Status::Ready { version: version.clone() });

    wait_until_idle(app).await;

    set(app, Status::Installing { version: version.clone() });
    if let Some(path) = notice_path(app) {
        let notes = update.body.clone().unwrap_or_default();
        let _ = std::fs::write(path, serde_json::to_string(&Installed { version, notes })?);
    }
    // On Windows this starts the silent installer and exits; the installer restarts us.
    update.install(bytes)?;
    app.restart();
}

/// Waits until the overlay hasn't been in use for a few seconds, so an update never
/// interrupts reading or replying.
async fn wait_until_idle(app: &AppHandle) {
    let updates = app.state::<Updates>();
    let mut idle_since = None;
    loop {
        if updates.force.load(Ordering::SeqCst) {
            return;
        }
        let settings_open = app
            .get_webview_window("settings")
            .and_then(|w| w.is_visible().ok())
            .unwrap_or(false);
        let busy = updates.overlay_busy.load(Ordering::SeqCst)
            || (settings_open && !updates.manual.load(Ordering::SeqCst));
        if busy {
            idle_since = None;
        } else {
            let since = *idle_since.get_or_insert_with(std::time::Instant::now);
            if since.elapsed() >= IDLE_FOR {
                return;
            }
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
}
