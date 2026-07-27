use aws_sdk_s3::Client;
use tauri::{AppHandle, State};

use crate::{
    app::AppState,
    error::{AppError, AppResult},
    models::s3::{
        CreateS3ProfileRequest, S3Bookmark, S3CleanupPreview, S3Credentials, S3Profile,
        UpdateS3ProfileRequest,
    },
    s3::{S3Bucket, S3ObjectListing},
};

async fn client_for(state: &AppState, profile_id: &str) -> AppResult<Client> {
    let profile = state.profiles.get_s3_profile(profile_id)?.ok_or_else(|| {
        AppError::new(
            "s3_profile_not_found",
            format!("S3 profile '{profile_id}' does not exist."),
        )
    })?;
    let credentials = state.profiles.s3_credentials(profile_id)?;
    state.s3.client(&profile, &credentials).await
}

#[tauri::command]
pub fn list_s3_profiles(state: State<'_, AppState>) -> AppResult<Vec<S3Profile>> {
    state.profiles.list_s3_profiles()
}

#[tauri::command]
pub fn create_s3_profile(
    state: State<'_, AppState>,
    request: CreateS3ProfileRequest,
) -> AppResult<S3Profile> {
    state.profiles.create_s3_profile(request)
}

#[tauri::command]
pub fn update_s3_profile(
    state: State<'_, AppState>,
    request: UpdateS3ProfileRequest,
) -> AppResult<S3Profile> {
    let id = request.id.clone();
    let profile = state.profiles.update_s3_profile(request)?;
    state.s3.drop_client(&id);
    Ok(profile)
}

#[tauri::command]
pub fn delete_s3_profile(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.profiles.delete_s3_profile(&id)?;
    state.s3.drop_client(&id);
    Ok(())
}

#[tauri::command]
pub fn set_s3_profile_favorite(
    state: State<'_, AppState>,
    id: String,
    favorite: bool,
) -> AppResult<S3Profile> {
    state.profiles.set_s3_profile_favorite(&id, favorite)
}

#[tauri::command]
pub fn list_s3_bookmarks(
    state: State<'_, AppState>,
    profile_id: String,
) -> AppResult<Vec<S3Bookmark>> {
    state.profiles.list_s3_bookmarks(&profile_id)
}

#[tauri::command]
pub fn create_s3_bookmark(
    state: State<'_, AppState>,
    profile_id: String,
    name: String,
    bucket: String,
    prefix: String,
) -> AppResult<S3Bookmark> {
    state
        .profiles
        .create_s3_bookmark(&profile_id, name, bucket, prefix)
}

#[tauri::command]
pub fn delete_s3_bookmark(
    state: State<'_, AppState>,
    profile_id: String,
    id: String,
) -> AppResult<()> {
    state.profiles.delete_s3_bookmark(&profile_id, &id)
}

#[tauri::command]
pub async fn test_s3_profile(state: State<'_, AppState>, profile_id: String) -> AppResult<()> {
    let client = client_for(&state, &profile_id).await?;
    state.s3.test_connection(&client).await
}

/// Test credentials from the profile editor without persisting them.
#[tauri::command]
pub async fn test_s3_connection(
    state: State<'_, AppState>,
    request: CreateS3ProfileRequest,
) -> AppResult<()> {
    let profile = S3Profile {
        id: "s3-test".to_string(),
        name: request.name,
        host: request.host.clone(),
        port: request.port,
        use_tls: request.use_tls,
        endpoint: Some(format!(
            "{}://{}:{}",
            if request.use_tls { "https" } else { "http" },
            request.host,
            request.port
        )),
        region: crate::models::s3::default_region(),
        access_key_id: request.access_key_id.clone(),
        force_path_style: request.force_path_style,
        default_bucket: request.default_bucket,
        default_acl: request.default_acl,
        favorite: false,
        description: None,
        tags: Vec::new(),
        has_secret_access_key: true,
        has_session_token: request.session_token.is_some(),
        created_at: String::new(),
        updated_at: String::new(),
    };
    let credentials = S3Credentials {
        access_key_id: request.access_key_id,
        secret_access_key: request.secret_access_key,
        session_token: request.session_token,
    };
    let client = state.s3.uncached_client(&profile, &credentials).await?;
    state.s3.test_connection(&client).await
}

#[tauri::command]
pub async fn s3_list_buckets(
    state: State<'_, AppState>,
    profile_id: String,
) -> AppResult<Vec<S3Bucket>> {
    let client = client_for(&state, &profile_id).await?;
    state.s3.list_buckets(&client).await
}

