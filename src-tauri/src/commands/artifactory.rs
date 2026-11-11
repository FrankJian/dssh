use std::{path::Path, sync::OnceLock};

use reqwest::{Client, Method, Url, redirect::Policy};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Webview};
use tokio::io::AsyncWriteExt;
use tokio_util::io::ReaderStream;
use zeroize::Zeroizing;

use crate::{
    app::AppState,
    browser,
    error::{AppError, AppResult},
    storage::artifactory_repository::{ArtifactoryProfile, SaveArtifactoryProfileRequest},
};

pub mod transfers;

fn trusted(app: &AppHandle, webview: &Webview) -> AppResult<()> {
    browser::trusted(webview)?;
    if app.state::<AppState>().app_lock.status()?.locked {
        return Err(AppError::new("artifactory_locked", "请先解锁 Duo SSH。"));
    }
    Ok(())
}

fn client() -> AppResult<&'static Client> {
    static CLIENT: OnceLock<Result<Client, String>> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            Client::builder()
                .redirect(Policy::none())
                .connect_timeout(std::time::Duration::from_secs(10))
                .build()
                .map_err(|error| error.to_string())
        })
        .as_ref()
        .map_err(|_| AppError::new("artifactory_client", "无法初始化 Artifactory HTTP 客户端。"))
}

fn endpoint(base: &str, segments: &[&str]) -> AppResult<Url> {
    let mut url =
        Url::parse(base).map_err(|_| AppError::new("artifactory_url", "连接 URL 无效。"))?;
    {
        let mut path = url
            .path_segments_mut()
            .map_err(|_| AppError::new("artifactory_url", "连接 URL 无效。"))?;
        path.pop_if_empty();
        path.extend(["artifactory"].into_iter().chain(segments.iter().copied()));
    }
    Ok(url)
}

fn item_segments(repo: &str, path: &str) -> AppResult<Vec<String>> {
    if repo.is_empty() || repo == "." || repo == ".." || repo.contains(['/', '\\']) {
        return Err(AppError::new("artifactory_path", "仓库名称无效。"));
    }
    let mut parts = vec![repo.to_string()];
    for segment in path.split('/') {
        if segment.is_empty() {
            continue;
        }
        if segment == "." || segment == ".." || segment.contains('\\') || segment.contains('\0') {
            return Err(AppError::new("artifactory_path", "文件路径无效。"));
        }
        parts.push(segment.to_string());
    }
    Ok(parts)
}

async fn request(
    app: &AppHandle,
    id: &str,
    method: Method,
    segments: &[&str],
) -> AppResult<reqwest::RequestBuilder> {
    let state = app.state::<AppState>();
    let profile = state.profiles.get_artifactory_profile(id)?;
    let token = Zeroizing::new(state.profiles.artifactory_token(id)?);
    let url = endpoint(&profile.base_url, segments)?;
    Ok(client()?.request(method, url).bearer_auth(token.as_str()))
}

async fn checked(response: reqwest::Response) -> AppResult<reqwest::Response> {
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }
    let message = match status.as_u16() {
        401 => "Access Token 无效或已过期。".to_string(),
        403 => "没有访问该仓库或文件的权限。".to_string(),
        404 => "仓库或文件不存在，可能已被移除。".to_string(),
        _ => format!("Artifactory 请求失败（HTTP {}）。", status.as_u16()),
    };
    Err(AppError::new("artifactory_http", message))
}

async fn json<T: serde::de::DeserializeOwned>(builder: reqwest::RequestBuilder) -> AppResult<T> {
    let response = builder
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .map_err(network_error)?;
    checked(response)
        .await?
        .json()
        .await
        .map_err(|_| AppError::new("artifactory_response", "Artifactory 返回的数据无法解析。"))
}

