//! A small MCP client for the Streamable HTTP transport: JSON-RPC over POST, with the
//! response either plain JSON or a server-sent event stream.

use anyhow::{anyhow, bail, Result};
use reqwest::header::{HeaderMap, ACCEPT, AUTHORIZATION, CONTENT_TYPE};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::sync::Mutex;

const PROTOCOL_VERSION: &str = "2025-06-18";
const SESSION_HEADER: &str = "mcp-session-id";
const PROTOCOL_HEADER: &str = "mcp-protocol-version";

#[derive(Debug, thiserror::Error)]
pub enum McpError {
    #[error("T3 Code rejected the overlay's credential. Reconnect in Settings.")]
    Unauthorized,
    #[error("{0}")]
    Tool(String),
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

struct Session {
    id: Option<String>,
    protocol_version: String,
}

pub struct McpClient {
    http: reqwest::Client,
    endpoint: String,
    token: String,
    next_id: AtomicU64,
    session: Mutex<Option<Session>>,
}

impl McpClient {
    pub fn new(http: reqwest::Client, server_url: &str, token: String) -> Self {
        Self {
            http,
            endpoint: format!("{server_url}/mcp"),
            token,
            next_id: AtomicU64::new(1),
            session: Mutex::new(None),
        }
    }

    fn headers(&self, session: Option<&Session>) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(AUTHORIZATION, format!("Bearer {}", self.token).parse().unwrap());
        headers.insert(ACCEPT, "application/json, text/event-stream".parse().unwrap());
        headers.insert(CONTENT_TYPE, "application/json".parse().unwrap());
        if let Some(session) = session {
            if let Some(id) = &session.id {
                if let Ok(value) = id.parse() {
                    headers.insert(SESSION_HEADER, value);
                }
            }
            if let Ok(value) = session.protocol_version.parse() {
                headers.insert(PROTOCOL_HEADER, value);
            }
        }
        headers
    }

    /// Sends one JSON-RPC message. Returns the response headers and the matching
    /// response message, or `None` for notifications.
    async fn post(
        &self,
        session: Option<&Session>,
        body: &Value,
    ) -> Result<(HeaderMap, Option<Value>), McpError> {
        let response = self
            .http
            .post(&self.endpoint)
            .headers(self.headers(session))
            .json(body)
            .send()
            .await
            .map_err(|e| anyhow!("Could not reach T3 Code: {e}"))?;
        let status = response.status();
        if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
            return Err(McpError::Unauthorized);
        }
        if status == reqwest::StatusCode::NOT_FOUND && session.is_some() {
            return Err(anyhow!("session-expired").into());
        }
        let headers = response.headers().clone();
        if status == reqwest::StatusCode::ACCEPTED || body.get("id").is_none() {
            return Ok((headers, None));
        }
        if !status.is_success() {
            let text = response.text().await.unwrap_or_default();
            return Err(anyhow!("T3 Code returned {status}: {}", truncate(&text, 300)).into());
        }
        let is_sse = headers
            .get(CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v.starts_with("text/event-stream"));
        let text = response.text().await.map_err(|e| anyhow!(e))?;
        let id = body.get("id").cloned().unwrap_or(Value::Null);
        let message = if is_sse {
            parse_sse_response(&text, &id)?
        } else {
            serde_json::from_str(&text).map_err(|e| anyhow!("Bad JSON from T3 Code: {e}"))?
        };
        Ok((headers, Some(message)))
    }

    async fn initialize(&self) -> Result<Session, McpError> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let request = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": "initialize",
            "params": {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": { "name": "t3-overlay", "version": env!("CARGO_PKG_VERSION") }
            }
        });
        let (headers, message) = self.post(None, &request).await?;
        let message = message.ok_or_else(|| anyhow!("Empty initialize response"))?;
        if let Some(error) = message.get("error") {
            return Err(anyhow!("MCP initialize failed: {error}").into());
        }
        let session = Session {
            id: headers
                .get(SESSION_HEADER)
                .and_then(|v| v.to_str().ok())
                .map(str::to_string),
            protocol_version: message
                .pointer("/result/protocolVersion")
                .and_then(Value::as_str)
                .unwrap_or(PROTOCOL_VERSION)
                .to_string(),
        };
        let notification = json!({ "jsonrpc": "2.0", "method": "notifications/initialized" });
        self.post(Some(&session), &notification).await?;
        Ok(session)
    }

    /// Calls a tool and returns its structured result.
    pub async fn call_tool(&self, name: &str, arguments: Value) -> Result<Value, McpError> {
        for attempt in 0..2 {
            let mut guard = self.session.lock().await;
            if guard.is_none() {
                *guard = Some(self.initialize().await?);
            }
            let id = self.next_id.fetch_add(1, Ordering::Relaxed);
            let request = json!({
                "jsonrpc": "2.0",
                "id": id,
                "method": "tools/call",
                "params": { "name": name, "arguments": arguments }
            });
            match self.post(guard.as_ref(), &request).await {
                Ok((_, Some(message))) => return tool_result(message),
                Ok((_, None)) => return Err(anyhow!("No response to {name}").into()),
                Err(McpError::Other(e)) if attempt == 0 && e.to_string() == "session-expired" => {
                    *guard = None;
                    continue;
                }
                Err(e) => return Err(e),
            }
        }
        Err(anyhow!("T3 Code session could not be re-established").into())
    }
}