#[tauri::command]
pub async fn s3_list_objects(
    state: State<'_, AppState>,
    profile_id: String,
    bucket: String,
    prefix: String,
    continuation_token: Option<String>,
    max_keys: Option<i32>,
) -> AppResult<S3ObjectListing> {
    let client = client_for(&state, &profile_id).await?;
    state
        .s3
        .list_objects(&client, &bucket, &prefix, continuation_token, max_keys)
        .await
}

#[tauri::command]
pub async fn s3_create_folder(
    state: State<'_, AppState>,
    profile_id: String,
    bucket: String,
    key: String,
) -> AppResult<()> {
    let client = client_for(&state, &profile_id).await?;
    state.s3.create_folder(&client, &bucket, &key).await
}

#[tauri::command]
pub async fn s3_upload(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String,
    bucket: String,
    key: String,
    local_path: String,
    acl: Option<String>,
) -> AppResult<()> {
    let client = client_for(&state, &profile_id).await?;
    state
        .s3
        .upload(&app, &profile_id, &client, &bucket, &key, &local_path, acl)
        .await
}

#[tauri::command]
pub async fn s3_download(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String,
    bucket: String,
    key: String,
    local_path: String,
) -> AppResult<()> {
    let client = client_for(&state, &profile_id).await?;
    state
        .s3
        .download(&app, &profile_id, &client, &bucket, &key, &local_path)
        .await
}

#[tauri::command]
pub async fn s3_download_prefix(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String,
    bucket: String,
    prefix: String,
    local_directory: String,
    concurrency: u8,
) -> AppResult<u64> {
    let client = client_for(&state, &profile_id).await?;
    state
        .s3
        .download_prefix(
            &app,
            &profile_id,
            &client,
            &bucket,
            &prefix,
            &local_directory,
            concurrency,
        )
        .await
}

#[tauri::command]
pub async fn s3_delete(
    state: State<'_, AppState>,
    profile_id: String,
    bucket: String,
    key: String,
    recursive: bool,
) -> AppResult<u64> {
    let client = client_for(&state, &profile_id).await?;
    state.s3.delete(&client, &bucket, &key, recursive).await
}

#[tauri::command]
pub async fn s3_cleanup_preview(
    state: State<'_, AppState>,
    profile_id: String,
    bucket: String,
    prefix: String,
    cutoff_timestamp: i64,
) -> AppResult<S3CleanupPreview> {
    let client = client_for(&state, &profile_id).await?;
    state
        .s3
        .cleanup_preview(&client, &bucket, &prefix, cutoff_timestamp)
        .await
}

#[tauri::command]
pub async fn s3_cleanup_delete(
    state: State<'_, AppState>,
    profile_id: String,
    bucket: String,
    prefix: String,
    keys: Vec<String>,
) -> AppResult<u64> {
    let client = client_for(&state, &profile_id).await?;
    state
        .s3
        .delete_exact_keys(&client, &bucket, &prefix, keys)
        .await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn s3_copy(
    state: State<'_, AppState>,
    profile_id: String,
    source_bucket: String,
    source_key: String,
    destination_bucket: String,
    destination_key: String,
    recursive: bool,
) -> AppResult<u64> {
    let client = client_for(&state, &profile_id).await?;
    state
        .s3
        .copy_or_move(
            &client,
            &source_bucket,
            &source_key,
            &destination_bucket,
            &destination_key,
            recursive,
            false,
        )
        .await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn s3_move(
    state: State<'_, AppState>,
    profile_id: String,
    source_bucket: String,
    source_key: String,
    destination_bucket: String,
    destination_key: String,
    recursive: bool,
) -> AppResult<u64> {
    let client = client_for(&state, &profile_id).await?;
    state
        .s3
        .copy_or_move(
            &client,
            &source_bucket,
            &source_key,
            &destination_bucket,
            &destination_key,
            recursive,
            true,
        )
        .await
}

#[tauri::command]
pub async fn s3_set_canned_acl(
    state: State<'_, AppState>,
    profile_id: String,
    bucket: String,
    key: String,
    acl: String,
) -> AppResult<()> {
    let client = client_for(&state, &profile_id).await?;
    state.s3.set_acl(&client, &bucket, &key, &acl).await
}

#[tauri::command]
pub async fn s3_get_canned_acl(
    state: State<'_, AppState>,
    profile_id: String,
    bucket: String,
    key: String,
) -> AppResult<String> {
    let client = client_for(&state, &profile_id).await?;
    state.s3.canned_acl(&client, &bucket, &key).await
}
