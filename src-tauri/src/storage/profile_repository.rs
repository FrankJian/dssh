use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{Connection, OptionalExtension, Row, params};
use serde_json::Value;

use crate::{
    error::{AppError, AppResult},
    models::kubernetes::{
        CreateKubernetesProfileRequest, KubernetesAuditEntry, KubernetesContextSelection,
        KubernetesProfile, KubernetesSource, UpdateKubernetesProfileRequest,
    },
    models::s3::{
        CreateS3ProfileRequest, S3Bookmark, S3Credentials, S3Profile, UpdateS3ProfileRequest,
    },
    models::ssh_profile::{
        AuthMethod, CreateSshProfileRequest, SshProfile, SshProxy, UpdateSshProfileRequest,
    },
};

const INIT_MIGRATION: &str = include_str!("../../migrations/001_init.sql");
const S3_MIGRATION: &str = include_str!("../../migrations/002_s3_profiles.sql");
const S3_BOOKMARKS_MIGRATION: &str = include_str!("../../migrations/003_s3_bookmarks.sql");
const AI_CHAT_HISTORY_MIGRATION: &str = include_str!("../../migrations/004_ai_chat_history.sql");
const SSH_PROXY_MIGRATION: &str = include_str!("../../migrations/005_ssh_proxies.sql");
const KUBERNETES_PROFILES_MIGRATION: &str =
    include_str!("../../migrations/006_kubernetes_profiles.sql");
const KUBERNETES_IMPORTS_MIGRATION: &str =
    include_str!("../../migrations/007_kubernetes_imports.sql");
const KUBERNETES_AUDIT_MIGRATION: &str = include_str!("../../migrations/008_kubernetes_audit.sql");
const MAX_AI_CHAT_HISTORY_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone)]
pub struct ProfileRepository {
    db_path: PathBuf,
}

/// Structured, redacted input for the Kubernetes audit table. Keeping this
/// type in the repository layer prevents arbitrary YAML or command strings
/// from being recorded by accident.
pub struct KubernetesAuditRecord {
    pub profile_id: String,
    pub source: String,
    pub context: String,
    pub identity: Option<String>,
    pub resource: Option<String>,
    pub namespace: Option<String>,
    pub names: Vec<String>,
    pub action: String,
    pub result: String,
    pub error_code: Option<String>,
}

impl ProfileRepository {
    pub fn initialize(app_data_dir: impl AsRef<Path>, database_file_name: &str) -> AppResult<Self> {
        fs::create_dir_all(app_data_dir.as_ref())?;
        let db_path = app_data_dir.as_ref().join(database_file_name);
        let repository = Self { db_path };
        repository.migrate()?;
        Ok(repository)
    }

