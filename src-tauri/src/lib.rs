mod config;
mod game;
mod hex;
mod overlay;
mod t3;

use serde::Serialize;
use serde_json::Value;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tokio::sync::RwLock;

use config::{Config, StoredAuth};
use t3::mcp::McpClient;

struct AppState {
    config: Mutex<Config>,
    auth: Mutex<Option<StoredAuth>>,
    t3: RwLock<Option<Arc<McpClient>>>,
    hex: hex::Hex,
    hotkeys: Mutex<Hotkeys>,
    recording: AtomicBool,
}

#[derive(Default)]
struct Hotkeys {
    inbox: Option<Shortcut>,
    voice: Option<Shortcut>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ConnectionStatus {
    server_url: String,
    connected: bool,
    expires_at_ms: Option<u64>,
}

#[derive(Serialize, Clone)]
#[serde(tag = "phase", rename_all = "camelCase")]
enum VoiceEvent {
    Recording,
    Transcribing,
    Transcript { text: String },
    Cancelled,
    Error { message: String },
}

// ---------- commands ----------

#[tauri::command]
fn get_config(state: State<'_, AppState>) -> Config {
    state.config.lock().unwrap().clone()
}

#[tauri::command]
fn save_config(app: AppHandle, state: State<'_, AppState>, mut config: Config) -> Result<Config, String> {
    config.server_url = config::normalize_server_url(&config.server_url);
    config.poll_seconds = config.poll_seconds.clamp(2, 60);
    config.recent_hours = config.recent_hours.clamp(1, 24 * 14);
    register_hotkeys(&app, &config)?;
    config::save_config(&app, &config).map_err(|e| e.to_string())?;
    *state.config.lock().unwrap() = config.clone();
    let _ = app.emit("config://changed", &config);
    Ok(config)
}

#[tauri::command]
fn t3_status(state: State<'_, AppState>) -> ConnectionStatus {
    status_of(&state)
}

fn status_of(state: &AppState) -> ConnectionStatus {
    let server_url = state.config.lock().unwrap().server_url.clone();
    let auth = state.auth.lock().unwrap().clone();
    let valid = auth.filter(|a| a.server_url == server_url && !t3::oauth::is_expired(a));
    ConnectionStatus {
        server_url,
        connected: valid.is_some(),
        expires_at_ms: valid.map(|a| a.expires_at_ms),
    }
}

#[tauri::command]
async fn t3_connect(app: AppHandle, state: State<'_, AppState>, server_url: String) -> Result<ConnectionStatus, String> {
    let server_url = config::normalize_server_url(&server_url);
    if server_url.is_empty() {
        return Err("Enter your T3 Code server address first.".into());
    }
    let http = t3::http_client();
    let opener = app.clone();
    let auth = t3::oauth::authorize(&http, &server_url, move |url| {
        overlay::allow_others_to_take_focus();
        tauri_plugin_opener::open_url(url, None::<&str>).map_err(|e| anyhow::anyhow!(e.to_string()))?;
        let _ = opener.emit("t3://approval-opened", url);
        Ok(())
    })
    .await
    .map_err(|e| format!("{e:#}"))?;

    config::save_auth(&app, Some(&auth)).map_err(|e| e.to_string())?;
    {
        let mut config = state.config.lock().unwrap();
        config.server_url = server_url.clone();
        config::save_config(&app, &config).map_err(|e| e.to_string())?;
    }
    *state.t3.write().await = Some(Arc::new(McpClient::new(http, &server_url, auth.access_token.clone())));
    *state.auth.lock().unwrap() = Some(auth);
    let status = status_of(&state);
    let _ = app.emit("t3://connection", &status);
    // Come back from the browser so you can see it worked.
    if let Some(settings) = app.get_webview_window("settings") {
        overlay::bring_to_front(&settings);
    }
    Ok(status)
}

#[tauri::command]
async fn t3_disconnect(app: AppHandle, state: State<'_, AppState>) -> Result<ConnectionStatus, String> {
    config::save_auth(&app, None).map_err(|e| e.to_string())?;
    *state.auth.lock().unwrap() = None;
    *state.t3.write().await = None;
    let status = status_of(&state);
    let _ = app.emit("t3://connection", &status);
    Ok(status)
}

/// Calls one of the allowed T3 tools. Errors are `{kind, message}` objects.
#[tauri::command]
async fn t3_call(state: State<'_, AppState>, tool: String, args: Value) -> Result<Value, Value> {
    t3::check_allowed(&tool).map_err(|m| serde_json::json!({ "kind": "tool", "message": m }))?;
    let client = state.t3.read().await.clone();
    let Some(client) = client else {
        return Err(serde_json::json!({ "kind": "unauthorized", "message": "Not connected to T3 Code." }));
    };
    client.call_tool(&tool, args).await.map_err(|e| t3::error_payload(&e))
}

#[tauri::command]
fn set_hit_regions(state: State<'_, overlay::OverlayState>, regions: Vec<overlay::Rect>) {
    *state.hit_regions.lock().unwrap() = regions;
}

#[tauri::command]
fn overlay_focus(app: AppHandle) {
    overlay::take_focus(&app);
}

#[tauri::command]
fn overlay_release(app: AppHandle) {
    overlay::release_focus(&app);
}

#[tauri::command]
fn open_settings(app: AppHandle) -> Result<(), String> {
    show_settings(&app).map_err(|e| e.to_string())
}

#[tauri::command]
async fn hex_status(state: State<'_, AppState>) -> Result<String, String> {
    state.hex.status().await.map_err(|e| format!("{e:#}"))
}

#[tauri::command]
async fn voice_cancel(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    if state.recording.swap(false, Ordering::SeqCst) {
        let _ = state.hex.cancel().await;
        let _ = app.emit("voice://state", VoiceEvent::Cancelled);
    }
    Ok(())
}

// ---------- hotkeys & voice ----------

fn parse_shortcut(text: &str, what: &str) -> Result<Option<Shortcut>, String> {
    let text = text.trim();
    if text.is_empty() {
        return Ok(None);
    }
    text.parse::<Shortcut>()
        .map(Some)
        .map_err(|e| format!("Invalid {what} hotkey \"{text}\": {e}"))
}

fn register_hotkeys(app: &AppHandle, config: &Config) -> Result<(), String> {
    let inbox = parse_shortcut(&config.hotkey_inbox, "inbox")?;
    let voice = if config.voice_enabled {
        parse_shortcut(&config.hotkey_voice, "voice")?
    } else {
        None
    };
    if inbox.is_some() && inbox == voice {
        return Err("The inbox and voice hotkeys must be different.".into());
    }
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    for shortcut in [inbox, voice].into_iter().flatten() {
        gs.register(shortcut)
            .map_err(|e| format!("Could not register {shortcut:?} (another app may use it): {e}"))?;
    }
    let state = app.state::<AppState>();
    *state.hotkeys.lock().unwrap() = Hotkeys { inbox, voice };
    Ok(())
}

fn on_shortcut(app: &AppHandle, shortcut: &Shortcut, pressed: bool) {
    let state = app.state::<AppState>();
    let (is_inbox, is_voice) = {
        let hk = state.hotkeys.lock().unwrap();
        (hk.inbox.as_ref() == Some(shortcut), hk.voice.as_ref() == Some(shortcut))
    };
    if is_inbox && pressed {
        let _ = app.emit("hotkey://inbox", ());
    } else if is_voice {
        if pressed {
            voice_start(app);
        } else {
            voice_stop(app);
        }
    }
}

fn voice_start(app: &AppHandle) {
    let state = app.state::<AppState>();
    if state.recording.swap(true, Ordering::SeqCst) {
        return; // key repeat
    }
    let _ = app.emit("voice://state", VoiceEvent::Recording);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let state = app.state::<AppState>();
        if let Err(e) = state.hex.start().await {
            state.recording.store(false, Ordering::SeqCst);
            let _ = app.emit("voice://state", VoiceEvent::Error { message: format!("{e:#}") });
        }
    });
}

