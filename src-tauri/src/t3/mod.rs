//! Connection to a T3 Code server through its MCP endpoint.

pub mod mcp;
pub mod oauth;

use serde_json::Value;

/// The only T3 tools the overlay may call. Everything it shows or sends goes through these.
pub const ALLOWED_TOOLS: &[&str] = &[
    "t3_project_list",
    "t3_thread_list",
    "t3_thread_read",
    "t3_thread_send",
];

pub fn check_allowed(tool: &str) -> Result<(), String> {
    if ALLOWED_TOOLS.contains(&tool) {
        Ok(())
    } else {
        Err(format!("The overlay is not allowed to call {tool}"))
    }
}

pub fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(concat!("t3-overlay/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(std::time::Duration::from_secs(5))
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .expect("http client")
}

pub fn error_payload(error: &mcp::McpError) -> Value {
    let kind = match error {
        mcp::McpError::Unauthorized => "unauthorized",
        mcp::McpError::Tool(_) => "tool",
        mcp::McpError::Other(_) => "network",
    };
    serde_json::json!({ "kind": kind, "message": error.to_string() })
}
