use std::{
    collections::{HashMap, HashSet},
    path::Path,
    sync::{Arc, Mutex},
};

use aws_config::{BehaviorVersion, Region};
use aws_credential_types::Credentials;
use aws_sdk_s3::{
    Client,
    config::Builder as S3ConfigBuilder,
    primitives::ByteStream,
    types::{CompletedMultipartUpload, CompletedPart, Delete, ObjectCannedAcl, ObjectIdentifier},
};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::{
    fs::File,
    io::{AsyncReadExt, AsyncWriteExt},
};

use crate::{
    error::{AppError, AppResult},
    models::s3::{S3CleanupObject, S3CleanupPreview, S3Credentials, S3Profile},
};

pub const S3_TRANSFER_PROGRESS_EVENT: &str = "s3://transfer-progress";
const MULTIPART_THRESHOLD: u64 = 16 * 1024 * 1024;
const MULTIPART_PART_SIZE: usize = 8 * 1024 * 1024;
const CLEANUP_PREVIEW_LIMIT: usize = 10_000;

#[derive(Debug, Clone, Default)]
pub struct S3Manager {
    clients: Arc<Mutex<HashMap<String, Client>>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct S3Bucket {
    pub name: String,
    pub creation_date: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct S3Object {
    pub key: String,
    pub size: i64,
    pub last_modified: Option<i64>,
    pub etag: Option<String>,
    pub storage_class: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct S3ObjectListing {
    pub bucket: String,
    pub prefix: String,
    pub folders: Vec<String>,
    pub objects: Vec<S3Object>,
    pub next_continuation_token: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TransferProgress {
    profile_id: String,
    operation: String,
    bucket: String,
    key: String,
    transferred: u64,
    total: Option<u64>,
    done: bool,
}

impl S3Manager {
    pub async fn client(
        &self,
        profile: &S3Profile,
        credentials: &S3Credentials,
    ) -> AppResult<Client> {
        if let Some(client) = self
            .clients
            .lock()
            .map_err(|_| AppError::new("s3_error", "S3 client cache is unavailable."))?
            .get(&profile.id)
            .cloned()
        {
            return Ok(client);
        }
        let client = self.build_client(profile, credentials).await?;
        self.clients
            .lock()
            .map_err(|_| AppError::new("s3_error", "S3 client cache is unavailable."))?
            .insert(profile.id.clone(), client.clone());
        Ok(client)
    }

    pub async fn uncached_client(
        &self,
        profile: &S3Profile,
        credentials: &S3Credentials,
    ) -> AppResult<Client> {
        self.build_client(profile, credentials).await
    }

    async fn build_client(
        &self,
        profile: &S3Profile,
        credentials: &S3Credentials,
    ) -> AppResult<Client> {
        let provider = Credentials::new(
            credentials.access_key_id.clone(),
            credentials.secret_access_key.clone(),
            credentials.session_token.clone(),
            None,
            "dssh-s3-profile",
        );
        let shared = aws_config::defaults(BehaviorVersion::latest())
            .region(Region::new(profile.region.clone()))
            .credentials_provider(provider)
            .load()
            .await;
        let mut builder = S3ConfigBuilder::from(&shared).force_path_style(profile.force_path_style);
        if let Some(endpoint) = &profile.endpoint {
            builder = builder.endpoint_url(endpoint);
        }
        Ok(Client::from_conf(builder.build()))
    }

    pub fn drop_client(&self, profile_id: &str) {
        if let Ok(mut clients) = self.clients.lock() {
            clients.remove(profile_id);
        }
    }

    pub async fn test_connection(&self, client: &Client) -> AppResult<()> {
        client.list_buckets().send().await.map_err(s3_error)?;
        Ok(())
    }

    pub async fn list_buckets(&self, client: &Client) -> AppResult<Vec<S3Bucket>> {
        let output = client.list_buckets().send().await.map_err(s3_error)?;
        let mut buckets = output
            .buckets()
            .iter()
            .filter_map(|bucket| {
                Some(S3Bucket {
                    name: bucket.name()?.to_string(),
                    creation_date: bucket.creation_date().map(|date| date.secs()),
                })
            })
            .collect::<Vec<_>>();
        buckets.sort_by_key(|bucket| bucket.name.to_lowercase());
        Ok(buckets)
    }

    pub async fn list_objects(
        &self,
        client: &Client,
        bucket: &str,
        prefix: &str,
        continuation_token: Option<String>,
        max_keys: Option<i32>,
    ) -> AppResult<S3ObjectListing> {
        let output = client
            .list_objects_v2()
            .bucket(bucket)
            .prefix(prefix)
            .delimiter("/")
            .set_continuation_token(continuation_token)
            .set_max_keys(max_keys)
            .send()
            .await
            .map_err(s3_error)?;
        let folders = output
            .common_prefixes()
            .iter()
            .filter_map(|item| item.prefix().map(str::to_string))
            .collect();
        let objects = output
            .contents()
            .iter()
            .filter_map(|object| {
                let key = object.key()?;
                if key == prefix {
                    return None;
                }
                Some(S3Object {
                    key: key.to_string(),
                    size: object.size().unwrap_or_default(),
                    last_modified: object.last_modified().map(|date| date.secs()),
                    etag: object.e_tag().map(str::to_string),
                    storage_class: object
                        .storage_class()
                        .map(|value| value.as_str().to_string()),
                })
            })
            .collect();
        Ok(S3ObjectListing {
            bucket: bucket.to_string(),
            prefix: prefix.to_string(),
            folders,
            objects,
            next_continuation_token: output.next_continuation_token().map(str::to_string),
        })
    }

    pub async fn create_folder(&self, client: &Client, bucket: &str, key: &str) -> AppResult<()> {
        let key = folder_key(key);
        client
            .put_object()
            .bucket(bucket)
            .key(key)
            .body(ByteStream::from_static(b""))
            .send()
            .await
            .map_err(s3_error)?;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn upload(
        &self,
        app: &AppHandle,
        profile_id: &str,
        client: &Client,
        bucket: &str,
        key: &str,
        local_path: &str,
        acl: Option<String>,
    ) -> AppResult<()> {
        let total = tokio::fs::metadata(local_path)
            .await
            .map_err(|error| AppError::new("s3_upload_error", error.to_string()))?
            .len();
        emit_progress(
            app,
            profile_id,
            "upload",
            bucket,
            key,
            0,
            Some(total),
            false,
        );
        if total < MULTIPART_THRESHOLD {
            let body = ByteStream::from_path(Path::new(local_path))
                .await
                .map_err(|error| AppError::new("s3_upload_error", error.to_string()))?;
            client
                .put_object()
                .bucket(bucket)
                .key(key)
                .set_acl(parse_acl(acl.as_deref())?)
                .body(body)
                .send()
                .await
                .map_err(s3_error)?;
        } else {
            self.multipart_upload(app, profile_id, client, bucket, key, local_path, total, acl)
                .await?;
        }
        emit_progress(
            app,
            profile_id,
            "upload",
            bucket,
            key,
            total,
            Some(total),
            true,
        );
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    async fn multipart_upload(
        &self,
        app: &AppHandle,
        profile_id: &str,
        client: &Client,
        bucket: &str,
        key: &str,
        local_path: &str,
        total: u64,
        acl: Option<String>,
    ) -> AppResult<()> {
        let created = client
            .create_multipart_upload()
            .bucket(bucket)
            .key(key)
            .set_acl(parse_acl(acl.as_deref())?)
            .send()
            .await
            .map_err(s3_error)?;
        let upload_id = created
            .upload_id()
            .ok_or_else(|| AppError::new("s3_upload_error", "S3 returned no multipart upload ID."))?
            .to_string();
        let result = async {
            let mut file = File::open(local_path)
                .await
                .map_err(|error| AppError::new("s3_upload_error", error.to_string()))?;
            let mut completed = Vec::new();
            let mut transferred = 0u64;
            let mut part_number = 1;
            loop {
                let mut buffer = vec![0u8; MULTIPART_PART_SIZE];
                let read = file
                    .read(&mut buffer)
                    .await
                    .map_err(|error| AppError::new("s3_upload_error", error.to_string()))?;
                if read == 0 {
                    break;
                }
                buffer.truncate(read);
                let output = client
                    .upload_part()
                    .bucket(bucket)
                    .key(key)
                    .upload_id(&upload_id)
                    .part_number(part_number)
                    .body(ByteStream::from(buffer))
                    .send()
                    .await
                    .map_err(s3_error)?;
                completed.push(
                    CompletedPart::builder()
                        .part_number(part_number)
                        .set_e_tag(output.e_tag().map(str::to_string))
                        .build(),
                );
                transferred += read as u64;
                emit_progress(
                    app,
                    profile_id,
                    "upload",
                    bucket,
                    key,
                    transferred,
                    Some(total),
                    false,
                );
                part_number += 1;
            }
            let multipart = CompletedMultipartUpload::builder()
                .set_parts(Some(completed))
                .build();
            client
                .complete_multipart_upload()
                .bucket(bucket)
                .key(key)
                .upload_id(&upload_id)
                .multipart_upload(multipart)
                .send()
                .await
                .map_err(s3_error)?;
            Ok(())
        }
        .await;
        if result.is_err() {
            let _ = client
                .abort_multipart_upload()
                .bucket(bucket)
                .key(key)
                .upload_id(upload_id)
                .send()
                .await;
        }
        result
    }

    pub async fn download(
        &self,
        app: &AppHandle,
        profile_id: &str,
        client: &Client,
        bucket: &str,
        key: &str,
        local_path: &str,
    ) -> AppResult<()> {
        let output = client
            .get_object()
            .bucket(bucket)
            .key(key)
            .send()
            .await
            .map_err(s3_error)?;
        let total = u64::try_from(output.content_length().unwrap_or_default()).ok();
        emit_progress(app, profile_id, "download", bucket, key, 0, total, false);
        let mut reader = output.body.into_async_read();
        let mut file = File::create(local_path)
            .await
            .map_err(|error| AppError::new("s3_download_error", error.to_string()))?;
        let mut buffer = vec![0u8; 128 * 1024];
        let mut transferred = 0u64;
        loop {
            let read = reader
                .read(&mut buffer)
                .await
                .map_err(|error| AppError::new("s3_download_error", error.to_string()))?;
            if read == 0 {
                break;
            }
            file.write_all(&buffer[..read])
                .await
                .map_err(|error| AppError::new("s3_download_error", error.to_string()))?;
            transferred += read as u64;
            emit_progress(
                app,
                profile_id,
                "download",
                bucket,
                key,
                transferred,
                total,
                false,
            );
        }
        file.flush()
            .await
            .map_err(|error| AppError::new("s3_download_error", error.to_string()))?;
        emit_progress(
            app,
            profile_id,
            "download",
            bucket,
            key,
            transferred,
            total,
            true,
        );
        Ok(())
    }

    // Each argument is an independent part of the transfer request (target,
    // credentials, progress sink); grouping them would not simplify callers.
    #[allow(clippy::too_many_arguments)]
    pub async fn download_prefix(
        &self,
        app: &AppHandle,
        profile_id: &str,
        client: &Client,
        bucket: &str,
        prefix: &str,
        local_directory: &str,
        concurrency: u8,
    ) -> AppResult<u64> {
        let keys = self.all_keys(client, bucket, prefix).await?;
        let folder_name = prefix
            .trim_end_matches('/')
            .rsplit('/')
            .next()
            .filter(|name| !name.is_empty())
            .ok_or_else(|| {
                AppError::new("s3_download_error", "无法确定递归下载的目标文件夹名称。")
            })?;
        let root = safe_local_path(Path::new(local_directory), folder_name)?;
        tokio::fs::create_dir_all(&root)
            .await
            .map_err(|error| AppError::new("s3_download_error", error.to_string()))?;
        let mut downloads = Vec::new();
        for key in keys {
            if key.ends_with('/') {
                continue;
            }
            let relative = key.strip_prefix(prefix).unwrap_or(&key);
            let destination = safe_local_path(&root, relative)?;
            if let Some(parent) = destination.parent() {
                tokio::fs::create_dir_all(parent)
                    .await
                    .map_err(|error| AppError::new("s3_download_error", error.to_string()))?;
            }
            downloads.push((key, destination.to_string_lossy().to_string()));
        }

        let limit = usize::from(concurrency.clamp(1, 8));
        let mut pending = downloads.into_iter();
        let mut tasks = tokio::task::JoinSet::new();
        let mut downloaded = 0u64;

        loop {
            while tasks.len() < limit {
                let Some((key, destination)) = pending.next() else {
                    break;
                };
                let manager = self.clone();
                let app = app.clone();
                let profile_id = profile_id.to_string();
                let client = client.clone();
                let bucket = bucket.to_string();
                tasks.spawn(async move {
                    manager
                        .download(&app, &profile_id, &client, &bucket, &key, &destination)
                        .await
                });
            }

            let Some(result) = tasks.join_next().await else {
                break;
            };
            match result {
                Ok(Ok(())) => downloaded += 1,
                Ok(Err(error)) => {
                    tasks.abort_all();
                    return Err(error);
                }
                Err(error) => {
                    tasks.abort_all();
                    return Err(AppError::new("s3_download_error", error.to_string()));
                }
            }
        }
        Ok(downloaded)
    }

    pub async fn delete(
        &self,
        client: &Client,
        bucket: &str,
        key: &str,
        recursive: bool,
    ) -> AppResult<u64> {
        if !recursive {
            client
                .delete_object()
                .bucket(bucket)
                .key(key)
                .send()
                .await
                .map_err(s3_error)?;
            return Ok(1);
        }
        let keys = self.all_keys(client, bucket, key).await?;
        let mut deleted = 0u64;
        for chunk in keys.chunks(1000) {
            let objects = chunk
                .iter()
                .map(|key| ObjectIdentifier::builder().key(key).build())
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| AppError::new("s3_delete_error", error.to_string()))?;
            let delete = Delete::builder()
                .set_objects(Some(objects))
                .build()
                .map_err(|error| AppError::new("s3_delete_error", error.to_string()))?;
            client
                .delete_objects()
                .bucket(bucket)
                .delete(delete)
                .send()
                .await
                .map_err(s3_error)?;
            deleted += chunk.len() as u64;
        }
        Ok(deleted)
    }

    pub async fn cleanup_preview(
        &self,
        client: &Client,
        bucket: &str,
        prefix: &str,
        cutoff_timestamp: i64,
    ) -> AppResult<S3CleanupPreview> {
        let mut objects = Vec::new();
        let mut total_size = 0i64;
        let mut token = None;

        loop {
            let output = client
                .list_objects_v2()
                .bucket(bucket)
                .prefix(prefix)
                .set_continuation_token(token)
                .send()
                .await
                .map_err(s3_error)?;

            for object in output.contents() {
                let Some(key) = object.key() else {
                    continue;
                };
                let last_modified = object.last_modified().map(|date| date.secs());
                if !is_cleanup_candidate(key, prefix, last_modified, cutoff_timestamp) {
                    continue;
                }
                let last_modified = last_modified.expect("validated by is_cleanup_candidate");
                let size = object.size().unwrap_or_default();
                if append_cleanup_preview(
                    &mut objects,
                    &mut total_size,
                    S3CleanupObject {
                        key: key.to_string(),
                        size,
                        last_modified,
                    },
                ) {
                    return Ok(S3CleanupPreview {
                        objects,
                        total_size,
                        exceeded_limit: true,
                    });
                }
            }

            token = output.next_continuation_token().map(str::to_string);
            if token.is_none() {
                break;
            }
        }

        Ok(S3CleanupPreview {
            objects,
            total_size,
            exceeded_limit: false,
        })
    }

    pub async fn delete_exact_keys(
        &self,
        client: &Client,
        bucket: &str,
        prefix: &str,
        requested_keys: Vec<String>,
    ) -> AppResult<u64> {
        if requested_keys.is_empty() {
            return Ok(0);
        }
        if prefix.is_empty() {
            return Err(AppError::new("validation_error", "清理目录不能为空。"));
        }
        let prefix = folder_key(prefix);
        if requested_keys.len() > CLEANUP_PREVIEW_LIMIT {
            return Err(AppError::new(
                "validation_error",
                "一次最多可清理 10,000 个对象。",
            ));
        }

        let mut seen = HashSet::new();
        let mut keys = Vec::with_capacity(requested_keys.len());
        for key in requested_keys {
            if key.is_empty() || !key.starts_with(&prefix) {
                return Err(AppError::new(
                    "validation_error",
                    "待清理对象不在指定目录中。",
                ));
            }
            if seen.insert(key.clone()) {
                keys.push(key);
            }
        }

        let mut deleted = 0u64;
        for chunk in keys.chunks(1000) {
            let objects = chunk
                .iter()
                .map(|key| ObjectIdentifier::builder().key(key).build())
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| AppError::new("s3_delete_error", error.to_string()))?;
            let delete = Delete::builder()
                .set_objects(Some(objects))
                .build()
                .map_err(|error| AppError::new("s3_delete_error", error.to_string()))?;
            client
                .delete_objects()
                .bucket(bucket)
                .delete(delete)
                .send()
                .await
                .map_err(s3_error)?;
            deleted += chunk.len() as u64;
        }
        self.remove_empty_folder_markers(client, bucket, &prefix, &keys)
            .await?;
        Ok(deleted)
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn copy_or_move(
        &self,
        client: &Client,
        source_bucket: &str,
        source_key: &str,
        destination_bucket: &str,
        destination_key: &str,
        recursive: bool,
        move_source: bool,
    ) -> AppResult<u64> {
        let keys = if recursive {
            self.all_keys(client, source_bucket, source_key).await?
        } else {
            vec![source_key.to_string()]
        };
        for key in &keys {
            let suffix = key.strip_prefix(source_key).unwrap_or("");
            let target = format!("{destination_key}{suffix}");
            client
                .copy_object()
                .bucket(destination_bucket)
                .key(target)
                .copy_source(encode_copy_source(source_bucket, key))
                .send()
                .await
                .map_err(s3_error)?;
        }
        if move_source {
            self.delete(client, source_bucket, source_key, recursive)
                .await?;
        }
        Ok(keys.len() as u64)
    }

    pub async fn set_acl(
        &self,
        client: &Client,
        bucket: &str,
        key: &str,
        acl: &str,
    ) -> AppResult<()> {
        let acl = parse_acl(Some(acl))?
            .ok_or_else(|| AppError::new("validation_error", "A canned ACL value is required."))?;
        client
            .put_object_acl()
            .bucket(bucket)
            .key(key)
            .acl(acl)
            .send()
            .await
            .map_err(s3_error)?;
        Ok(())
    }

    pub async fn canned_acl(&self, client: &Client, bucket: &str, key: &str) -> AppResult<String> {
        const ALL_USERS: &str = "http://acs.amazonaws.com/groups/global/AllUsers";
        const AUTHENTICATED_USERS: &str =
            "http://acs.amazonaws.com/groups/global/AuthenticatedUsers";

        let output = client
            .get_object_acl()
            .bucket(bucket)
            .key(key)
            .send()
            .await
            .map_err(s3_error)?;
        let mut all_users_read = false;
        let mut all_users_write = false;
        let mut authenticated_users_read = false;

        for grant in output.grants() {
            let Some(uri) = grant.grantee().and_then(|grantee| grantee.uri()) else {
                continue;
            };
            let permission = grant.permission().map(|value| value.as_str());
            match (uri, permission) {
                (ALL_USERS, Some("READ")) => all_users_read = true,
                (ALL_USERS, Some("WRITE")) => all_users_write = true,
                (AUTHENTICATED_USERS, Some("READ")) => authenticated_users_read = true,
                _ => {}
            }
        }

        Ok(if all_users_read && all_users_write {
            "public-read-write"
        } else if all_users_read {
            "public-read"
        } else if authenticated_users_read {
            "authenticated-read"
        } else {
            "private"
        }
        .to_string())
    }

    async fn all_keys(
        &self,
        client: &Client,
        bucket: &str,
        prefix: &str,
    ) -> AppResult<Vec<String>> {
        let mut keys = Vec::new();
        let mut token = None;
        loop {
            let output = client
                .list_objects_v2()
                .bucket(bucket)
                .prefix(prefix)
                .set_continuation_token(token)
                .send()
                .await
                .map_err(s3_error)?;
            keys.extend(
                output
                    .contents()
                    .iter()
                    .filter_map(|object| object.key().map(str::to_string)),
            );
            token = output.next_continuation_token().map(str::to_string);
            if token.is_none() {
                break;
            }
        }
        Ok(keys)
    }

    async fn remove_empty_folder_markers(
        &self,
        client: &Client,
        bucket: &str,
        root_prefix: &str,
        deleted_keys: &[String],
    ) -> AppResult<()> {
        for folder in cleanup_folder_prefixes(root_prefix, deleted_keys) {
            let output = client
                .list_objects_v2()
                .bucket(bucket)
                .prefix(&folder)
                .max_keys(2)
                .send()
                .await
                .map_err(s3_error)?;
            let keys = output
                .contents()
                .iter()
                .filter_map(|object| object.key())
                .collect::<Vec<_>>();
            let contains_other_object = keys.iter().any(|key| *key != folder);
            let has_marker = keys.iter().any(|key| *key == folder);
            if has_marker && !contains_other_object && output.next_continuation_token().is_none() {
                client
                    .delete_object()
                    .bucket(bucket)
                    .key(folder)
                    .send()
                    .await
                    .map_err(s3_error)?;
            }
        }
        Ok(())
    }
}

fn parse_acl(value: Option<&str>) -> AppResult<Option<ObjectCannedAcl>> {
    value
        .filter(|value| !value.trim().is_empty())
        .map(|value| match value {
            "private" => Ok(ObjectCannedAcl::Private),
            "public-read" => Ok(ObjectCannedAcl::PublicRead),
            "public-read-write" => Ok(ObjectCannedAcl::PublicReadWrite),
            "authenticated-read" => Ok(ObjectCannedAcl::AuthenticatedRead),
            "aws-exec-read" => Ok(ObjectCannedAcl::AwsExecRead),
            "bucket-owner-read" => Ok(ObjectCannedAcl::BucketOwnerRead),
            "bucket-owner-full-control" => Ok(ObjectCannedAcl::BucketOwnerFullControl),
            _ => Err(AppError::new(
                "validation_error",
                format!("Unsupported canned ACL '{value}'."),
            )),
        })
        .transpose()
}

fn folder_key(key: &str) -> String {
    if key.ends_with('/') {
        key.to_string()
    } else {
        format!("{key}/")
    }
}

fn is_cleanup_candidate(
    key: &str,
    prefix: &str,
    last_modified: Option<i64>,
    cutoff_timestamp: i64,
) -> bool {
    key != prefix
        && !key.ends_with('/')
        && last_modified.is_some_and(|timestamp| timestamp < cutoff_timestamp)
}

/// Adds one object to a preview. Returns `true` when the preview cap has
/// already been reached, so the caller can stop paging immediately.
fn append_cleanup_preview(
    objects: &mut Vec<S3CleanupObject>,
    total_size: &mut i64,
    object: S3CleanupObject,
) -> bool {
    if objects.len() >= CLEANUP_PREVIEW_LIMIT {
        return true;
    }
    *total_size += object.size;
    objects.push(object);
    false
}

fn cleanup_folder_prefixes(root_prefix: &str, keys: &[String]) -> Vec<String> {
    let root = folder_key(root_prefix);
    let mut folders = HashSet::new();

    for key in keys {
        let mut current = parent_folder_prefix(key);
        while !current.is_empty() && current.starts_with(&root) {
            let is_root = current == root;
            folders.insert(current.clone());
            if is_root {
                break;
            }
            current = parent_folder_prefix(current.trim_end_matches('/'));
        }
    }

    let mut folders = folders.into_iter().collect::<Vec<_>>();
    folders.sort_by_key(|folder| std::cmp::Reverse(folder.len()));
    folders
}

fn parent_folder_prefix(key: &str) -> String {
    let clean = key.trim_end_matches('/');
    clean
        .rfind('/')
        .map(|index| format!("{}/", &clean[..index]))
        .unwrap_or_default()
}

fn safe_local_path(root: &Path, relative: &str) -> AppResult<std::path::PathBuf> {
    use std::path::Component;

    let relative_path = Path::new(relative);
    if relative_path.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
        return Err(AppError::new(
            "s3_download_error",
            "S3 object key cannot be mapped to a safe local path.",
        ));
    }
    Ok(root.join(relative_path))
}

fn encode_copy_source(bucket: &str, key: &str) -> String {
    format!("{bucket}/{}", percent_encode_path(key))
}

fn percent_encode_path(value: &str) -> String {
    value
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' => {
                (byte as char).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

#[allow(clippy::too_many_arguments)]
fn emit_progress(
    app: &AppHandle,
    profile_id: &str,
    operation: &str,
    bucket: &str,
    key: &str,
    transferred: u64,
    total: Option<u64>,
    done: bool,
) {
    let _ = app.emit(
        S3_TRANSFER_PROGRESS_EVENT,
        TransferProgress {
            profile_id: profile_id.to_string(),
            operation: operation.to_string(),
            bucket: bucket.to_string(),
            key: key.to_string(),
            transferred,
            total,
            done,
        },
    );
}

fn s3_error(error: impl std::fmt::Display) -> AppError {
    AppError::new("s3_error", error.to_string())
}

#[cfg(test)]
mod tests {
    use super::{
        CLEANUP_PREVIEW_LIMIT, S3CleanupObject, append_cleanup_preview, cleanup_folder_prefixes,
        is_cleanup_candidate,
    };

    #[test]
    fn cleanup_candidate_uses_strict_cutoff_and_ignores_folder_markers() {
        assert!(is_cleanup_candidate(
            "archive/old.log",
            "archive/",
            Some(99),
            100
        ));
        assert!(!is_cleanup_candidate(
            "archive/current.log",
            "archive/",
            Some(100),
            100
        ));
        assert!(!is_cleanup_candidate("archive/", "archive/", Some(1), 100));
        assert!(!is_cleanup_candidate(
            "archive/folder/",
            "archive/",
            Some(1),
            100
        ));
        assert!(!is_cleanup_candidate(
            "archive/unknown.log",
            "archive/",
            None,
            100
        ));
    }

    #[test]
    fn cleanup_preview_caps_at_ten_thousand_objects() {
        let mut objects = Vec::new();
        let mut total_size = 0;
        for index in 0..CLEANUP_PREVIEW_LIMIT {
            assert!(!append_cleanup_preview(
                &mut objects,
                &mut total_size,
                S3CleanupObject {
                    key: format!("archive/{index}"),
                    size: 1,
                    last_modified: 1,
                },
            ));
        }
        assert_eq!(objects.len(), CLEANUP_PREVIEW_LIMIT);
        assert_eq!(total_size, CLEANUP_PREVIEW_LIMIT as i64);
        assert!(append_cleanup_preview(
            &mut objects,
            &mut total_size,
            S3CleanupObject {
                key: "archive/overflow".to_string(),
                size: 1,
                last_modified: 1,
            },
        ));
        assert_eq!(objects.len(), CLEANUP_PREVIEW_LIMIT);
        assert_eq!(total_size, CLEANUP_PREVIEW_LIMIT as i64);
    }

    #[test]
    fn cleanup_preview_starts_empty() {
        let objects: Vec<S3CleanupObject> = Vec::new();
        assert!(objects.is_empty());
        assert_eq!(objects.iter().map(|object| object.size).sum::<i64>(), 0);
    }

    #[test]
    fn cleanup_delete_batches_at_s3_limit() {
        let keys = (0..2_001).collect::<Vec<_>>();
        let batches = keys
            .chunks(1_000)
            .map(|batch| batch.len())
            .collect::<Vec<_>>();
        assert_eq!(batches, vec![1_000, 1_000, 1]);
    }

    #[test]
    fn cleanup_empty_folder_candidates_are_deepest_first() {
        let keys = vec![
            "tools/dssh/releases/old.exe".to_string(),
            "tools/dssh/README".to_string(),
        ];
        assert_eq!(
            cleanup_folder_prefixes("tools/dssh/", &keys),
            vec![
                "tools/dssh/releases/".to_string(),
                "tools/dssh/".to_string(),
            ],
        );
    }
}
