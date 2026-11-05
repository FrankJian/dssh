use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::error::{AppError, AppResult};

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ClipboardMode {
    #[default]
    Off,
    Text,
    TextAndFiles,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RdpProfile {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub folder: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub domain: String,
    /// SHA-256 pin explicitly verified by the user; empty means CA validation.
    pub certificate_fingerprint: String,
    /// Explicit per-profile opt-out. Legacy profiles keep strict verification.
    #[serde(default)]
    pub skip_certificate_verification: bool,
    #[serde(default)]
    pub clipboard_mode: ClipboardMode,
    /// Resize the remote desktop through the RDP display-control channel.
    #[serde(default)]
    pub dynamic_resolution: bool,
    pub width: u16,
    pub height: u16,
    pub favorite: bool,
    pub tags: Vec<String>,
    pub description: String,
    pub has_password: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "camelCase", deny_unknown_fields)]
pub enum PasswordUpdate {
    Keep {},
    Clear {},
    Replace { value: Zeroizing<String> },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveRdpProfileRequest {
    pub profile: RdpProfile,
    pub password: PasswordUpdate,
    pub clone_source_id: Option<String>,
}

impl RdpProfile {
    pub fn normalize_and_validate(&mut self) -> AppResult<()> {
        self.folder = super::connection_folder::normalize_folder(&self.folder)?;
        self.name = self.name.trim().to_owned();
        self.host = self.host.trim().to_owned();
        self.username = self.username.trim().to_owned();
        self.domain = self.domain.trim().to_owned();
        for text in [
            &self.name,
            &self.host,
            &self.username,
            &self.domain,
            &self.description,
        ] {
            if text.len() > 4096 || text.chars().any(char::is_control) {
                return Err(invalid("配置包含控制字符或内容过长。"));
            }
        }
        if self.name.is_empty() || self.username.is_empty() || self.host.is_empty() {
            return Err(invalid("名称、主机和用户名不能为空。"));
        }
        if self
            .host
            .chars()
            .any(|c| c.is_whitespace() || "/\\@?#".contains(c))
            || self.host.starts_with('-')
            || self.host.starts_with('[')
            || self.host.ends_with(']')
        {
            return Err(invalid("请单独填写主机名或 IP，不含协议、方括号或端口。"));
        }
        if self.host.contains(':') && self.host.parse::<std::net::Ipv6Addr>().is_err() {
            return Err(invalid("主机地址无效；端口请在端口字段中填写。"));
        }
        if self.port == 0
            || !(640..=7680).contains(&self.width)
            || !(480..=4320).contains(&self.height)
        {
            return Err(invalid("端口或桌面尺寸超出允许范围。"));
        }
        let pin = self
            .certificate_fingerprint
            .replace(':', "")
            .to_ascii_lowercase();
        if !pin.is_empty() && (pin.len() != 64 || !pin.bytes().all(|b| b.is_ascii_hexdigit())) {
            return Err(invalid("证书指纹必须是完整的 SHA-256（64 位十六进制）。"));
        }
        self.certificate_fingerprint = pin;
        if self.tags.len() > 64
            || self
                .tags
                .iter()
                .any(|t| t.len() > 128 || t.chars().any(char::is_control))
        {
            return Err(invalid("标签过长或包含控制字符。"));
        }
        self.tags = self
            .tags
            .iter()
            .map(|s| s.trim().to_owned())
            .filter(|s| !s.is_empty())
            .collect();
        self.tags.sort();
        self.tags.dedup();
        Ok(())
    }
}

fn invalid(message: &str) -> AppError {
    AppError::new("rdp_invalid_profile", message)
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RdpSession {
    pub id: String,
    pub profile_id: String,
    pub title: String,
    pub status: String,
    pub message: Option<String>,
    pub revision: u64,
    pub certificate_verification_skipped: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RdpEngineStatus {
    pub available: bool,
    pub message: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    fn profile() -> RdpProfile {
        RdpProfile {
            folder: String::new(),
            id: String::new(),
            name: "PC".into(),
            host: "pc.example".into(),
            port: 3389,
            username: "user".into(),
            domain: String::new(),
            certificate_fingerprint: String::new(),
            skip_certificate_verification: false,
            clipboard_mode: ClipboardMode::Off,
            dynamic_resolution: false,
            width: 1920,
            height: 1080,
            favorite: false,
            tags: vec![],
            description: String::new(),
            has_password: false,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }
    #[test]
    fn rejects_addresses_that_override_rdp_options() {
        for host in [
            "/cert:ignore",
            "server:3389",
            "rdp://server",
            "server\n/p:bad",
            "[::1]",
        ] {
            let mut p = profile();
            p.host = host.into();
            assert!(p.normalize_and_validate().is_err());
        }
        let mut p = profile();
        p.host = "::1".into();
        assert!(p.normalize_and_validate().is_ok());
    }
    #[test]
    fn validates_and_normalizes_certificate_pin() {
        let mut p = profile();
        p.certificate_fingerprint = "AB:".repeat(31) + "AB";
        p.normalize_and_validate().unwrap();
        assert_eq!(p.certificate_fingerprint, "ab".repeat(32));
        p.certificate_fingerprint = "ignore".into();
        assert!(p.normalize_and_validate().is_err());
    }
    #[test]
    fn password_request_is_write_only_and_strict() {
        let request: PasswordUpdate =
            serde_json::from_str(r#"{"action":"replace","value":"test-only"}"#).unwrap();
        assert!(matches!(request, PasswordUpdate::Replace { .. }));
        assert!(
            serde_json::from_str::<PasswordUpdate>(r#"{"action":"keep","value":"unexpected"}"#)
                .is_err()
        );
    }
}
