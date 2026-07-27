use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct S3Profile {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub use_tls: bool,
    #[serde(skip_serializing)]
    pub endpoint: Option<String>,
    #[serde(skip_serializing)]
    pub region: String,
    pub access_key_id: String,
    pub force_path_style: bool,
    pub default_bucket: Option<String>,
    pub default_acl: Option<String>,
    pub favorite: bool,
    pub description: Option<String>,
    pub tags: Vec<String>,
    pub has_secret_access_key: bool,
    pub has_session_token: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct S3Bookmark {
    pub id: String,
    pub profile_id: String,
    pub name: String,
    pub bucket: String,
    pub prefix: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct S3CleanupObject {
    pub key: String,
    pub size: i64,
    pub last_modified: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct S3CleanupPreview {
    pub objects: Vec<S3CleanupObject>,
    pub total_size: i64,
    pub exceeded_limit: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateS3ProfileRequest {
    pub name: String,
    #[serde(default = "default_s3_host")]
    pub host: String,
    #[serde(default = "default_s3_port")]
    pub port: u16,
    #[serde(default = "default_use_tls")]
    pub use_tls: bool,
    pub access_key_id: String,
    pub secret_access_key: String,
    #[serde(default)]
    pub session_token: Option<String>,
    #[serde(default)]
    pub force_path_style: bool,
    #[serde(default)]
    pub default_bucket: Option<String>,
    #[serde(default)]
    pub default_acl: Option<String>,
    #[serde(default)]
    pub favorite: bool,
    pub description: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateS3ProfileRequest {
    pub id: String,
    pub name: String,
    #[serde(default = "default_s3_host")]
    pub host: String,
    #[serde(default = "default_s3_port")]
    pub port: u16,
    #[serde(default = "default_use_tls")]
    pub use_tls: bool,
    pub access_key_id: String,
    /// Omit or send an empty value to preserve the currently stored secret.
    #[serde(default)]
    pub secret_access_key: Option<String>,
    /// Omit to preserve the token; send an empty value to remove it.
    #[serde(default)]
    pub session_token: Option<String>,
    #[serde(default)]
    pub force_path_style: bool,
    #[serde(default)]
    pub default_bucket: Option<String>,
    #[serde(default)]
    pub default_acl: Option<String>,
    #[serde(default)]
    pub favorite: bool,
    pub description: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct S3Credentials {
    pub access_key_id: String,
    pub secret_access_key: String,
    pub session_token: Option<String>,
}

pub fn default_region() -> String {
    "us-east-1".to_string()
}

fn default_s3_host() -> String {
    "s3.amazonaws.com".to_string()
}

fn default_s3_port() -> u16 {
    443
}

fn default_use_tls() -> bool {
    true
}