fn tool_result(message: Value) -> Result<Value, McpError> {
    if let Some(error) = message.get("error") {
        let text = error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("MCP error")
            .to_string();
        return Err(McpError::Tool(text));
    }
    let result = message
        .get("result")
        .ok_or_else(|| anyhow!("MCP response had no result"))?;
    let text = result
        .get("content")
        .and_then(Value::as_array)
        .and_then(|items| items.iter().find_map(|item| item.get("text")?.as_str()))
        .unwrap_or("");
    if result.get("isError").and_then(Value::as_bool) == Some(true) {
        // Tool failures are JSON like {"_tag":"OrchestratorMcpFailure","message":"..."}.
        let message = serde_json::from_str::<Value>(text)
            .ok()
            .and_then(|v| v.get("message")?.as_str().map(str::to_string))
            .unwrap_or_else(|| truncate(text, 300));
        return Err(McpError::Tool(message));
    }
    if let Some(structured) = result.get("structuredContent") {
        if !structured.is_null() {
            return Ok(structured.clone());
        }
    }
    serde_json::from_str(text).map_err(|_| McpError::Tool(truncate(text, 300)))
}

/// Finds the JSON-RPC response with `id` in an SSE body.
fn parse_sse_response(body: &str, id: &Value) -> Result<Value> {
    let mut data = String::new();
    let mut events = Vec::new();
    for line in body.lines() {
        if let Some(rest) = line.strip_prefix("data:") {
            if !data.is_empty() {
                data.push('\n');
            }
            data.push_str(rest.strip_prefix(' ').unwrap_or(rest));
        } else if line.is_empty() && !data.is_empty() {
            events.push(std::mem::take(&mut data));
        }
    }
    if !data.is_empty() {
        events.push(data);
    }
    for event in events {
        if let Ok(message) = serde_json::from_str::<Value>(&event) {
            if message.get("id") == Some(id) {
                return Ok(message);
            }
        }
    }
    bail!("T3 Code's event stream ended without a response")
}

fn truncate(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        text.to_string()
    } else {
        text.chars().take(max).collect::<String>() + "…"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_sse_with_notifications_first() {
        let body = "event: message\ndata: {\"jsonrpc\":\"2.0\",\"method\":\"notifications/progress\"}\n\n\
                    event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":7,\"result\":{\"ok\":true}}\n\n";
        let message = parse_sse_response(body, &json!(7)).unwrap();
        assert_eq!(message.pointer("/result/ok"), Some(&json!(true)));
    }

    #[test]
    fn prefers_structured_content() {
        let message = json!({"jsonrpc":"2.0","id":1,"result":{
            "content":[{"type":"text","text":"{\"a\":1}"}],
            "structuredContent":{"a":2}
        }});
        assert_eq!(tool_result(message).unwrap(), json!({"a":2}));
    }

    #[test]
    fn falls_back_to_text_content() {
        let message = json!({"jsonrpc":"2.0","id":1,"result":{
            "content":[{"type":"text","text":"{\"a\":1}"}]
        }});
        assert_eq!(tool_result(message).unwrap(), json!({"a":1}));
    }

    #[test]
    fn surfaces_tool_failures() {
        let message = json!({"jsonrpc":"2.0","id":1,"result":{
            "isError": true,
            "content":[{"type":"text","text":"{\"_tag\":\"OrchestratorMcpFailure\",\"code\":\"thread_not_found\",\"message\":\"Gone.\"}"}]
        }});
        match tool_result(message) {
            Err(McpError::Tool(m)) => assert_eq!(m, "Gone."),
            other => panic!("unexpected {other:?}"),
        }
    }
}