fn network_error(_: reqwest::Error) -> AppError {
    AppError::new(
        "artifactory_network",
        "无法访问 Artifactory，请检查 URL、网络和 TLS 证书。",
    )
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactoryRepository {
    pub key: String,
    #[serde(default)]
    pub r#type: String,
    #[serde(default)]
    pub package_type: String,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct ArtifactoryChild {
    pub uri: String,
    pub folder: bool,
}

#[derive(Serialize, Deserialize)]
pub struct ArtifactoryFolder {
    #[serde(default)]
    pub children: Vec<ArtifactoryChild>,
}

#[tauri::command]
pub fn list_artifactory_profiles(
    app: AppHandle,
    webview: Webview,
) -> AppResult<Vec<ArtifactoryProfile>> {
    trusted(&app, &webview)?;
    app.state::<AppState>().profiles.list_artifactory_profiles()
}

#[tauri::command]
pub fn save_artifactory_profile(
    app: AppHandle,
    webview: Webview,
    request: SaveArtifactoryProfileRequest,
) -> AppResult<ArtifactoryProfile> {
    trusted(&app, &webview)?;
    app.state::<AppState>()
        .profiles
        .save_artifactory_profile(request)
}

#[tauri::command]
pub fn delete_artifactory_profile(app: AppHandle, webview: Webview, id: String) -> AppResult<()> {
    trusted(&app, &webview)?;
    app.state::<AppState>()
        .profiles
        .delete_artifactory_profile(&id)
}

#[tauri::command]
pub async fn artifactory_repositories(
    app: AppHandle,
    webview: Webview,
    profile_id: String,
) -> AppResult<Vec<ArtifactoryRepository>> {
    trusted(&app, &webview)?;
    json(request(&app, &profile_id, Method::GET, &["api", "repositories"]).await?).await
}

#[tauri::command]
pub async fn artifactory_list_folder(
    app: AppHandle,
    webview: Webview,
    profile_id: String,
    repo: String,
    path: String,
) -> AppResult<ArtifactoryFolder> {
    trusted(&app, &webview)?;
    let parts = item_segments(&repo, &path)?;
    let mut segments = vec!["api", "storage"];
    segments.extend(parts.iter().map(String::as_str));
    json(request(&app, &profile_id, Method::GET, &segments).await?).await
}

#[tauri::command]
pub async fn artifactory_item_info(
    app: AppHandle,
    webview: Webview,
    profile_id: String,
    repo: String,
    path: String,
) -> AppResult<serde_json::Value> {
    trusted(&app, &webview)?;
    if path.is_empty() {
        return Err(AppError::new("artifactory_path", "请选择一个文件或目录。"));
    }
    let parts = item_segments(&repo, &path)?;
    let mut segments = vec!["api", "storage"];
    segments.extend(parts.iter().map(String::as_str));
    let mut info: serde_json::Value =
        json(request(&app, &profile_id, Method::GET, &segments).await?).await?;
    let properties = json::<serde_json::Value>(
        request(&app, &profile_id, Method::GET, &segments)
            .await?
            .query(&[("properties", "")]),
    )
    .await;
    match properties {
        Ok(properties) => {
            info["properties"] = properties.get("properties").cloned().unwrap_or(properties)
        }
        Err(error) => info["propertiesError"] = serde_json::Value::String(error.message),
    }
    Ok(info)
}

fn validate_property(key: &str, values: &[String]) -> AppResult<()> {
    if key.trim().is_empty()
        || key.len() > 255
        || key.chars().any(char::is_control)
        || values.is_empty()
        || values.iter().any(|value| {
            value.is_empty() || value.len() > 2400 || value.chars().any(char::is_control)
        })
    {
        return Err(AppError::new(
            "artifactory_property",
            "属性名称或值无效；名称最多 255 字节，单个值最多 2400 字节。",
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn artifactory_set_property(
    app: AppHandle,
    webview: Webview,
    profile_id: String,
    repo: String,
    path: String,
    key: String,
    values: Vec<String>,
) -> AppResult<()> {
    trusted(&app, &webview)?;
    if path.is_empty() {
        return Err(AppError::new("artifactory_path", "请选择文件或目录。"));
    }
    validate_property(&key, &values)?;
    let parts = item_segments(&repo, &path)?;
    let mut segments = vec!["api", "metadata"];
    segments.extend(parts.iter().map(String::as_str));
    let props = serde_json::Map::from_iter([(key, serde_json::json!(values))]);
    let response = request(&app, &profile_id, Method::PATCH, &segments)
        .await?
        .query(&[("recursiveProperties", "0")])
        .json(&serde_json::json!({ "props": props }))
        .send()
        .await
        .map_err(network_error)?;
    checked(response).await?;
    Ok(())
}

#[tauri::command]
pub async fn artifactory_delete_property(
    app: AppHandle,
    webview: Webview,
    profile_id: String,
    repo: String,
    path: String,
    key: String,
) -> AppResult<()> {
    trusted(&app, &webview)?;
    if path.is_empty()
        || key.trim().is_empty()
        || key.len() > 255
        || key.chars().any(char::is_control)
    {
        return Err(AppError::new(
            "artifactory_property",
            "属性名称或路径无效。",
        ));
    }
    let parts = item_segments(&repo, &path)?;
    let mut segments = vec!["api", "metadata"];
    segments.extend(parts.iter().map(String::as_str));
    let props = serde_json::Map::from_iter([(key, serde_json::Value::Null)]);
    let response = request(&app, &profile_id, Method::PATCH, &segments)
        .await?
        .query(&[("recursiveProperties", "0")])
        .json(&serde_json::json!({ "props": props }))
        .send()
        .await
        .map_err(network_error)?;
    checked(response).await?;
    Ok(())
}

#[tauri::command]
pub async fn artifactory_upload(
    app: AppHandle,
    webview: Webview,
    profile_id: String,
    repo: String,
    path: String,
    local_path: String,
) -> AppResult<()> {
    trusted(&app, &webview)?;
    if path.is_empty() {
        return Err(AppError::new("artifactory_path", "上传目标路径不能为空。"));
    }
    let parts = item_segments(&repo, &path)?;
    let refs: Vec<_> = parts.iter().map(String::as_str).collect();
    let file = tokio::fs::File::open(&local_path).await?;
    let length = file.metadata().await?.len();
    let response = request(&app, &profile_id, Method::PUT, &refs)
        .await?
        .header(reqwest::header::CONTENT_LENGTH, length)
        .body(reqwest::Body::wrap_stream(ReaderStream::new(file)))
        .send()
        .await
        .map_err(network_error)?;
    checked(response).await?;
    Ok(())
}

#[tauri::command]
pub async fn artifactory_download(
    app: AppHandle,
    webview: Webview,
    profile_id: String,
    repo: String,
    path: String,
    local_path: String,
    overwrite: bool,
) -> AppResult<()> {
    trusted(&app, &webview)?;
    if path.is_empty() {
        return Err(AppError::new("artifactory_path", "请选择要下载的文件。"));
    }
    let parts = item_segments(&repo, &path)?;
    let refs: Vec<_> = parts.iter().map(String::as_str).collect();
    let destination = Path::new(&local_path);
    if destination.exists() && !overwrite {
        return Err(AppError::new(
            "artifactory_exists",
            "本地文件已存在，请确认覆盖或选择其他文件名。",
        ));
    }
    let parent = destination
        .parent()
        .ok_or_else(|| AppError::new("artifactory_path", "本地保存路径无效。"))?;
    let response = request(&app, &profile_id, Method::GET, &refs)
        .await?
        .send()
        .await
        .map_err(network_error)?;
    let mut response = checked(response).await?;
    let temp = parent.join(format!(
        ".dssh-artifactory-{}-{}.part",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|time| time.as_nanos())
            .unwrap_or_default()
    ));
    let result = async {
        let mut file = tokio::fs::File::create(&temp).await?;
        while let Some(chunk) = response.chunk().await.map_err(network_error)? {
            file.write_all(&chunk).await?;
        }
        file.flush().await?;
        if destination.exists() && !overwrite {
            return Err(AppError::new(
                "artifactory_exists",
                "本地文件已存在，请确认覆盖或选择其他文件名。",
            ));
        }
        if destination.exists() {
            let backup = temp.with_extension("backup");
            tokio::fs::rename(destination, &backup).await?;
            if let Err(error) = tokio::fs::rename(&temp, destination).await {
                let _ = tokio::fs::rename(&backup, destination).await;
                return Err(error.into());
            }
            let _ = tokio::fs::remove_file(&backup).await;
        } else {
            tokio::fs::rename(&temp, destination).await?;
        }
        Ok(())
    }
    .await;
    if result.is_err() {
        let _ = tokio::fs::remove_file(&temp).await;
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn paths_are_encoded_and_traversal_is_rejected() {
        assert!(item_segments("repo", "../secret").is_err());
        assert!(item_segments("repo/other", "file").is_err());
        let url = endpoint("https://example.jfrog.io", &["artifactory", "a b"]).unwrap();
        assert!(url.as_str().contains("a%20b"));
    }

    #[test]
    fn property_values_validate_control_characters() {
        assert!(validate_property("status", &["ready".to_string()]).is_ok());
        assert!(validate_property("status", &["bad\nvalue".to_string()]).is_err());
    }
}