    pub fn list_profiles(&self) -> AppResult<Vec<SshProfile>> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT id, name, host, port, username, auth_type, secret_ref, key_path, key_data,
                    key_name, passphrase_ref, description, favorite, tags, created_at, updated_at,
                    proxy_type, proxy_host, proxy_port, proxy_username, proxy_password
             FROM ssh_profiles
             ORDER BY favorite DESC, name COLLATE NOCASE ASC",
        )?;
        let rows = statement.query_map([], map_profile_row)?;
        let profiles = rows.collect::<Result<Vec<_>, _>>()?;
        Ok(profiles)
    }

    pub fn create_profile(&self, request: CreateSshProfileRequest) -> AppResult<SshProfile> {
        let now = timestamp();
        let id = create_id();
        let profile = SshProfile {
            id,
            name: request.name.trim().to_string(),
            host: request.host.trim().to_string(),
            port: request.port,
            username: request.username.trim().to_string(),
            auth_method: request.auth_method,
            proxy: normalize_proxy(request.proxy)?,
            description: normalize_optional(request.description),
            favorite: request.favorite,
            tags: normalize_tags(request.tags),
            created_at: now.clone(),
            updated_at: now,
        };

        validate_profile(&profile)?;

        let connection = self.connection()?;
        insert_profile(&connection, &profile)?;
        Ok(profile)
    }

    pub fn update_profile(&self, request: UpdateSshProfileRequest) -> AppResult<SshProfile> {
        let existing = self.get_profile(&request.id)?.ok_or_else(|| {
            AppError::new(
                "profile_not_found",
                format!("SSH profile '{}' does not exist.", request.id),
            )
        })?;

        let profile = SshProfile {
            id: existing.id,
            name: request.name.trim().to_string(),
            host: request.host.trim().to_string(),
            port: request.port,
            username: request.username.trim().to_string(),
            auth_method: merge_auth_method(existing.auth_method, request.auth_method),
            proxy: merge_proxy(existing.proxy, request.proxy)?,
            description: normalize_optional(request.description),
            favorite: request.favorite,
            tags: normalize_tags(request.tags),
            created_at: existing.created_at,
            updated_at: timestamp(),
        };

        validate_profile(&profile)?;

        let connection = self.connection()?;
        update_profile(&connection, &profile)?;
        Ok(profile)
    }

    pub fn delete_profile(&self, id: &str) -> AppResult<()> {
        let connection = self.connection()?;
        connection.execute("DELETE FROM ssh_profiles WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn set_favorite(&self, id: &str, favorite: bool) -> AppResult<SshProfile> {
        let profile = self.get_profile(id)?.ok_or_else(|| {
            AppError::new(
                "profile_not_found",
                format!("SSH profile '{id}' does not exist."),
            )
        })?;
        let updated_profile = SshProfile {
            favorite,
            updated_at: timestamp(),
            ..profile
        };
        let connection = self.connection()?;
        update_profile(&connection, &updated_profile)?;
        Ok(updated_profile)
    }

    pub fn get_profile(&self, id: &str) -> AppResult<Option<SshProfile>> {
        let connection = self.connection()?;
        let profile = connection
            .query_row(
                "SELECT id, name, host, port, username, auth_type, secret_ref, key_path, key_data,
                        key_name, passphrase_ref, description, favorite, tags, created_at, updated_at,
                        proxy_type, proxy_host, proxy_port, proxy_username, proxy_password
                 FROM ssh_profiles
                 WHERE id = ?1",
                params![id],
                map_profile_row,
            )
            .optional()?;
        Ok(profile)
    }

    pub fn list_s3_profiles(&self) -> AppResult<Vec<S3Profile>> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT id, name, host, port, use_tls, endpoint, region, access_key_id,
                    secret_access_key_ref, session_token_ref, force_path_style, default_bucket,
                    default_acl, favorite, description, tags, created_at, updated_at
             FROM s3_profiles ORDER BY favorite DESC, name COLLATE NOCASE ASC",
        )?;
        Ok(statement
            .query_map([], map_s3_profile_row)?
            .collect::<Result<Vec<_>, _>>()?)
    }

    pub fn get_s3_profile(&self, id: &str) -> AppResult<Option<S3Profile>> {
        let connection = self.connection()?;
        Ok(connection
            .query_row(
                "SELECT id, name, host, port, use_tls, endpoint, region, access_key_id,
                        secret_access_key_ref, session_token_ref, force_path_style, default_bucket,
                        default_acl, favorite, description, tags, created_at, updated_at
                 FROM s3_profiles WHERE id = ?1",
                params![id],
                map_s3_profile_row,
            )
            .optional()?)
    }

    pub fn create_s3_profile(&self, request: CreateS3ProfileRequest) -> AppResult<S3Profile> {
        validate_s3_request(
            &request.name,
            &request.host,
            request.port,
            &request.access_key_id,
            Some(&request.secret_access_key),
        )?;
        let id = create_id_with_prefix("s3-profile");
        let now = timestamp();
        let secret_ref = format!("s3:{id}:secret-access-key");
        let token = normalize_optional(request.session_token);
        let token_ref = token.as_ref().map(|_| format!("s3:{id}:session-token"));
        let profile = S3Profile {
            id: id.clone(),
            name: request.name.trim().to_string(),
            host: normalize_s3_host(&request.host)?,
            port: request.port,
            use_tls: request.use_tls,
            endpoint: build_s3_endpoint(&request.host, request.port, request.use_tls)?,
            region: "us-east-1".to_string(),
            access_key_id: request.access_key_id.trim().to_string(),
            force_path_style: request.force_path_style,
            default_bucket: normalize_optional(request.default_bucket),
            default_acl: normalize_s3_acl(request.default_acl)?,
            favorite: request.favorite,
            description: normalize_optional(request.description),
            tags: normalize_tags(request.tags),
            has_secret_access_key: true,
            has_session_token: token.is_some(),
            created_at: now.clone(),
            updated_at: now,
        };

        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        set_secret_on(&transaction, &secret_ref, request.secret_access_key.trim())?;
        if let (Some(reference), Some(value)) = (&token_ref, &token) {
            set_secret_on(&transaction, reference, value)?;
        }
        transaction.execute(
            "INSERT INTO s3_profiles (
                id, name, host, port, use_tls, endpoint, region, access_key_id,
                secret_access_key_ref, session_token_ref, force_path_style, default_bucket,
                default_acl, favorite, description, tags, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
            params![
                profile.id,
                profile.name,
                profile.host,
                profile.port,
                bool_to_i64(profile.use_tls),
                profile.endpoint,
                profile.region,
                profile.access_key_id,
                secret_ref,
                token_ref,
                bool_to_i64(profile.force_path_style),
                profile.default_bucket,
                profile.default_acl,
                bool_to_i64(profile.favorite),
                profile.description,
                serialize_tags(&profile.tags),
                profile.created_at,
                profile.updated_at,
            ],
        )?;
        transaction.commit()?;
        Ok(profile)
    }

    pub fn update_s3_profile(&self, request: UpdateS3ProfileRequest) -> AppResult<S3Profile> {
        let existing = self.get_s3_profile(&request.id)?.ok_or_else(|| {
            AppError::new(
                "s3_profile_not_found",
                format!("S3 profile '{}' does not exist.", request.id),
            )
        })?;
        validate_s3_request(
            &request.name,
            &request.host,
            request.port,
            &request.access_key_id,
            None,
        )?;
        let secret_ref = format!("s3:{}:secret-access-key", request.id);
        let token_ref = format!("s3:{}:session-token", request.id);
        let token_update = request.session_token.map(|value| value.trim().to_string());
        let has_session_token = match &token_update {
            Some(value) => !value.is_empty(),
            None => existing.has_session_token,
        };
        let profile = S3Profile {
            id: request.id,
            name: request.name.trim().to_string(),
            host: normalize_s3_host(&request.host)?,
            port: request.port,
            use_tls: request.use_tls,
            endpoint: build_s3_endpoint(&request.host, request.port, request.use_tls)?,
            region: "us-east-1".to_string(),
            access_key_id: request.access_key_id.trim().to_string(),
            force_path_style: request.force_path_style,
            default_bucket: normalize_optional(request.default_bucket),
            default_acl: normalize_s3_acl(request.default_acl)?,
            favorite: request.favorite,
            description: normalize_optional(request.description),
            tags: normalize_tags(request.tags),
            has_secret_access_key: true,
            has_session_token,
            created_at: existing.created_at,
            updated_at: timestamp(),
        };

        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        if let Some(secret) = request
            .secret_access_key
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            set_secret_on(&transaction, &secret_ref, secret)?;
        }
        match token_update {
            Some(token) if token.is_empty() => {
                transaction
                    .execute("DELETE FROM app_secrets WHERE key = ?1", params![token_ref])?;
            }
            Some(token) => set_secret_on(&transaction, &token_ref, &token)?,
            None => {}
        }
        transaction.execute(
            "UPDATE s3_profiles SET name = ?2, host = ?3, port = ?4, use_tls = ?5,
                endpoint = ?6, region = ?7, access_key_id = ?8, secret_access_key_ref = ?9,
                session_token_ref = ?10, force_path_style = ?11, default_bucket = ?12,
                default_acl = ?13, favorite = ?14, description = ?15, tags = ?16,
                updated_at = ?17 WHERE id = ?1",
            params![
                profile.id,
                profile.name,
                profile.host,
                profile.port,
                bool_to_i64(profile.use_tls),
                profile.endpoint,
                profile.region,
                profile.access_key_id,
                secret_ref,
                profile.has_session_token.then_some(token_ref),
                bool_to_i64(profile.force_path_style),
                profile.default_bucket,
                profile.default_acl,
                bool_to_i64(profile.favorite),
                profile.description,
                serialize_tags(&profile.tags),
                profile.updated_at,
            ],
        )?;
        transaction.commit()?;
        Ok(profile)
    }

    pub fn delete_s3_profile(&self, id: &str) -> AppResult<()> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        transaction.execute(
            "DELETE FROM s3_bookmarks WHERE profile_id = ?1",
            params![id],
        )?;
        transaction.execute("DELETE FROM s3_profiles WHERE id = ?1", params![id])?;
        transaction.execute(
            "DELETE FROM app_secrets WHERE key IN (?1, ?2)",
            params![
                format!("s3:{id}:secret-access-key"),
                format!("s3:{id}:session-token")
            ],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn list_s3_bookmarks(&self, profile_id: &str) -> AppResult<Vec<S3Bookmark>> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT id, profile_id, name, bucket, prefix, created_at
             FROM s3_bookmarks
             WHERE profile_id = ?1
             ORDER BY name COLLATE NOCASE ASC",
        )?;
        Ok(statement
            .query_map(params![profile_id], map_s3_bookmark_row)?
            .collect::<Result<Vec<_>, _>>()?)
    }

    pub fn create_s3_bookmark(
        &self,
        profile_id: &str,
        name: String,
        bucket: String,
        prefix: String,
    ) -> AppResult<S3Bookmark> {
        if self.get_s3_profile(profile_id)?.is_none() {
            return Err(AppError::new(
                "s3_profile_not_found",
                format!("S3 profile '{profile_id}' does not exist."),
            ));
        }
        let name = name.trim().to_string();
        let bucket = bucket.trim().to_string();
        if name.is_empty() || bucket.is_empty() {
            return Err(AppError::new(
                "validation_error",
                "Bookmark name and bucket are required.",
            ));
        }
        let bookmark = S3Bookmark {
            id: create_id_with_prefix("s3-bookmark"),
            profile_id: profile_id.to_string(),
            name,
            bucket,
            prefix: prefix.trim_matches('/').to_string(),
            created_at: timestamp(),
        };
        let connection = self.connection()?;
        connection.execute(
            "INSERT INTO s3_bookmarks (id, profile_id, name, bucket, prefix, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(profile_id, bucket, prefix) DO UPDATE SET name = excluded.name",
            params![
                bookmark.id,
                bookmark.profile_id,
                bookmark.name,
                bookmark.bucket,
                bookmark.prefix,
                bookmark.created_at,
            ],
        )?;
        Ok(connection.query_row(
            "SELECT id, profile_id, name, bucket, prefix, created_at
             FROM s3_bookmarks
             WHERE profile_id = ?1 AND bucket = ?2 AND prefix = ?3",
            params![bookmark.profile_id, bookmark.bucket, bookmark.prefix],
            map_s3_bookmark_row,
        )?)
    }

    pub fn delete_s3_bookmark(&self, profile_id: &str, id: &str) -> AppResult<()> {
        let connection = self.connection()?;
        connection.execute(
            "DELETE FROM s3_bookmarks WHERE id = ?1 AND profile_id = ?2",
            params![id, profile_id],
        )?;
        Ok(())
    }

    pub fn set_s3_profile_favorite(&self, id: &str, favorite: bool) -> AppResult<S3Profile> {
        let connection = self.connection()?;
        let changed = connection.execute(
            "UPDATE s3_profiles SET favorite = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, bool_to_i64(favorite), timestamp()],
        )?;
        if changed == 0 {
            return Err(AppError::new(
                "s3_profile_not_found",
                format!("S3 profile '{id}' does not exist."),
            ));
        }
        self.get_s3_profile(id)?.ok_or_else(|| {
            AppError::new(
                "s3_profile_not_found",
                format!("S3 profile '{id}' does not exist."),
            )
        })
    }

    pub fn s3_credentials(&self, id: &str) -> AppResult<S3Credentials> {
        let profile = self.get_s3_profile(id)?.ok_or_else(|| {
            AppError::new(
                "s3_profile_not_found",
                format!("S3 profile '{id}' does not exist."),
            )
        })?;
        let secret_access_key = self
            .get_secret(&format!("s3:{id}:secret-access-key"))?
            .ok_or_else(|| {
                AppError::new("s3_credentials_missing", "Secret access key is missing.")
            })?;
        let session_token = if profile.has_session_token {
            self.get_secret(&format!("s3:{id}:session-token"))?
        } else {
            None
        };
        Ok(S3Credentials {
            access_key_id: profile.access_key_id,
            secret_access_key,
            session_token,
        })
    }

    pub fn list_kubernetes_profiles(&self) -> AppResult<Vec<KubernetesProfile>> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT id, name, source_json, selected_contexts_json, favorite, description, tags,
                    created_at, updated_at
             FROM kubernetes_profiles
             ORDER BY favorite DESC, name COLLATE NOCASE ASC",
        )?;
        Ok(statement
            .query_map([], map_kubernetes_profile_row)?
            .collect::<Result<Vec<_>, _>>()?)
    }

    pub fn get_kubernetes_profile(&self, id: &str) -> AppResult<Option<KubernetesProfile>> {
        let connection = self.connection()?;
        Ok(connection
            .query_row(
                "SELECT id, name, source_json, selected_contexts_json, favorite, description, tags,
                        created_at, updated_at
                 FROM kubernetes_profiles WHERE id = ?1",
                params![id],
                map_kubernetes_profile_row,
            )
            .optional()?)
    }

    pub fn create_kubernetes_profile(
        &self,
        request: CreateKubernetesProfileRequest,
    ) -> AppResult<KubernetesProfile> {
        let now = timestamp();
        let profile = KubernetesProfile {
            id: create_id_with_prefix("kubernetes-profile"),
            name: request.name.trim().to_string(),
            source: normalize_kubernetes_source(request.source)?,
            selected_contexts: normalize_kubernetes_contexts(request.selected_contexts)?,
            favorite: request.favorite,
            description: normalize_optional(request.description),
            tags: normalize_tags(request.tags),
            created_at: now.clone(),
            updated_at: now,
        };
        validate_kubernetes_profile(&profile)?;
        let connection = self.connection()?;
        insert_kubernetes_profile(&connection, &profile)?;
        Ok(profile)
    }

    pub fn update_kubernetes_profile(
        &self,
        request: UpdateKubernetesProfileRequest,
    ) -> AppResult<KubernetesProfile> {
        let existing = self.get_kubernetes_profile(&request.id)?.ok_or_else(|| {
            AppError::new(
                "kubernetes_profile_not_found",
                format!("Kubernetes profile '{}' does not exist.", request.id),
            )
        })?;
        let profile = KubernetesProfile {
            id: existing.id,
            name: request.name.trim().to_string(),
            source: normalize_kubernetes_source(request.source)?,
            selected_contexts: normalize_kubernetes_contexts(request.selected_contexts)?,
            favorite: request.favorite,
            description: normalize_optional(request.description),
            tags: normalize_tags(request.tags),
            created_at: existing.created_at,
            updated_at: timestamp(),
        };
        validate_kubernetes_profile(&profile)?;
        let connection = self.connection()?;
        update_kubernetes_profile(&connection, &profile)?;
        Ok(profile)
    }

    pub fn delete_kubernetes_profile(&self, id: &str) -> AppResult<()> {
        let connection = self.connection()?;
        connection.execute("DELETE FROM kubernetes_profiles WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn set_kubernetes_profile_favorite(
        &self,
        id: &str,
        favorite: bool,
    ) -> AppResult<KubernetesProfile> {
        let connection = self.connection()?;
        if connection.execute(
            "UPDATE kubernetes_profiles SET favorite = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, bool_to_i64(favorite), timestamp()],
        )? == 0
        {
            return Err(AppError::new(
                "kubernetes_profile_not_found",
                format!("Kubernetes profile '{id}' does not exist."),
            ));
        }
        self.get_kubernetes_profile(id)?.ok_or_else(|| {
            AppError::new(
                "kubernetes_profile_not_found",
                format!("Kubernetes profile '{id}' does not exist."),
            )
        })
    }

    fn migrate(&self) -> AppResult<()> {
        let connection = self.connection()?;
        connection.execute_batch(INIT_MIGRATION)?;
        connection.execute_batch(S3_MIGRATION)?;
        connection.execute_batch(S3_BOOKMARKS_MIGRATION)?;
        connection.execute_batch(AI_CHAT_HISTORY_MIGRATION)?;
        connection.execute_batch(SSH_PROXY_MIGRATION)?;
        connection.execute_batch(KUBERNETES_PROFILES_MIGRATION)?;
        connection.execute_batch(KUBERNETES_IMPORTS_MIGRATION)?;
        connection.execute_batch(KUBERNETES_AUDIT_MIGRATION)?;
        connection.execute_batch(
            "CREATE TABLE IF NOT EXISTS app_secrets (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );",
        )?;
        ensure_columns(&connection)?;
        Ok(())
    }

    pub fn kubernetes_import_by_fingerprint(
        &self,
        content_fingerprint: &str,
    ) -> AppResult<Option<String>> {
        let connection = self.connection()?;
        Ok(connection
            .query_row(
                "SELECT secret_ref FROM kubernetes_imports WHERE content_fingerprint = ?1",
                params![content_fingerprint],
                |row| row.get(0),
            )
            .optional()?)
    }

    pub fn register_kubernetes_import(
        &self,
        secret_ref: &str,
        content_fingerprint: &str,
    ) -> AppResult<()> {
        let connection = self.connection()?;
        connection.execute(
            "INSERT INTO kubernetes_imports (secret_ref, content_fingerprint, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?3)",
            params![secret_ref, content_fingerprint, timestamp()],
        )?;
        Ok(())
    }

    pub fn delete_kubernetes_import(&self, secret_ref: &str) -> AppResult<()> {
        let connection = self.connection()?;
        connection.execute(
            "DELETE FROM kubernetes_imports WHERE secret_ref = ?1",
            params![secret_ref],
        )?;
        Ok(())
    }

    /// Store a redacted Kubernetes action record. Callers pass only
    /// structured resource identity; YAML and arbitrary commands are not
    /// accepted by this API.
    pub fn record_kubernetes_audit(&self, record: &KubernetesAuditRecord) -> AppResult<()> {
        let names = record
            .names
            .iter()
            .take(100)
            .map(|name| truncate_audit_value(name, 256))
            .collect::<Vec<_>>();
        let names_json = serde_json::to_string(&names)
            .map_err(|error| AppError::new("kubernetes_audit_error", error.to_string()))?;
        let connection = self.connection()?;
        connection.execute(
            "INSERT INTO kubernetes_audit (
                profile_id, source, context, identity, resource, namespace,
                names_json, action, result, error_code, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                truncate_audit_value(&record.profile_id, 256),
                truncate_audit_value(&record.source, 64),
                truncate_audit_value(&record.context, 256),
                record
                    .identity
                    .as_deref()
                    .map(|value| truncate_audit_value(value, 256)),
                record
                    .resource
                    .as_deref()
                    .map(|value| truncate_audit_value(value, 256)),
                record
                    .namespace
                    .as_deref()
                    .map(|value| truncate_audit_value(value, 253)),
                names_json,
                truncate_audit_value(&record.action, 64),
                truncate_audit_value(&record.result, 32),
                record
                    .error_code
                    .as_deref()
                    .map(|value| truncate_audit_value(value, 128)),
                timestamp(),
            ],
        )?;
        // Keep the database bounded on long-lived installations.
        connection.execute(
            "DELETE FROM kubernetes_audit WHERE id NOT IN (
                SELECT id FROM kubernetes_audit ORDER BY id DESC LIMIT 2000
            )",
            [],
        )?;
        Ok(())
    }

    pub fn list_kubernetes_audit(
        &self,
        profile_id: Option<&str>,
        limit: u32,
    ) -> AppResult<Vec<KubernetesAuditEntry>> {
        let connection = self.connection()?;
        let limit = i64::from(limit.clamp(1, 2000));
        let mut statement = connection.prepare(
            "SELECT id, profile_id, source, context, identity, resource, namespace,
                    names_json, action, result, error_code, created_at
             FROM kubernetes_audit
             WHERE (?1 IS NULL OR profile_id = ?1)
             ORDER BY id DESC LIMIT ?2",
        )?;
        let rows = statement.query_map(params![profile_id, limit], |row| {
            let names_json: String = row.get(7)?;
            let names = serde_json::from_str::<Vec<String>>(&names_json).unwrap_or_default();
            Ok(KubernetesAuditEntry {
                id: row.get(0)?,
                profile_id: row.get(1)?,
                source: row.get(2)?,
                context: row.get(3)?,
                identity: row.get(4)?,
                resource: row.get(5)?,
                namespace: row.get(6)?,
                names,
                action: row.get(8)?,
                result: row.get(9)?,
                error_code: row.get(10)?,
                created_at: row.get(11)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    /// Read a stored secret value by key, if present.
    pub fn get_secret(&self, key: &str) -> AppResult<Option<String>> {
        let connection = self.connection()?;
        let value = connection
            .query_row(
                "SELECT value FROM app_secrets WHERE key = ?1",
                params![key],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        Ok(value)
    }

    /// Insert or replace a secret value.
    pub fn set_secret(&self, key: &str, value: &str) -> AppResult<()> {
        let connection = self.connection()?;
        connection.execute(
            "INSERT INTO app_secrets (key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = ?3",
            params![key, value, timestamp()],
        )?;
        Ok(())
    }

    /// Delete a stored secret. No-op if the key does not exist.
    pub fn delete_secret(&self, key: &str) -> AppResult<()> {
        let connection = self.connection()?;
        connection.execute("DELETE FROM app_secrets WHERE key = ?1", params![key])?;
        Ok(())
    }

    pub fn load_ai_chat_history(&self) -> AppResult<Vec<Value>> {
        let connection = self.connection()?;
        let serialized = connection
            .query_row(
                "SELECT items_json FROM ai_chat_history WHERE id = 1",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        serialized
            .map(|value| {
                serde_json::from_str::<Vec<Value>>(&value)
                    .map(normalize_ai_chat_items)
                    .map_err(|error| AppError::new("ai_history_error", error.to_string()))
            })
            .transpose()
            .map(|items| items.unwrap_or_default())
    }

    pub fn save_ai_chat_history(&self, items: Vec<Value>) -> AppResult<()> {
        let serialized = serde_json::to_string(&items)
            .map_err(|error| AppError::new("ai_history_error", error.to_string()))?;
        if serialized.len() > MAX_AI_CHAT_HISTORY_BYTES {
            return Err(AppError::new(
                "ai_history_too_large",
                "聊天记录过大，请清空部分内容后重试。",
            ));
        }
        let connection = self.connection()?;
        connection.execute(
            "INSERT INTO ai_chat_history (id, items_json, updated_at) VALUES (1, ?1, ?2)
             ON CONFLICT(id) DO UPDATE SET items_json = excluded.items_json, updated_at = excluded.updated_at",
            params![serialized, timestamp()],
        )?;
        Ok(())
    }

    pub fn clear_ai_chat_history(&self) -> AppResult<()> {
        let connection = self.connection()?;
        connection.execute("DELETE FROM ai_chat_history WHERE id = 1", [])?;
        Ok(())
    }

    fn connection(&self) -> AppResult<Connection> {
        Ok(Connection::open(&self.db_path)?)
    }
}

fn insert_profile(connection: &Connection, profile: &SshProfile) -> AppResult<()> {
    let auth_fields = AuthFields::from(&profile.auth_method);
    let proxy_fields = ProxyFields::from(profile.proxy.as_ref());
    connection.execute(
        "INSERT INTO ssh_profiles (
            id, name, host, port, username, auth_type, secret_ref, key_path, key_data,
            key_name, passphrase_ref, description, favorite, tags, created_at, updated_at,
            proxy_type, proxy_host, proxy_port, proxy_username, proxy_password
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)",
        params![
            profile.id,
            profile.name,
            profile.host,
            profile.port,
            profile.username,
            auth_fields.auth_type,
            auth_fields.secret_ref,
            auth_fields.key_path,
            auth_fields.key_data,
            auth_fields.key_name,
            auth_fields.passphrase_ref,
            profile.description,
            bool_to_i64(profile.favorite),
            serialize_tags(&profile.tags),
            profile.created_at,
            profile.updated_at,
            proxy_fields.proxy_type,
            proxy_fields.host,
            proxy_fields.port,
            proxy_fields.username,
            proxy_fields.password,
        ],
    )?;
    Ok(())
}

fn update_profile(connection: &Connection, profile: &SshProfile) -> AppResult<()> {
    let auth_fields = AuthFields::from(&profile.auth_method);
    let proxy_fields = ProxyFields::from(profile.proxy.as_ref());
    connection.execute(
        "UPDATE ssh_profiles
         SET name = ?2, host = ?3, port = ?4, username = ?5, auth_type = ?6,
             secret_ref = ?7, key_path = ?8, key_data = ?9, key_name = ?10,
             passphrase_ref = ?11, description = ?12, favorite = ?13, tags = ?14,
             updated_at = ?15, proxy_type = ?16, proxy_host = ?17, proxy_port = ?18,
             proxy_username = ?19, proxy_password = ?20
         WHERE id = ?1",
        params![
            profile.id,
            profile.name,
            profile.host,
            profile.port,
            profile.username,
            auth_fields.auth_type,
            auth_fields.secret_ref,
            auth_fields.key_path,
            auth_fields.key_data,
            auth_fields.key_name,
            auth_fields.passphrase_ref,
            profile.description,
            bool_to_i64(profile.favorite),
            serialize_tags(&profile.tags),
            profile.updated_at,
            proxy_fields.proxy_type,
            proxy_fields.host,
            proxy_fields.port,
            proxy_fields.username,
            proxy_fields.password,
        ],
    )?;
    Ok(())
}

fn map_profile_row(row: &Row<'_>) -> rusqlite::Result<SshProfile> {
    let auth_type: String = row.get(5)?;
    let secret_ref: Option<String> = row.get(6)?;
    let _key_path: Option<String> = row.get(7)?;
    let key_data: Option<String> = row.get(8)?;
    let key_name: Option<String> = row.get(9)?;
    let passphrase_ref: Option<String> = row.get(10)?;
    let tags: Option<String> = row.get(13)?;
    let proxy_type: Option<String> = row.get(16)?;
    let proxy_host: Option<String> = row.get(17)?;
    let proxy_port: Option<u16> = row.get(18)?;
    let proxy_username: Option<String> = row.get(19)?;
    let proxy_password: Option<String> = row.get(20)?;

    Ok(SshProfile {
        id: row.get(0)?,
        name: row.get(1)?,
        host: row.get(2)?,
        port: row.get(3)?,
        username: row.get(4)?,
        auth_method: match auth_type.as_str() {
            "password" => AuthMethod::Password { secret_ref },
            "privateKey" => AuthMethod::PrivateKey {
                key_data,
                key_name,
                passphrase_ref,
            },
            _ => AuthMethod::Password { secret_ref: None },
        },
        proxy: proxy_type.map(|proxy_type| SshProxy {
            proxy_type,
            host: proxy_host.unwrap_or_default(),
            port: proxy_port.unwrap_or_default(),
            username: proxy_username,
            password: proxy_password,
        }),
        description: row.get(11)?,
        favorite: row.get::<_, i64>(12)? != 0,
        tags: deserialize_tags(tags.as_deref()),
        created_at: row.get(14)?,
        updated_at: row.get(15)?,
    })
}

fn map_s3_profile_row(row: &Row<'_>) -> rusqlite::Result<S3Profile> {
    let host: Option<String> = row.get(2)?;
    let port: Option<u16> = row.get(3)?;
    let use_tls: Option<i64> = row.get(4)?;
    let endpoint: Option<String> = row.get(5)?;
    let secret_ref: String = row.get(8)?;
    let token_ref: Option<String> = row.get(9)?;
    let resolved_host = host.unwrap_or_else(|| host_from_endpoint(endpoint.as_deref()));
    Ok(S3Profile {
        id: row.get(0)?,
        name: row.get(1)?,
        host: resolved_host,
        port: port.unwrap_or_else(|| port_from_endpoint(endpoint.as_deref())),
        use_tls: use_tls
            .map(|value| value != 0)
            .unwrap_or_else(|| endpoint_uses_tls(endpoint.as_deref())),
        endpoint,
        region: row.get(6)?,
        access_key_id: row.get(7)?,
        has_secret_access_key: !secret_ref.is_empty(),
        has_session_token: token_ref.is_some(),
        force_path_style: row.get::<_, i64>(10)? != 0,
        default_bucket: row.get(11)?,
        default_acl: row.get(12)?,
        favorite: row.get::<_, i64>(13)? != 0,
        description: row.get(14)?,
        tags: deserialize_tags(row.get::<_, Option<String>>(15)?.as_deref()),
        created_at: row.get(16)?,
        updated_at: row.get(17)?,
    })
}

fn map_kubernetes_profile_row(row: &Row<'_>) -> rusqlite::Result<KubernetesProfile> {
    let source_json: String = row.get(2)?;
    let contexts_json: String = row.get(3)?;
    let source = serde_json::from_str(&source_json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(2, rusqlite::types::Type::Text, Box::new(error))
    })?;
    let selected_contexts = serde_json::from_str(&contexts_json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(3, rusqlite::types::Type::Text, Box::new(error))
    })?;
    Ok(KubernetesProfile {
        id: row.get(0)?,
        name: row.get(1)?,
        source,
        selected_contexts,
        favorite: row.get::<_, i64>(4)? != 0,
        description: row.get(5)?,
        tags: deserialize_tags(row.get::<_, Option<String>>(6)?.as_deref()),
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

fn insert_kubernetes_profile(
    connection: &Connection,
    profile: &KubernetesProfile,
) -> AppResult<()> {
    connection.execute(
        "INSERT INTO kubernetes_profiles (
            id, name, source_json, selected_contexts_json, favorite, description, tags, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            profile.id,
            profile.name,
            serialize_kubernetes_source(&profile.source),
            serialize_kubernetes_contexts(&profile.selected_contexts),
            bool_to_i64(profile.favorite),
            profile.description,
            serialize_tags(&profile.tags),
            profile.created_at,
            profile.updated_at,
        ],
    )?;
    Ok(())
}

fn update_kubernetes_profile(
    connection: &Connection,
    profile: &KubernetesProfile,
) -> AppResult<()> {
    connection.execute(
        "UPDATE kubernetes_profiles
         SET name = ?2, source_json = ?3, selected_contexts_json = ?4, favorite = ?5,
             description = ?6, tags = ?7, updated_at = ?8
         WHERE id = ?1",
        params![
            profile.id,
            profile.name,
            serialize_kubernetes_source(&profile.source),
            serialize_kubernetes_contexts(&profile.selected_contexts),
            bool_to_i64(profile.favorite),
            profile.description,
            serialize_tags(&profile.tags),
            profile.updated_at,
        ],
    )?;
    Ok(())
}

fn map_s3_bookmark_row(row: &Row<'_>) -> rusqlite::Result<S3Bookmark> {
    Ok(S3Bookmark {
        id: row.get(0)?,
        profile_id: row.get(1)?,
        name: row.get(2)?,
        bucket: row.get(3)?,
        prefix: row.get(4)?,
        created_at: row.get(5)?,
    })
}

/// Add columns introduced after the initial schema so existing databases keep
/// working without a full migration runner.
fn ensure_columns(connection: &Connection) -> AppResult<()> {
    let mut statement = connection.prepare("PRAGMA table_info(ssh_profiles)")?;
    let existing: HashSet<String> = statement
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<HashSet<_>, _>>()?;

    for (column, ddl) in [
        (
            "key_data",
            "ALTER TABLE ssh_profiles ADD COLUMN key_data TEXT",
        ),
        (
            "key_name",
            "ALTER TABLE ssh_profiles ADD COLUMN key_name TEXT",
        ),
        ("tags", "ALTER TABLE ssh_profiles ADD COLUMN tags TEXT"),
        (
            "proxy_type",
            "ALTER TABLE ssh_profiles ADD COLUMN proxy_type TEXT",
        ),
        (
            "proxy_host",
            "ALTER TABLE ssh_profiles ADD COLUMN proxy_host TEXT",
        ),
        (
            "proxy_port",
            "ALTER TABLE ssh_profiles ADD COLUMN proxy_port INTEGER",
        ),
        (
            "proxy_username",
            "ALTER TABLE ssh_profiles ADD COLUMN proxy_username TEXT",
        ),
        (
            "proxy_password",
            "ALTER TABLE ssh_profiles ADD COLUMN proxy_password TEXT",
        ),
    ] {
        if !existing.contains(column) {
            connection.execute(ddl, [])?;
        }
    }

    let mut statement = connection.prepare("PRAGMA table_info(s3_profiles)")?;
    let s3_existing: HashSet<String> = statement
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<HashSet<_>, _>>()?;
    for (column, ddl) in [
        ("host", "ALTER TABLE s3_profiles ADD COLUMN host TEXT"),
        (
            "port",
            "ALTER TABLE s3_profiles ADD COLUMN port INTEGER NOT NULL DEFAULT 443",
        ),
        (
            "use_tls",
            "ALTER TABLE s3_profiles ADD COLUMN use_tls INTEGER NOT NULL DEFAULT 1",
        ),
        (
            "default_bucket",
            "ALTER TABLE s3_profiles ADD COLUMN default_bucket TEXT",
        ),
        (
            "default_acl",
            "ALTER TABLE s3_profiles ADD COLUMN default_acl TEXT",
        ),
        (
            "tags",
            "ALTER TABLE s3_profiles ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'",
        ),
    ] {
        if !s3_existing.contains(column) {
            connection.execute(ddl, [])?;
        }
    }
    Ok(())
}

/// When a profile is updated without freshly entered secrets, keep the values
/// that were previously stored. The frontend never receives password / key /
/// passphrase material back, so an omitted (None) field means "unchanged"
/// rather than "clear". Switching auth type replaces everything.
fn merge_auth_method(existing: AuthMethod, incoming: AuthMethod) -> AuthMethod {
    match (existing, incoming) {
        (
            AuthMethod::PrivateKey {
                key_data: existing_data,
                key_name: existing_name,
                passphrase_ref: existing_passphrase,
            },
            AuthMethod::PrivateKey {
                key_data,
                key_name,
                passphrase_ref,
            },
        ) => AuthMethod::PrivateKey {
            key_data: key_data.or(existing_data),
            key_name: key_name.or(existing_name),
            passphrase_ref: passphrase_ref.or(existing_passphrase),
        },
        (
            AuthMethod::Password {
                secret_ref: existing_secret,
            },
            AuthMethod::Password { secret_ref },
        ) => AuthMethod::Password {
            secret_ref: secret_ref.or(existing_secret),
        },
        (_, incoming) => incoming,
    }
}

fn serialize_tags(tags: &[String]) -> String {
    serde_json::to_string(tags).unwrap_or_else(|_| "[]".to_string())
}

fn deserialize_tags(value: Option<&str>) -> Vec<String> {
    value
        .and_then(|raw| serde_json::from_str::<Vec<String>>(raw).ok())
        .unwrap_or_default()
}

fn normalize_ai_chat_items(mut items: Vec<Value>) -> Vec<Value> {
    for item in &mut items {
        let Some(object) = item.as_object_mut() else {
            continue;
        };
        let is_pending_tool = object.get("type").and_then(Value::as_str) == Some("tool")
            && matches!(
                object.get("status").and_then(Value::as_str),
                Some("pendingApproval" | "running")
            );
        if is_pending_tool {
            object.insert("status".to_string(), Value::String("error".to_string()));
            object.insert(
                "result".to_string(),
                Value::String("应用关闭前未完成，此操作未执行。".to_string()),
            );
        }
    }
    items
}

fn normalize_tags(tags: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    tags.into_iter()
        .map(|tag| tag.trim().to_string())
        .filter(|tag| !tag.is_empty())
        .filter(|tag| seen.insert(tag.clone()))
        .collect()
}

fn normalize_kubernetes_source(source: KubernetesSource) -> AppResult<KubernetesSource> {
    match source {
        KubernetesSource::Local { kubeconfig_paths } => Ok(KubernetesSource::Local {
            kubeconfig_paths: normalize_kubernetes_paths(kubeconfig_paths)?,
        }),
        KubernetesSource::LocalImported {
            secret_ref,
            display_names,
        } => {
            let secret_ref = secret_ref.trim().to_string();
            if !is_valid_kubernetes_import_ref(&secret_ref) {
                return Err(AppError::new(
                    "validation_error",
                    "Kubernetes 导入配置引用无效，请重新选择文件。",
                ));
            }
            let mut seen = HashSet::new();
            let display_names = display_names
                .into_iter()
                .map(|name| name.trim().to_string())
                .filter(|name| !name.is_empty() && name.len() <= 255)
                .filter(|name| !name.chars().any(char::is_control))
                .filter(|name| seen.insert(name.clone()))
                .collect::<Vec<_>>();
            if display_names.is_empty() {
                return Err(AppError::new(
                    "validation_error",
                    "Kubernetes 导入配置缺少文件显示名称。",
                ));
            }
            Ok(KubernetesSource::LocalImported {
                secret_ref,
                display_names,
            })
        }
        KubernetesSource::RemoteSsh {
            ssh_profile_id,
            kubeconfig_path,
            kubectl_path,
        } => {
            let ssh_profile_id = ssh_profile_id.trim().to_string();
            if ssh_profile_id.is_empty() {
                return Err(AppError::new(
                    "validation_error",
                    "请选择用于 Kubernetes 远端来源的 SSH 连接。",
                ));
            }
            Ok(KubernetesSource::RemoteSsh {
                ssh_profile_id,
                kubeconfig_path: normalize_kubernetes_path(kubeconfig_path)?,
                kubectl_path: normalize_kubernetes_path(kubectl_path)?,
            })
        }
    }
}

fn is_valid_kubernetes_import_ref(value: &str) -> bool {
    value.len() == "kubeconfig-".len() + 32
        && value.starts_with("kubeconfig-")
        && value["kubeconfig-".len()..]
            .chars()
            .all(|character| character.is_ascii_hexdigit())
}

fn normalize_kubernetes_paths(paths: Vec<String>) -> AppResult<Vec<String>> {
    paths
        .into_iter()
        .map(Some)
        .map(normalize_kubernetes_path)
        .collect::<AppResult<Vec<_>>>()
        .map(|paths| paths.into_iter().flatten().collect())
}

fn normalize_kubernetes_path(value: Option<String>) -> AppResult<Option<String>> {
    let Some(value) = normalize_optional(value) else {
        return Ok(None);
    };
    if value.len() > 4096 || value.chars().any(char::is_control) {
        return Err(AppError::new(
            "validation_error",
            "Kubeconfig 或 kubectl 路径格式无效。",
        ));
    }
    Ok(Some(value))
}

fn normalize_kubernetes_contexts(
    contexts: Vec<KubernetesContextSelection>,
) -> AppResult<Vec<KubernetesContextSelection>> {
    let mut seen = HashSet::new();
    let mut normalized = Vec::new();
    for context in contexts {
        let source_id = context.source_id.trim().to_string();
        let name = context.name.trim().to_string();
        if source_id.is_empty() || name.is_empty() || source_id.len() > 4096 || name.len() > 512 {
            return Err(AppError::new(
                "validation_error",
                "Kubernetes context 信息无效。",
            ));
        }
        if source_id.chars().any(char::is_control) || name.chars().any(char::is_control) {
            return Err(AppError::new(
                "validation_error",
                "Kubernetes context 信息无效。",
            ));
        }
        let namespace = normalize_optional(context.namespace);
        if namespace
            .as_ref()
            .is_some_and(|value| value.len() > 253 || value.chars().any(char::is_control))
        {
            return Err(AppError::new(
                "validation_error",
                "Kubernetes namespace 无效。",
            ));
        }
        if seen.insert((source_id.clone(), name.clone())) {
            normalized.push(KubernetesContextSelection {
                source_id,
                name,
                namespace,
                user: normalize_optional(context.user),
            });
        }
    }
    Ok(normalized)
}

fn validate_kubernetes_profile(profile: &KubernetesProfile) -> AppResult<()> {
    if profile.name.trim().is_empty() {
        return Err(AppError::new(
            "validation_error",
            "Kubernetes 连接名称不能为空。",
        ));
    }
    if profile.name.len() > 200 {
        return Err(AppError::new(
            "validation_error",
            "Kubernetes 连接名称过长。",
        ));
    }
    Ok(())
}

fn serialize_kubernetes_source(source: &KubernetesSource) -> String {
    serde_json::to_string(source).expect("Kubernetes source is serializable")
}

fn serialize_kubernetes_contexts(contexts: &[KubernetesContextSelection]) -> String {
    serde_json::to_string(contexts).expect("Kubernetes contexts are serializable")
}

fn normalize_proxy(proxy: Option<SshProxy>) -> AppResult<Option<SshProxy>> {
    let Some(mut proxy) = proxy else {
        return Ok(None);
    };
    proxy.proxy_type = proxy.proxy_type.trim().to_ascii_lowercase();
    proxy.host = proxy.host.trim().to_string();
    proxy.username = normalize_optional(proxy.username);
    proxy.password = normalize_optional(proxy.password);
    if !matches!(proxy.proxy_type.as_str(), "socks5" | "http") {
        return Err(AppError::new(
            "validation_error",
            "代理类型必须为 SOCKS5 或 HTTP。",
        ));
    }
    if proxy.host.is_empty() || proxy.port == 0 {
        return Err(AppError::new(
            "validation_error",
            "请输入有效的代理主机和端口。",
        ));
    }
    Ok(Some(proxy))
}

fn merge_proxy(
    existing: Option<SshProxy>,
    incoming: Option<SshProxy>,
) -> AppResult<Option<SshProxy>> {
    match (existing, incoming) {
        (_, None) => Ok(None),
        (Some(existing), Some(incoming)) if incoming.password.is_none() => {
            normalize_proxy(Some(SshProxy {
                password: existing.password,
                ..incoming
            }))
        }
        (_, Some(incoming)) => normalize_proxy(Some(incoming)),
    }
}

fn normalize_s3_acl(value: Option<String>) -> AppResult<Option<String>> {
    let value = normalize_optional(value);
    if let Some(acl) = value.as_deref()
        && !matches!(
            acl,
            "private" | "public-read" | "public-read-write" | "authenticated-read"
        )
    {
        return Err(AppError::new(
            "validation_error",
            format!("Unsupported default S3 ACL: {acl}"),
        ));
    }
    Ok(value)
}

fn normalize_s3_host(value: &str) -> AppResult<String> {
    let host = value
        .trim()
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_end_matches('/')
        .to_string();
    if host.is_empty() || host.contains('/') || host.contains(':') {
        return Err(AppError::new(
            "validation_error",
            "S3 主机名应只包含主机地址，不要包含协议、端口或路径。",
        ));
    }
    Ok(host)
}

fn build_s3_endpoint(host: &str, port: u16, use_tls: bool) -> AppResult<Option<String>> {
    let host = normalize_s3_host(host)?;
    let scheme = if use_tls { "https" } else { "http" };
    Ok(Some(format!("{scheme}://{host}:{port}")))
}

fn host_from_endpoint(endpoint: Option<&str>) -> String {
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

fn port_from_endpoint(endpoint: Option<&str>) -> u16 {
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
        .unwrap_or_else(|| if endpoint_uses_tls(endpoint) { 443 } else { 80 })
}

fn endpoint_uses_tls(endpoint: Option<&str>) -> bool {
    !endpoint.is_some_and(|value| value.trim_start().starts_with("http://"))
}

fn validate_profile(profile: &SshProfile) -> AppResult<()> {
    if profile.name.trim().is_empty() {
        return Err(AppError::new("validation_error", "Name is required."));
    }

    if profile.host.trim().is_empty() {
        return Err(AppError::new("validation_error", "Host is required."));
    }

    if profile.username.trim().is_empty() {
        return Err(AppError::new("validation_error", "Username is required."));
    }

    Ok(())
}

fn validate_s3_request(
    name: &str,
    host: &str,
    port: u16,
    access_key_id: &str,
    secret_access_key: Option<&str>,
) -> AppResult<()> {
    if name.trim().is_empty() {
        return Err(AppError::new("validation_error", "Name is required."));
    }
    if host.trim().is_empty() {
        return Err(AppError::new("validation_error", "S3 host is required."));
    }
    if port == 0 {
        return Err(AppError::new(
            "validation_error",
            "S3 port must be between 1 and 65535.",
        ));
    }
    if access_key_id.trim().is_empty() {
        return Err(AppError::new(
            "validation_error",
            "Access key ID is required.",
        ));
    }
    if secret_access_key.is_some_and(|secret| secret.trim().is_empty()) {
        return Err(AppError::new(
            "validation_error",
            "Secret access key is required.",
        ));
    }
    Ok(())
}

fn set_secret_on(connection: &Connection, key: &str, value: &str) -> AppResult<()> {
    connection.execute(
        "INSERT INTO app_secrets (key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = ?3",
        params![key, value, timestamp()],
    )?;
    Ok(())
}

fn normalize_optional(value: Option<String>) -> Option<String> {
    value.and_then(|item| {
        let trimmed = item.trim().to_string();
        (!trimmed.is_empty()).then_some(trimmed)
    })
}

fn truncate_audit_value(value: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value.to_string();
    }
    let mut end = max_bytes;
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }
    value[..end].to_string()
}

fn timestamp() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    millis.to_string()
}

fn create_id() -> String {
    create_id_with_prefix("profile")
}

fn create_id_with_prefix(prefix: &str) -> String {
    format!("{prefix}-{}", timestamp())
}

fn bool_to_i64(value: bool) -> i64 {
    if value { 1 } else { 0 }
}

struct AuthFields {
    auth_type: &'static str,
    secret_ref: Option<String>,
    key_path: Option<String>,
    key_data: Option<String>,
    key_name: Option<String>,
    passphrase_ref: Option<String>,
}

struct ProxyFields {
    proxy_type: Option<String>,
    host: Option<String>,
    port: Option<u16>,
    username: Option<String>,
    password: Option<String>,
}

impl From<Option<&SshProxy>> for ProxyFields {
    fn from(proxy: Option<&SshProxy>) -> Self {
        Self {
            proxy_type: proxy.map(|item| item.proxy_type.clone()),
            host: proxy.map(|item| item.host.clone()),
            port: proxy.map(|item| item.port),
            username: proxy.and_then(|item| item.username.clone()),
            password: proxy.and_then(|item| item.password.clone()),
        }
    }
}

impl From<&AuthMethod> for AuthFields {
    fn from(auth_method: &AuthMethod) -> Self {
        match auth_method {
            AuthMethod::Password { secret_ref } => Self {
                auth_type: "password",
                secret_ref: secret_ref.clone(),
                key_path: None,
                key_data: None,
                key_name: None,
                passphrase_ref: None,
            },
            AuthMethod::PrivateKey {
                key_data,
                key_name,
                passphrase_ref,
            } => Self {
                auth_type: "privateKey",
                secret_ref: None,
                key_path: None,
                key_data: key_data.clone(),
                key_name: key_name.clone(),
                passphrase_ref: passphrase_ref.clone(),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kubernetes_import_metadata_reuses_and_removes_fingerprint() {
        let directory = std::env::temp_dir().join(format!("dssh-kube-import-test-{}", timestamp()));
        let repository = ProfileRepository::initialize(&directory, "test.sqlite3").unwrap();
        repository
            .register_kubernetes_import(
                "kubeconfig-0123456789abcdef0123456789abcdef",
                "fingerprint",
            )
            .unwrap();
        assert_eq!(
            repository
                .kubernetes_import_by_fingerprint("fingerprint")
                .unwrap()
                .as_deref(),
            Some("kubeconfig-0123456789abcdef0123456789abcdef")
        );
        repository
            .delete_kubernetes_import("kubeconfig-0123456789abcdef0123456789abcdef")
            .unwrap();
        assert!(
            repository
                .kubernetes_import_by_fingerprint("fingerprint")
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn s3_profile_crud_keeps_secrets_out_of_profile_rows() {
        let directory = std::env::temp_dir().join(format!("dssh-s3-test-{}", timestamp()));
        let repository = ProfileRepository::initialize(&directory, "test.sqlite3").unwrap();
        let created = repository
            .create_s3_profile(CreateS3ProfileRequest {
                name: "MinIO".to_string(),
                host: "localhost".to_string(),
                port: 9000,
                use_tls: false,
                access_key_id: "access".to_string(),
                secret_access_key: "secret".to_string(),
                session_token: Some("token".to_string()),
                force_path_style: true,
                default_bucket: Some("backups".to_string()),
                default_acl: Some("private".to_string()),
                favorite: false,
                description: None,
                tags: vec!["test".to_string()],
            })
            .unwrap();

        assert_eq!(created.host, "localhost");
        assert_eq!(created.port, 9000);
        assert!(!created.use_tls);
        assert_eq!(created.endpoint.as_deref(), Some("http://localhost:9000"));
        assert_eq!(created.default_bucket.as_deref(), Some("backups"));
        assert_eq!(created.default_acl.as_deref(), Some("private"));
        assert_eq!(created.tags, vec!["test"]);
        let credentials = repository.s3_credentials(&created.id).unwrap();
        assert_eq!(credentials.secret_access_key, "secret");
        assert_eq!(credentials.session_token.as_deref(), Some("token"));

        repository
            .update_s3_profile(UpdateS3ProfileRequest {
                id: created.id.clone(),
                name: "MinIO updated".to_string(),
                host: created.host.clone(),
                port: created.port,
                use_tls: created.use_tls,
                access_key_id: created.access_key_id.clone(),
                secret_access_key: None,
                session_token: None,
                force_path_style: true,
                default_bucket: created.default_bucket.clone(),
                default_acl: created.default_acl.clone(),
                favorite: true,
                description: Some("updated".to_string()),
                tags: vec!["test".to_string(), "updated".to_string()],
            })
            .unwrap();
        let preserved = repository.s3_credentials(&created.id).unwrap();
        assert_eq!(preserved.secret_access_key, "secret");
        assert_eq!(preserved.session_token.as_deref(), Some("token"));

        repository.delete_s3_profile(&created.id).unwrap();
        assert!(repository.get_s3_profile(&created.id).unwrap().is_none());
        assert!(
            repository
                .get_secret(&format!("s3:{}:secret-access-key", created.id))
                .unwrap()
                .is_none()
        );
        let _ = std::fs::remove_dir_all(directory);
    }

    #[test]
    fn s3_profile_rejects_unsupported_default_acl() {
        let directory = std::env::temp_dir().join(format!("dssh-s3-acl-test-{}", timestamp()));
        let repository = ProfileRepository::initialize(&directory, "test.sqlite3").unwrap();
        let result = repository.create_s3_profile(CreateS3ProfileRequest {
            name: "Invalid".to_string(),
            host: "s3.amazonaws.com".to_string(),
            port: 443,
            use_tls: true,
            access_key_id: "access".to_string(),
            secret_access_key: "secret".to_string(),
            session_token: None,
            force_path_style: false,
            default_bucket: None,
            default_acl: Some("not-an-acl".to_string()),
            favorite: false,
            description: None,
            tags: Vec::new(),
        });
        assert!(result.is_err());
        let _ = std::fs::remove_dir_all(directory);
    }

    #[test]
    fn ai_chat_history_persists_and_marks_interrupted_tools_as_errors() {
        let directory = std::env::temp_dir().join(format!("dssh-ai-history-test-{}", timestamp()));
        let repository = ProfileRepository::initialize(&directory, "test.sqlite3").unwrap();
        repository
            .save_ai_chat_history(vec![
                serde_json::json!({ "id": "user-1", "type": "user", "text": "连接服务器" }),
                serde_json::json!({
                    "id": "tool-1",
                    "type": "tool",
                    "callId": "call-1",
                    "toolName": "open_ssh_session",
                    "args": { "server_id": "profile-1" },
                    "status": "running",
                    "result": null,
                }),
            ])
            .unwrap();

        let history = repository.load_ai_chat_history().unwrap();
        assert_eq!(history.len(), 2);
        assert_eq!(history[1]["status"], "error");
        assert_eq!(history[1]["result"], "应用关闭前未完成，此操作未执行。");

        repository.clear_ai_chat_history().unwrap();
        assert!(repository.load_ai_chat_history().unwrap().is_empty());
        let _ = std::fs::remove_dir_all(directory);
    }
}
