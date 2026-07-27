use base64::Engine as _;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{
    app::AppState,
    crypto,
    error::{AppError, AppResult},
    models::s3::{CreateS3ProfileRequest, S3Profile},
    models::ssh_profile::{AuthMethod, CreateSshProfileRequest, SshProfile},
    storage::ProfileRepository,
};

/// Placeholder shown in the read-only YAML preview instead of real secrets so
/// the on-screen view (and clipboard copy of it) never leaks credentials.
const SECRET_MASK: &str = "******";

/// Serializable document that represents every stored SSH profile. Secrets
/// (passwords and key material) are included so an export can fully restore the
/// working configuration on another machine.
#[derive(Debug, Serialize, Deserialize)]
struct ProfilesDocument {
    #[serde(default = "default_version")]
    version: u32,
    #[serde(default)]
    profiles: Vec<ProfileEntry>,
    #[serde(default, rename = "s3Profiles", alias = "s3_profiles")]
    s3_profiles: Vec<S3ProfileEntry>,
}

fn default_version() -> u32 {
    2
}

fn default_port() -> u16 {
    22
}

#[derive(Debug, Serialize, Deserialize)]
struct ProfileEntry {
    name: String,
    host: String,
    #[serde(default = "default_port")]
    port: u16,
    username: String,
    auth: AuthEntry,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    #[serde(default)]
    favorite: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    tags: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum AuthEntry {
    Password {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        password: Option<String>,
    },
    PrivateKey {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        key_data: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        key_name: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        passphrase: Option<String>,
    },
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct S3ProfileEntry {
    name: String,
    #[serde(default = "default_s3_host")]
    host: String,
    #[serde(default = "default_s3_port")]
    port: u16,
    #[serde(default = "default_use_tls")]
    use_tls: bool,
    /// Compatibility with earlier S3 exports. New documents use host/port/useTls.
    #[serde(default, skip_serializing)]
    endpoint: Option<String>,
    #[serde(default, skip_serializing, rename = "region")]
    _region: String,
    access_key_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    secret_access_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    session_token: Option<String>,
    #[serde(default)]
    force_path_style: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    default_bucket: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    default_acl: Option<String>,
    #[serde(default)]
    favorite: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    tags: Vec<String>,
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

/// Replace a present secret with the mask placeholder; keep absent ones absent.
fn mask_secret(value: &Option<String>) -> Option<String> {
    value.as_ref().map(|_| SECRET_MASK.to_string())
}

fn entry_from_profile(profile: &SshProfile, mask: bool) -> ProfileEntry {
    let auth = match &profile.auth_method {
        AuthMethod::Password { secret_ref } => AuthEntry::Password {
            password: if mask {
                mask_secret(secret_ref)
            } else {
                secret_ref.clone()
            },
        },
        AuthMethod::PrivateKey {
            key_data,
            key_name,
            passphrase_ref,
        } => AuthEntry::PrivateKey {
            key_data: if mask {
                mask_secret(key_data)
            } else {
                key_data.clone()
            },
            key_name: key_name.clone(),
            passphrase: if mask {
                mask_secret(passphrase_ref)
            } else {
                passphrase_ref.clone()
            },
        },
    };

    ProfileEntry {
        name: profile.name.clone(),
        host: profile.host.clone(),
        port: profile.port,
        username: profile.username.clone(),
        auth,
        description: profile.description.clone(),
        favorite: profile.favorite,
        tags: profile.tags.clone(),
    }
}

fn s3_entry_from_profile(
    repository: &ProfileRepository,
    profile: &S3Profile,
    mask: bool,
) -> AppResult<S3ProfileEntry> {
    let credentials = repository.s3_credentials(&profile.id)?;
    Ok(S3ProfileEntry {
        name: profile.name.clone(),
        host: profile.host.clone(),
        port: profile.port,
        use_tls: profile.use_tls,
        endpoint: None,
        _region: String::new(),
        access_key_id: profile.access_key_id.clone(),
        secret_access_key: Some(if mask {
            SECRET_MASK.to_string()
        } else {
            credentials.secret_access_key
        }),
        session_token: credentials
            .session_token
            .map(|token| if mask { SECRET_MASK.to_string() } else { token }),
        force_path_style: profile.force_path_style,
        default_bucket: profile.default_bucket.clone(),
        default_acl: profile.default_acl.clone(),
        favorite: profile.favorite,
        description: profile.description.clone(),
        tags: profile.tags.clone(),
    })
}

fn build_document_yaml(repository: &ProfileRepository, mask: bool) -> AppResult<String> {
    let profiles = repository.list_profiles()?;
    let s3_profiles = repository
        .list_s3_profiles()?
        .iter()
        .map(|profile| s3_entry_from_profile(repository, profile, mask))
        .collect::<AppResult<Vec<_>>>()?;
    let document = ProfilesDocument {
        version: default_version(),
        profiles: profiles
            .iter()
            .map(|p| entry_from_profile(p, mask))
            .collect(),
        s3_profiles,
    };
    serde_yaml::to_string(&document)
        .map_err(|error| AppError::new("export_error", error.to_string()))
}

fn request_from_entry(entry: ProfileEntry) -> CreateSshProfileRequest {
    let auth_method = match entry.auth {
        AuthEntry::Password { password } => AuthMethod::Password {
            secret_ref: password,
        },
        AuthEntry::PrivateKey {
            key_data,
            key_name,
            passphrase,
        } => AuthMethod::PrivateKey {
            key_data,
            key_name,
            passphrase_ref: passphrase,
        },
    };

    CreateSshProfileRequest {
        name: entry.name,
        host: entry.host,
        port: entry.port,
        username: entry.username,
        auth_method,
        proxy: None,
        description: entry.description,
        favorite: entry.favorite,
        tags: entry.tags,
    }
}

/// Serialize every stored profile to a YAML document for on-screen preview.
/// Secrets are masked so the view and any clipboard copy stay safe; use
/// [`export_profiles_encrypted`] to produce a restorable artifact.
#[tauri::command]
pub fn export_profiles_yaml(state: State<'_, AppState>) -> AppResult<String> {
    build_document_yaml(&state.profiles, true)
}

/// Encrypt every stored profile (secrets included) into a single portable,
/// password-protected string.
#[tauri::command]
pub fn export_profiles_encrypted(
    state: State<'_, AppState>,
    password: String,
) -> AppResult<String> {
    if password.trim().is_empty() {
        return Err(AppError::new("validation_error", "请输入导出密码。"));
    }
    let yaml = build_document_yaml(&state.profiles, false)?;
    crypto::encrypt(&yaml, &password)
}

/// Parse a YAML document and create the described profiles, returning the newly
/// created records. Kept for importing plaintext files (e.g. legacy exports).
#[tauri::command]
pub fn import_profiles_yaml(
    state: State<'_, AppState>,
    yaml: String,
) -> AppResult<Vec<SshProfile>> {
    import_document(&state, &yaml)
}

/// Decrypt a password-protected export and create the described profiles.
#[tauri::command]
pub fn import_profiles_encrypted(
    state: State<'_, AppState>,
    blob: String,
    password: String,
) -> AppResult<Vec<SshProfile>> {
    let yaml = crypto::decrypt(&blob, &password)?;
    import_document(&state, &yaml)
}

fn import_document(state: &State<'_, AppState>, yaml: &str) -> AppResult<Vec<SshProfile>> {
    let document: ProfilesDocument = serde_yaml::from_str(yaml)
        .map_err(|error| AppError::new("import_error", error.to_string()))?;

    for entry in &document.s3_profiles {
        if entry
            .secret_access_key
            .as_deref()
            .is_none_or(|secret| secret.is_empty() || secret == SECRET_MASK)
            || entry.session_token.as_deref() == Some(SECRET_MASK)
        {
            return Err(AppError::new(
                "import_error",
                format!(
                    "S3 profile '{}' has missing or masked credentials.",
                    entry.name
                ),
            ));
        }
    }

    let mut created = Vec::with_capacity(document.profiles.len());
    for entry in document.profiles {
        created.push(state.profiles.create_profile(request_from_entry(entry))?);
    }
    for entry in document.s3_profiles {
        let secret_access_key = entry.secret_access_key.expect("validated above");
        state.profiles.create_s3_profile(CreateS3ProfileRequest {
            name: entry.name,
            host: if entry.endpoint.is_some() {
                legacy_host(entry.endpoint.as_deref())
            } else {
                entry.host
            },
            port: if entry.endpoint.is_some() {
                legacy_port(entry.endpoint.as_deref())
            } else {
                entry.port
            },
            use_tls: if entry.endpoint.is_some() {
                !entry
                    .endpoint
                    .as_deref()
                    .is_some_and(|value| value.starts_with("http://"))
            } else {
                entry.use_tls
            },
            access_key_id: entry.access_key_id,
            secret_access_key,
            session_token: entry.session_token,
            force_path_style: entry.force_path_style,
            default_bucket: entry.default_bucket,
            default_acl: entry.default_acl,
            favorite: entry.favorite,
            description: entry.description,
            tags: entry.tags,
        })?;
    }
    Ok(created)
}

fn legacy_host(endpoint: Option<&str>) -> String {
    endpoint
        .unwrap_or("https://s3.amazonaws.com:443")
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .split('/')
        .next()
        .unwrap_or("s3.amazonaws.com")
        .split(':')
        .next()
        .unwrap_or("s3.amazonaws.com")
        .to_string()
}

fn legacy_port(endpoint: Option<&str>) -> u16 {
    endpoint
        .and_then(|value| {
            value
                .trim_start_matches("https://")
                .trim_start_matches("http://")
                .split('/')
                .next()
                .and_then(|authority| authority.rsplit_once(':'))
                .and_then(|(_, port)| port.parse::<u16>().ok())
        })
        .unwrap_or_else(|| {
            if endpoint.is_some_and(|value| value.starts_with("http://")) {
                80
            } else {
                443
            }
        })
}

/// Read the contents of a user-selected text file (used for importing).
#[tauri::command]
pub fn read_text_file(path: String) -> AppResult<String> {
    std::fs::read_to_string(&path)
        .map_err(|error| AppError::new("file_read_error", error.to_string()))
}

/// Write text to a user-selected path (used for exporting).
#[tauri::command]
pub fn write_text_file(path: String, contents: String) -> AppResult<()> {
    std::fs::write(&path, contents)
        .map_err(|error| AppError::new("file_write_error", error.to_string()))
}

/// Read a local image and return it as a `data:` URL, used by the optional
/// terminal background image. Going through a command (instead of the asset
/// protocol) keeps this working regardless of asset-scope configuration.
#[tauri::command]
pub fn read_image_data_url(path: String) -> AppResult<String> {
    /// Wallpapers are decoded into memory and inlined into CSS, so cap the size.
    const MAX_BYTES: u64 = 12 * 1024 * 1024;

    let metadata = std::fs::metadata(&path)
        .map_err(|error| AppError::new("file_read_error", error.to_string()))?;
    if metadata.len() > MAX_BYTES {
        return Err(AppError::new(
            "image_too_large",
            "背景图片过大（上限 12 MB）。",
        ));
    }

    let mime = match std::path::Path::new(&path)
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("bmp") => "image/bmp",
        _ => {
            return Err(AppError::new(
                "unsupported_image",
                "仅支持 PNG / JPEG / GIF / WebP / BMP 图片。",
            ));
        }
    };

    let bytes = std::fs::read(&path)
        .map_err(|error| AppError::new("file_read_error", error.to_string()))?;
    Ok(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_ssh_only_documents_remain_compatible() {
        let document: ProfilesDocument = serde_yaml::from_str(
            r#"
version: 1
profiles:
  - name: server
    host: example.com
    username: root
    auth:
      type: password
      password: secret
"#,
        )
        .unwrap();
        assert_eq!(document.profiles.len(), 1);
        assert!(document.s3_profiles.is_empty());
    }

    #[test]
    fn s3_profile_field_accepts_snake_case_alias() {
        let document: ProfilesDocument = serde_yaml::from_str(
            r#"
version: 2
profiles: []
s3_profiles:
  - name: storage
    region: us-east-1
    accessKeyId: access
    secretAccessKey: secret
"#,
        )
        .unwrap();
        assert_eq!(document.s3_profiles.len(), 1);
    }
}
