//! User settings and the stored T3 credential, both kept as JSON in the app's config dir.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    /// Base URL of the T3 Code server, e.g. `http://100.88.1.2:3773`.
    pub server_url: String,
    /// Toggles and focuses the inbox.
    pub hotkey_inbox: String,
    /// Hold to dictate with Hex, release to send.
    pub hotkey_voice: String,
    pub voice_enabled: bool,
    /// Switch threads. Only registered while the inbox is open.
    pub hotkey_prev: String,
    pub hotkey_next: String,
    /// Open the inbox automatically while your champion is dead.
    pub open_on_death: bool,
    /// Open the inbox when the game ends and keep it open until dismissed.
    pub open_on_game_end: bool,
    /// Show the ticker even when no League game is running.
    pub ticker_outside_game: bool,
    /// Threads updated within this many hours are shown.
    pub recent_hours: u32,
    /// How often T3 is polled, in seconds.
    pub poll_seconds: u32,
    /// How Enter sends a reply: "queue" (next turn), "steer" (into the running turn) or
    /// "auto" (T3 decides). Ctrl+Enter sends the other of queue/steer.
    pub send_mode: String,
    /// Install new releases automatically when the overlay isn't in use.
    pub auto_update: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            server_url: String::new(),
            hotkey_inbox: "Ctrl+Shift+Space".into(),
            hotkey_voice: "Ctrl+Shift+V".into(),
            voice_enabled: true,
            hotkey_prev: "Ctrl+Shift+Q".into(),
            hotkey_next: "Ctrl+Shift+E".into(),
            open_on_death: true,
            open_on_game_end: true,
            ticker_outside_game: false,
            recent_hours: 12,
            poll_seconds: 4,
            send_mode: "queue".into(),
            auto_update: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredAuth {
    pub server_url: String,
    pub client_id: String,
    pub access_token: String,
    /// Unix epoch milliseconds.
    pub expires_at_ms: u64,
}

fn dir(app: &AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("t3-overlay"));
    let _ = std::fs::create_dir_all(&dir);
    dir
}

fn read_json<T: for<'de> Deserialize<'de>>(path: PathBuf) -> Option<T> {
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

fn write_json<T: Serialize>(path: PathBuf, value: &T) -> anyhow::Result<()> {
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(value)?)?;
    std::fs::rename(tmp, path)?;
    Ok(())
}

pub fn load_config(app: &AppHandle) -> Config {
    read_json(dir(app).join("config.json")).unwrap_or_default()
}

pub fn save_config(app: &AppHandle, config: &Config) -> anyhow::Result<()> {
    write_json(dir(app).join("config.json"), config)
}

pub fn load_auth(app: &AppHandle) -> Option<StoredAuth> {
    read_json(dir(app).join("auth.json"))
}

pub fn save_auth(app: &AppHandle, auth: Option<&StoredAuth>) -> anyhow::Result<()> {
    let path = dir(app).join("auth.json");
    match auth {
        Some(auth) => write_json(path, auth),
        None => {
            let _ = std::fs::remove_file(path);
            Ok(())
        }
    }
}

/// Trims whitespace and trailing slashes, and adds `http://` when no scheme is given.
pub fn normalize_server_url(raw: &str) -> String {
    let trimmed = raw.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return String::new();
    }
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("http://{trimmed}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_urls() {
        assert_eq!(normalize_server_url(" 100.1.2.3:3773/ "), "http://100.1.2.3:3773");
        assert_eq!(normalize_server_url("https://t3.example.com/"), "https://t3.example.com");
        assert_eq!(normalize_server_url(""), "");
    }
}
