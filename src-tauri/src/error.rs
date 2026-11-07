use serde::Serialize;

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}

impl AppError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            details: None,
        }
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(error: rusqlite::Error) -> Self {
        Self::new("storage_error", error.to_string())
    }
}

/// A failed connect alone cannot prove that privacy settings caused it.
/// Keep routing / VPN troubleshooting and the original OS error available.
pub fn local_network_permission_hint() -> &'static str {
    if cfg!(target_os = "macos") {
        " macOS 连接内网时，请同时检查“系统设置 → 隐私与安全性 → 本地网络”中的 Duo SSH（或 dssh）是否已允许；也请确认当前网络或 VPN 能到达目标。"
    } else {
        ""
    }
}

pub fn network_error_message(message: String) -> String {
    if cfg!(target_os = "macos") && message.contains("(os error 65)") {
        format!("{message}{}", local_network_permission_hint())
    } else {
        message
    }
}

impl From<std::io::Error> for AppError {
    fn from(error: std::io::Error) -> Self {
        Self::new("io_error", network_error_message(error.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn network_hint_preserves_original_error_and_is_platform_specific() {
        let original = "No route to host (os error 65)";
        let message = network_error_message(original.into());
        assert!(message.starts_with(original));
        assert_eq!(message.contains("本地网络"), cfg!(target_os = "macos"));
        assert_eq!(
            network_error_message("Connection refused (os error 61)".into()),
            "Connection refused (os error 61)"
        );
        assert_eq!(
            network_error_message("Authentication failed".into()),
            "Authentication failed"
        );
    }
}
