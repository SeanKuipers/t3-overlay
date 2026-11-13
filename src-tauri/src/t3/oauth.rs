//! Connects to T3 Code the way any MCP client does: OAuth 2.1 authorization code + PKCE,
//! dynamic client registration, and a loopback redirect (RFC 8252).
//!
//! The approval itself happens on T3 Code's own `/connect-agent` page in your browser.

use anyhow::{anyhow, Context, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::{distributions::Alphanumeric, Rng};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use crate::config::StoredAuth;

const CLIENT_NAME: &str = "T3 Overlay";
const CALLBACK_PATH: &str = "/callback";
const APPROVAL_TIMEOUT: Duration = Duration::from_secs(10 * 60);

#[derive(Debug, Deserialize)]
struct ServerMetadata {
    authorization_endpoint: String,
    token_endpoint: String,
    registration_endpoint: String,
}

#[derive(Debug, Deserialize)]
struct RegisteredClient {
    client_id: String,
}

#[derive(Debug, Deserialize)]
struct TokenResult {
    access_token: String,
    expires_in: u64,
}

fn random_string(len: usize) -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(len)
        .map(char::from)
        .collect()
}

fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Runs the whole flow. `open_browser` is called once with the approval URL.
pub async fn authorize(
    http: &reqwest::Client,
    server_url: &str,
    open_browser: impl FnOnce(&str) -> Result<()>,
) -> Result<StoredAuth> {
    let meta: ServerMetadata = http
        .get(format!("{server_url}/.well-known/oauth-authorization-server"))
        .send()
        .await
        .with_context(|| format!("Could not reach T3 Code at {server_url}"))?
        .error_for_status()
        .context("This server does not look like T3 Code (no OAuth metadata)")?
        .json()
        .await
        .context("Unexpected OAuth metadata from the server")?;

    // Loopback redirects match on host and path only, so any free port works.
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();
    let redirect_uri = format!("http://127.0.0.1:{port}{CALLBACK_PATH}");

    let client: RegisteredClient = http
        .post(&meta.registration_endpoint)
        .json(&serde_json::json!({
            "client_name": CLIENT_NAME,
            "redirect_uris": [redirect_uri],
            "token_endpoint_auth_method": "none",
        }))
        .send()
        .await?
        .error_for_status()
        .context("T3 Code refused to register the overlay")?
        .json()
        .await?;

    let verifier = random_string(64);
    let state = random_string(32);
    let resource = format!("{server_url}/mcp");
    let mut url = url::Url::parse(&meta.authorization_endpoint)?;
    url.query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", &client.client_id)
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("code_challenge", &pkce_challenge(&verifier))
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", &state)
        .append_pair("resource", &resource);

    open_browser(url.as_str())?;

    let code = tokio::time::timeout(APPROVAL_TIMEOUT, wait_for_callback(listener, &state))
        .await
        .map_err(|_| anyhow!("Timed out waiting for approval in the browser"))??;

    let token: TokenResult = http
        .post(&meta.token_endpoint)
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", code.as_str()),
            ("redirect_uri", redirect_uri.as_str()),
            ("client_id", client.client_id.as_str()),
            ("code_verifier", verifier.as_str()),
            ("resource", resource.as_str()),
        ])
        .send()
        .await?
        .error_for_status()
        .context("T3 Code refused the token exchange")?
        .json()
        .await?;

    Ok(StoredAuth {
        server_url: server_url.to_string(),
        client_id: client.client_id,
        access_token: token.access_token,
        expires_at_ms: now_ms() + token.expires_in * 1000,
    })
}

/// Serves the redirect and returns the authorization code. Ignores stray requests
/// (favicon, prefetch) until the real callback arrives.
async fn wait_for_callback(listener: TcpListener, expected_state: &str) -> Result<String> {
    loop {
        let (mut socket, _) = listener.accept().await?;
        let mut buf = vec![0u8; 8192];
        let n = socket.read(&mut buf).await.unwrap_or(0);
        let request = String::from_utf8_lossy(&buf[..n]);
        let target = request
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
            .unwrap_or("/");
        let url = url::Url::parse(&format!("http://127.0.0.1{target}"))?;
        if url.path() != CALLBACK_PATH {
            let _ = socket
                .write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                .await;
            continue;
        }
        let param = |name: &str| {
            url.query_pairs()
                .find(|(k, _)| k == name)
                .map(|(_, v)| v.into_owned())
        };
        let result = match (param("error"), param("code"), param("state")) {
            (Some(error), _, _) => Err(anyhow!(
                "Approval failed: {}",
                param("error_description").unwrap_or(error)
            )),
            (None, Some(code), Some(state)) if state == expected_state => Ok(code),
            (None, Some(_), _) => Err(anyhow!("Approval response had the wrong state")),
            _ => Err(anyhow!("Approval response had no code")),
        };
        let (title, body) = match &result {
            Ok(_) => ("Connected", "T3 Overlay is connected. You can close this tab and go play."),
            Err(_) => ("Not connected", "T3 Overlay was not connected. Check the overlay's settings window."),
        };
        let html = format!(
            "<!doctype html><meta charset=utf-8><title>{title}</title>\
             <body style=\"font-family:system-ui;background:#0c0e14;color:#e8e8ea;display:grid;place-items:center;height:100vh;margin:0\">\
             <div><h2>{title}</h2><p>{body}</p></div>"
        );
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{html}",
            html.len()
        );
        let _ = socket.write_all(response.as_bytes()).await;
        let _ = socket.shutdown().await;
        return result;
    }
}

pub fn is_expired(auth: &StoredAuth) -> bool {
    auth.expires_at_ms <= now_ms() + 60_000
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_matches_rfc7636_example() {
        // RFC 7636 Appendix B.
        assert_eq!(
            pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn verifier_is_valid_length() {
        let v = random_string(64);
        assert!(v.len() >= 43 && v.len() <= 128);
        assert_eq!(pkce_challenge(&v).len(), 43);
    }
}