fn voice_stop(app: &AppHandle) {
    let state = app.state::<AppState>();
    if !state.recording.swap(false, Ordering::SeqCst) {
        return;
    }
    let _ = app.emit("voice://state", VoiceEvent::Transcribing);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let state = app.state::<AppState>();
        let event = match state.hex.stop_and_transcribe().await {
            Ok(text) if text.is_empty() => VoiceEvent::Error { message: "Hex didn't hear anything.".into() },
            Ok(text) => VoiceEvent::Transcript { text },
            Err(e) => VoiceEvent::Error { message: format!("{e:#}") },
        };
        let _ = app.emit("voice://state", event);
    });
}

// ---------- windows & tray ----------

fn show_settings(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("settings") {
        overlay::bring_to_front(&window);
        return Ok(());
    }
    WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("index.html?view=settings".into()))
        .title("T3 Overlay — Settings")
        .inner_size(560.0, 720.0)
        .min_inner_size(480.0, 560.0)
        .center()
        .build()?;
    Ok(())
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let inbox = MenuItem::with_id(app, "inbox", "Open inbox", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit T3 Overlay", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&inbox, &settings, &quit])?;
    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("T3 Overlay")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "inbox" => {
                let _ = app.emit("hotkey://inbox", ());
            }
            "settings" => {
                let _ = show_settings(app);
            }
            "quit" => app.exit(0),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = show_settings(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    on_shortcut(app, shortcut, event.state() == ShortcutState::Pressed);
                })
                .build(),
        )
        .manage(overlay::OverlayState::default())
        .setup(|app| {
            let handle = app.handle().clone();
            let config = config::load_config(&handle);
            let auth = config::load_auth(&handle);
            let client = auth
                .as_ref()
                .filter(|a| a.server_url == config.server_url && !t3::oauth::is_expired(a))
                .map(|a| Arc::new(McpClient::new(t3::http_client(), &a.server_url, a.access_token.clone())));
            let needs_setup = client.is_none();
            app.manage(AppState {
                config: Mutex::new(config.clone()),
                auth: Mutex::new(auth),
                t3: RwLock::new(client),
                hex: hex::Hex::new(),
                hotkeys: Mutex::new(Hotkeys::default()),
                recording: AtomicBool::new(false),
            });
            if let Err(e) = register_hotkeys(&handle, &config) {
                log::warn!("{e}");
            }
            build_tray(&handle)?;
            overlay::place_and_show(&handle);
            overlay::spawn_hit_test_loop(handle.clone());
            game::spawn_watcher(handle.clone());
            if needs_setup {
                let _ = show_settings(&handle);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            t3_status,
            t3_connect,
            t3_disconnect,
            t3_call,
            set_hit_regions,
            overlay_focus,
            overlay_release,
            open_settings,
            hex_status,
            voice_cancel,
        ])
        .run(tauri::generate_context!())
        .expect("error while running T3 Overlay");
}
