//! Voice input through Hex's local control API (https://github.com/anomalyco/hex).
//!
//! Hex writes `%APPDATA%\hex\local-api.json` with a random loopback port and a bearer token.
//! We send `dictation start` when the push-to-talk key goes down and `dictation stop` with
//! `print: true` when it comes up. With `print`, Hex returns the transcript in the HTTP
//! response and never pastes or touches the clipboard, so nothing can land in the game.

use anyhow::{anyhow, bail, Context, Result};
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::time::Duration;

const CONTROL_VERSION: u32 = 4;

#[derive(Debug, Deserialize)]
struct Discovery {
    port: u16,
    token: String,
}

fn discovery_path() -> Option<PathBuf> {
    if let Ok(dir) = std::env::var("HEX_APPLICATION_SUPPORT_DIR") {
        return Some(PathBuf::from(dir).join("local-api.json"));
    }
    #[cfg(windows)]
    {
        std::env::var_os("APPDATA").map(|appdata| PathBuf::from(appdata).join("hex").join("local-api.json"))
    }
    #[cfg(target_os = "macos")]
    {
        std::env::var_os("HOME").map(|home| {
            PathBuf::from(home).join("Library/Application Support/hex/local-api.json")
        })
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")))
            .map(|dir| dir.join("hex").join("local-api.json"))
    }
}

/// Hex rewrites the file with a new port on every launch, so it is read per request.
fn discover() -> Result<Discovery> {
    let path = discovery_path().ok_or_else(|| anyhow!("Could not locate Hex's data folder"))?;
    let text = std::fs::read_to_string(&path)
        .with_context(|| "Hex is not running (no local-api.json). Start Hex and try again.")?;
    serde_json::from_str(&text).context("Hex's local-api.json could not be read")
}

pub struct Hex {
    http: reqwest::Client,
}

impl Hex {
    pub fn new() -> Self {
        Self {
            http: reqwest::Client::builder()
                // stop+print waits up to 60 s for the transcript; Hex's own deadline is 65 s.
                .timeout(Duration::from_secs(75))
                .build()
                .expect("http client"),
        }
    }

    async fn control(&self, body: Value) -> Result<Value> {
        let discovery = discover()?;
        let response = self
            .http
            .post(format!("http://127.0.0.1:{}/control", discovery.port))
            .bearer_auth(&discovery.token)
            .json(&body)
            .send()
            .await
            .context("Could not reach Hex. Is it running?")?;
        let status = response.status();
        let value: Value = response.json().await.unwrap_or(Value::Null);
        if !status.is_success() {
            let code = value.get("code").and_then(Value::as_str).unwrap_or("error");
            bail!("Hex returned {status} ({code})");
        }
        if value.get("status").and_then(Value::as_str) == Some("error") {
            let code = value.get("code").and_then(Value::as_str).unwrap_or("failed");
            let message = value.get("message").and_then(Value::as_str).unwrap_or("");
            bail!("{}", friendly_error(code, message));
        }
        Ok(value)
    }

    fn dictation(action: &str, print: bool) -> Value {
        let mut body = json!({ "version": CONTROL_VERSION, "command": "dictation", "action": action });
        if print {
            body["print"] = json!(true);
        }
        body
    }

    pub async fn start(&self) -> Result<()> {
        self.control(Self::dictation("start", false)).await.map(|_| ())
    }

    /// Stops recording and returns the transcript. Never pastes.
    pub async fn stop_and_transcribe(&self) -> Result<String> {
        let value = self.control(Self::dictation("stop", true)).await?;
        match value.get("status").and_then(Value::as_str) {
            Some("transcript") => Ok(value
                .get("text")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
                .to_string()),
            other => bail!("Hex did not return a transcript ({})", other.unwrap_or("no status")),
        }
    }

    pub async fn cancel(&self) -> Result<()> {
        self.control(Self::dictation("cancel", false)).await.map(|_| ())
    }

    /// `Ok(state)` like "idle" when Hex answers, an error explaining why not otherwise.
    pub async fn status(&self) -> Result<String> {
        let value = self
            .control(json!({ "version": CONTROL_VERSION, "command": "status" }))
            .await?;
        Ok(value
            .pointer("/capture/state")
            .or_else(|| value.pointer("/report/capture/state"))
            .and_then(Value::as_str)
            .unwrap_or("ready")
            .to_string())
    }
}

fn friendly_error(code: &str, message: &str) -> String {
    match code {
        "no-speech" => "Hex didn't hear anything.".into(),
        "not-recording" => "Hex wasn't recording.".into(),
        "version-mismatch" => "This Hex version is not supported. Update Hex.".into(),
        _ if !message.is_empty() => format!("Hex: {message}"),
        _ => format!("Hex error: {code}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stop_body_requests_print() {
        assert_eq!(
            Hex::dictation("stop", true),
            json!({"version":4,"command":"dictation","action":"stop","print":true})
        );
        assert_eq!(
            Hex::dictation("start", false),
            json!({"version":4,"command":"dictation","action":"start"})
        );
    }
}
