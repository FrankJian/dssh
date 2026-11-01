use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

#[derive(Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum JumpServerAuthKind {
    #[default]
    AccessKey,
    Password,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JumpServerProfile {
    pub id: String,
    pub name: String,
    pub core_url: String,
    #[serde(default)]
    pub key_id: String,
    #[serde(default)]
    pub auth_kind: JumpServerAuthKind,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub ssh_profile_id: Option<String>,
    pub org_id: String,
    pub has_credential: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveJumpServerProfile {
    pub id: Option<String>,
    pub name: String,
    pub core_url: String,
    #[serde(default)]
    pub key_id: String,
    #[serde(default)]
    pub auth_kind: JumpServerAuthKind,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub ssh_profile_id: Option<String>,
    pub org_id: String,
    pub secret: Option<Zeroizing<String>>,
    pub remember_secret: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JumpServerIdentity {
    pub user_id: String,
    pub username: String,
    pub org_id: String,
    pub generation: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JumpServerAsset {
    pub id: String,
    pub name: String,
    pub address: String,
    pub node_ids: Vec<String>,
    pub active: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JumpServerNode {
    pub id: String,
    pub name: String,
    pub key: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JumpServerPage<T> {
    pub results: Vec<T>,
    pub count: Option<u64>,
    pub has_more: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JumpServerAccount {
    pub alias: String,
    pub name: String,
    pub username: String,
    pub supported: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JumpServerQuery {
    pub profile_id: String,
    pub generation: String,
    #[serde(default)]
    pub search: String,
    #[serde(default)]
    pub offset: u32,
    pub node_id: Option<String>,
}

// Local, non-secret target identity. Never accepts an endpoint or token from React.
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JumpServerTarget {
    pub profile_id: String,
    pub generation: String,
    pub asset_id: String,
    pub asset_name: String,
    pub account_alias: String,
    #[serde(default)]
    pub account_label: String,
}

#[derive(Serialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum JumpServerLoginResult {
    Ready { identity: JumpServerIdentity },
    OtpRequired { challenge_id: String },
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn legacy_profiles_keep_access_key_authentication_and_secrets_are_write_only() {
        let old = serde_json::json!({"id":"old","name":"old","coreUrl":"https://example.invalid/","keyId":"test-key","orgId":"org-a","hasCredential":true});
        let profile: JumpServerProfile = serde_json::from_value(old).unwrap();
        assert!(matches!(profile.auth_kind, JumpServerAuthKind::AccessKey));
        assert!(profile.ssh_profile_id.is_none());
        let request:SaveJumpServerProfile=serde_json::from_value(serde_json::json!({"id":null,"name":"test","coreUrl":"https://example.invalid/","authKind":"password","username":"alice","orgId":"org-a","secret":"synthetic-password","rememberSecret":false})).unwrap();
        assert!(matches!(request.auth_kind, JumpServerAuthKind::Password));
        assert_eq!(request.username, "alice");
        assert!(request.key_id.is_empty());
        let outcome = JumpServerLoginResult::OtpRequired {
            challenge_id: "opaque-local-challenge".into(),
        };
        let json = serde_json::to_value(outcome).unwrap();
        assert_eq!(json["status"], "otpRequired");
        assert!(json.get("token").is_none());
        assert!(json.get("cookie").is_none());
    }
}
