//! Game awareness through Riot's official, read-only Live Client Data API
//! (https://developer.riotgames.com/docs/lol#game-client-api). It is served by the game
//! client on https://127.0.0.1:2999 while a game is running. Nothing here touches the game
//! process itself.

use serde::Serialize;
use serde_json::Value;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const BASE: &str = "https://127.0.0.1:2999/liveclientdata";

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameState {
    pub in_game: bool,
    pub dead: bool,
    /// Seconds until respawn, while dead.
    pub respawn_seconds: f64,
    pub game_ended: bool,
    pub game_time: f64,
    /// The League client (lobby) window is open and not minimized.
    pub client_open: bool,
}

/// The latest state, for windows that start listening after it was emitted.
static LAST: Mutex<Option<GameState>> = Mutex::new(None);

pub fn current() -> GameState {
    LAST.lock().unwrap().clone().unwrap_or_default()
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        // The game client uses a self-signed certificate on loopback.
        .danger_accept_invalid_certs(true)
        .timeout(Duration::from_millis(800))
        .build()
        .expect("http client")
}

async fn get(http: &reqwest::Client, path: &str) -> Option<Value> {
    let response = http.get(format!("{BASE}{path}")).send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    response.json().await.ok()
}

fn same_player(entry: &Value, active: &str) -> bool {
    let field = |name: &str| entry.get(name).and_then(Value::as_str).unwrap_or("");
    let riot_id = field("riotId");
    let game_name = field("riotIdGameName");
    let summoner = field("summonerName");
    let active_name = active.split('#').next().unwrap_or(active);
    (!riot_id.is_empty() && riot_id == active)
        || (!summoner.is_empty() && (summoner == active || summoner == active_name))
        || (!game_name.is_empty() && game_name == active_name)
}

pub fn parse_state(active_name: &str, players: &Value, events: Option<&Value>, stats: Option<&Value>) -> GameState {
    let me = players
        .as_array()
        .and_then(|list| list.iter().find(|p| same_player(p, active_name)));
    let dead = me.and_then(|p| p.get("isDead")).and_then(Value::as_bool).unwrap_or(false);
    let respawn_seconds = if dead {
        me.and_then(|p| p.get("respawnTimer")).and_then(Value::as_f64).unwrap_or(0.0)
    } else {
        0.0
    };
    let game_ended = events
        .and_then(|e| e.get("Events"))
        .and_then(Value::as_array)
        .is_some_and(|list| {
            list.iter()
                .any(|e| e.get("EventName").and_then(Value::as_str) == Some("GameEnd"))
        });
    let game_time = stats
        .and_then(|s| s.get("gameTime"))
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    GameState { in_game: true, dead, respawn_seconds, game_ended, game_time, client_open: false }
}

async fn poll_once(http: &reqwest::Client) -> GameState {
    let Some(active) = get(http, "/activeplayername").await else {
        return GameState::default();
    };
    let active = active.as_str().unwrap_or_default().to_string();
    let Some(players) = get(http, "/playerlist").await else {
        return GameState { in_game: true, ..Default::default() };
    };
    let events = get(http, "/eventdata").await;
    let stats = get(http, "/gamestats").await;
    parse_state(&active, &players, events.as_ref(), stats.as_ref())
}

/// Polls forever and emits `game://state` whenever something changes.
pub fn spawn_watcher(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let http = client();
        let mut last: Option<GameState> = None;
        loop {
            let mut state = poll_once(&http).await;
            state.client_open = platform::client_open();
            if last.as_ref() != Some(&state) {
                let _ = app.emit("game://state", &state);
                *LAST.lock().unwrap() = Some(state.clone());
                last = Some(state.clone());
            }
            let delay = if state.in_game { 1000 } else { 3000 };
            tokio::time::sleep(Duration::from_millis(delay)).await;
        }
    });
}

#[cfg(windows)]
mod platform {
    use windows::core::{w, PCWSTR};
    use windows::Win32::UI::WindowsAndMessaging::{FindWindowW, IsIconic, IsWindowVisible};

    /// The League client's main window (LeagueClientUx) has the class `RCLIENT`.
    pub fn client_open() -> bool {
        unsafe {
            FindWindowW(w!("RCLIENT"), PCWSTR::null())
                .map(|h| IsWindowVisible(h).as_bool() && !IsIconic(h).as_bool())
                .unwrap_or(false)
        }
    }
}

#[cfg(not(windows))]
mod platform {
    pub fn client_open() -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn detects_death_by_riot_id() {
        let players = json!([
            {"riotId":"Other#EUW","summonerName":"Other#EUW","isDead":true,"respawnTimer":10.0},
            {"riotId":"Egg#EUW","riotIdGameName":"Egg","summonerName":"Egg#EUW","isDead":true,"respawnTimer":23.5}
        ]);
        let state = parse_state("Egg#EUW", &players, None, Some(&json!({"gameTime": 1085.2})));
        assert!(state.in_game && state.dead);
        assert_eq!(state.respawn_seconds, 23.5);
        assert_eq!(state.game_time, 1085.2);
    }

    #[test]
    fn matches_legacy_summoner_name() {
        let players = json!([{"summonerName":"Egg","isDead":false,"respawnTimer":0.0}]);
        let state = parse_state("Egg#EUW", &players, None, None);
        assert!(!state.dead);
    }

    #[test]
    fn detects_game_end() {
        let events = json!({"Events":[{"EventName":"GameStart"},{"EventName":"GameEnd","Result":"Win"}]});
        let state = parse_state("x", &json!([]), Some(&events), None);
        assert!(state.game_ended);
    }
}
