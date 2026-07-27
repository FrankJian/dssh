use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AuthMethod {
    Password {
        // The password itself. Like key material below, it is never serialized
        // back to the frontend; the stored value is preserved on update when
        // the request omits it (see `merge_auth_method`).
        #[serde(skip_serializing)]
        secret_ref: Option<String>,
    },
    PrivateKey {
        // The private key material itself. It is never serialized back to the
        // frontend to avoid leaking secrets; the stored value is preserved on
        // update when the request omits it.
        #[serde(skip_serializing)]
        key_data: Option<String>,
        // Original file name of the uploaded key, shown in the UI.
        key_name: Option<String>,
        // The key passphrase; also withheld from the frontend and preserved on
        // update when omitted.
        #[serde(skip_serializing)]
        passphrase_ref: Option<String>,
    },
}

fn default_tags() -> Vec<String> {
    Vec::new()
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshProxy {
    /// `"socks5"` or `"http"`.
    pub proxy_type: String,
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    #[serde(skip_serializing)]
    pub password: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshProfile {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_method: AuthMethod,
    pub proxy: Option<SshProxy>,
    pub description: Option<String>,
    pub favorite: bool,
    #[serde(default = "default_tags")]
    pub tags: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSshProfileRequest {
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_method: AuthMethod,
    pub proxy: Option<SshProxy>,
    pub description: Option<String>,
    pub favorite: bool,
    #[serde(default = "default_tags")]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSshProfileRequest {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_method: AuthMethod,
    pub proxy: Option<SshProxy>,
    pub description: Option<String>,
    pub favorite: bool,
    #[serde(default = "default_tags")]
    pub tags: Vec<String>,
}
