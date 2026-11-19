use std::path::Path;

use rusqlite::{Connection, OptionalExtension, Row, TransactionBehavior, params};

use crate::{
    error::{AppError, AppResult},
    models::ssh_profile::{AuthMethod, SaveSshCredentialRequest, SshCredential},
};

use super::profile_repository::{AuthFields, ProfileRepository, merge_auth_method};

const CREDENTIAL_QUERY: &str =
    "SELECT c.id, c.name, c.username, c.auth_type, c.secret_ref, c.key_data, c.key_name,
            c.passphrase_ref, (SELECT COUNT(*) FROM ssh_profiles WHERE credential_id = c.id)
     FROM ssh_credentials c";

impl ProfileRepository {
    pub fn list_ssh_credentials(&self) -> AppResult<Vec<SshCredential>> {
        list_credentials(&self.connection()?)
    }

    pub fn save_ssh_credential(
        &self,
        id: Option<&str>,
        request: SaveSshCredentialRequest,
    ) -> AppResult<SshCredential> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let credential = save_credential(&transaction, id, request)?;
        transaction.commit()?;
        Ok(credential)
    }

    pub fn delete_ssh_credential(&self, id: &str) -> AppResult<()> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let used: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM ssh_profiles WHERE credential_id = ?1)",
            [id],
            |row| row.get(0),
        )?;
        if used {
            return Err(AppError::new(
                "credential_in_use",
                "此凭据仍被连接使用。请先在这些连接中更换认证来源。",
            ));
        }
        transaction.execute("DELETE FROM ssh_credentials WHERE id = ?1", [id])?;
        transaction.commit()?;
        Ok(())
    }
}

pub(super) fn list_credentials(connection: &Connection) -> AppResult<Vec<SshCredential>> {
    let mut statement = connection.prepare(&format!(
        "{CREDENTIAL_QUERY} ORDER BY c.name COLLATE NOCASE, c.id"
    ))?;
    Ok(statement
        .query_map([], map_credential)?
        .collect::<Result<_, _>>()?)
}

pub(super) fn get_credential(connection: &Connection, id: &str) -> AppResult<SshCredential> {
    connection
        .query_row(
            &format!("{CREDENTIAL_QUERY} WHERE c.id = ?1"),
            [id],
            map_credential,
        )
        .optional()?
        .ok_or_else(|| AppError::new("credential_not_found", "此 SSH 凭据已删除，请重新选择。"))
}

fn map_credential(row: &Row<'_>) -> rusqlite::Result<SshCredential> {
    Ok(SshCredential {
        id: row.get(0)?,
        name: row.get(1)?,
        username: row.get(2)?,
        auth_method: auth_from_columns(
            row.get::<_, String>(3)?.as_str(),
            row.get(4)?,
            row.get(5)?,
            row.get(6)?,
            row.get(7)?,
        ),
        connection_count: row.get(8)?,
    })
}

pub(super) fn auth_from_columns(
    kind: &str,
    secret_ref: Option<String>,
    key_data: Option<String>,
    key_name: Option<String>,
    passphrase_ref: Option<String>,
) -> AuthMethod {
    match kind {
        "password" => AuthMethod::Password { secret_ref },
        "privateKey" => AuthMethod::PrivateKey {
            key_data,
            key_name,
            passphrase_ref,
        },
        _ => AuthMethod::Password { secret_ref: None },
    }
}

pub(super) fn load_key_file(mut auth: AuthMethod, path: Option<&str>) -> AppResult<AuthMethod> {
    if let Some(path) = path {
        let AuthMethod::PrivateKey {
            key_data, key_name, ..
        } = &mut auth
        else {
            return Err(AppError::new("validation_error", "请先选择密钥认证。"));
        };
        let contents = std::fs::read_to_string(path)
            .map_err(|_| AppError::new("key_read_error", "无法读取密钥文件，请重新选择。"))?;
        if contents.trim().is_empty() {
            return Err(AppError::new("key_read_error", "密钥文件为空。"));
        }
        *key_data = Some(contents);
        *key_name = Path::new(path)
            .file_name()
            .map(|name| name.to_string_lossy().into_owned());
    }
    Ok(auth)
}

pub(super) fn save_credential(
    connection: &Connection,
    id: Option<&str>,
    request: SaveSshCredentialRequest,
) -> AppResult<SshCredential> {
    let name = request.name.trim();
    let username = request.username.trim();
    if name.is_empty() || username.is_empty() {
        return Err(AppError::new(
            "validation_error",
            "请输入凭据名称和用户名。",
        ));
    }

    let mut auth = load_key_file(request.auth_method, request.key_file_path.as_deref())?;
    let existing = id.map(|id| get_credential(connection, id)).transpose()?;
    if let Some(existing) = existing {
        auth = merge_auth_method(existing.auth_method, auth, false);
    }
    match &mut auth {
        AuthMethod::Password { secret_ref }
            if secret_ref.as_ref().is_none_or(|value| value.is_empty()) =>
        {
            return Err(AppError::new("validation_error", "请输入密码。"));
        }
        AuthMethod::PrivateKey {
            key_data,
            passphrase_ref,
            ..
        } => {
            if key_data
                .as_ref()
                .is_none_or(|value| value.trim().is_empty())
            {
                return Err(AppError::new("validation_error", "请选择密钥文件。"));
            }
            if request.clear_passphrase {
                *passphrase_ref = None;
            }
        }
        _ => {}
    }

    let id = id
        .map(str::to_owned)
        .unwrap_or_else(|| format!("ssh-credential:{:032x}", rand::random::<u128>()));
    let fields = AuthFields::from(&auth);
    connection.execute(
        "INSERT INTO ssh_credentials (id, name, username, auth_type, secret_ref, key_data, key_name, passphrase_ref)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, username = excluded.username,
            auth_type = excluded.auth_type, secret_ref = excluded.secret_ref,
            key_data = excluded.key_data, key_name = excluded.key_name,
            passphrase_ref = excluded.passphrase_ref, revision = ssh_credentials.revision + 1",
        params![id, name, username, fields.auth_type, fields.secret_ref, fields.key_data, fields.key_name, fields.passphrase_ref],
    )?;
    get_credential(connection, &id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        models::ssh_profile::{CreateSshProfileRequest, UpdateSshProfileRequest},
        ssh::connection_pool::ConnectionKey,
    };
    use serde_json::{Value, json};

    fn credential(username: &str) -> SaveSshCredentialRequest {
        SaveSshCredentialRequest {
            name: "Team".into(),
            username: username.into(),
            auth_method: AuthMethod::Password {
                secret_ref: Some(format!("fixture-{:032x}", rand::random::<u128>())),
            },
            key_file_path: None,
            clear_passphrase: false,
        }
    }

    fn profile(name: &str) -> Value {
        json!({"name": name, "host": "host.example.test", "port": 22, "favorite": false})
    }

    #[test]
    fn shared_credentials_rotate_without_rewriting_connections_or_exposing_secrets() {
        let directory =
            std::env::temp_dir().join(format!("dssh-credential-{:032x}", rand::random::<u128>()));
        let repo = ProfileRepository::initialize(&directory, "test.db").unwrap();
        let saved = repo
            .save_ssh_credential(None, credential("deploy"))
            .unwrap();
        let mut request = profile("First");
        request["credentialId"] = json!(&saved.id);
        let first = repo
            .create_profile(serde_json::from_value(request.clone()).unwrap())
            .unwrap();
        request["name"] = json!("Second");
        request["connectionType"] = json!("sftp");
        let second = repo
            .clone_profile(&first.id, serde_json::from_value(request.clone()).unwrap())
            .unwrap();
        assert_eq!(repo.list_ssh_credentials().unwrap()[0].connection_count, 2);
        assert_eq!(
            repo.delete_ssh_credential(&saved.id).unwrap_err().code,
            "credential_in_use"
        );
        assert_eq!(first.username, "deploy");
        assert_eq!(second.credential_id, first.credential_id);

        // A password-only rotation still changes the non-secret pool key.
        repo.save_ssh_credential(Some(&saved.id), credential("deploy"))
            .unwrap();
        let rotated = repo.get_profile(&first.id).unwrap().unwrap();
        assert!(ConnectionKey::from_profile(&first) != ConnectionKey::from_profile(&rotated));
        assert_eq!(first.updated_at, rotated.updated_at);
        assert!(
            serde_json::to_value(&rotated).unwrap()["authMethod"]
                .get("secretRef")
                .is_none()
        );
        assert!(
            serde_json::to_value(&saved).unwrap()["authMethod"]
                .get("secretRef")
                .is_none()
        );

        repo.save_ssh_credential(Some(&saved.id), credential("operator"))
            .unwrap();
        assert!(
            repo.list_profiles()
                .unwrap()
                .iter()
                .all(|p| p.username == "operator")
        );
        let owns_secret: bool = repo.connection().unwrap().query_row(
            "SELECT EXISTS(SELECT 1 FROM ssh_profiles WHERE secret_ref IS NOT NULL OR key_data IS NOT NULL)",
            [], |row| row.get(0),
        ).unwrap();
        assert!(!owns_secret);

        request["id"] = json!(&second.id);
        request["credentialId"] = Value::Null;
        request["username"] = json!("local-account");
        request["authMethod"] = json!({"type": "password"});
        let detached: UpdateSshProfileRequest = serde_json::from_value(request.clone()).unwrap();
        assert!(repo.update_profile(detached).is_err());
        request["authMethod"]["secretRef"] =
            json!(format!("fixture-{:032x}", rand::random::<u128>()));
        let detached = repo
            .update_profile(serde_json::from_value(request).unwrap())
            .unwrap();
        assert_eq!(detached.username, "local-account");
        assert!(detached.credential_id.is_none());
        repo.delete_profile(&first.id).unwrap();
        repo.delete_ssh_credential(&saved.id).unwrap();
        assert!(repo.get_profile(&second.id).unwrap().is_some());
        let _ = std::fs::remove_dir_all(directory);
    }

    #[test]
    fn private_key_files_are_loaded_in_rust_and_passphrases_can_be_cleared() {
        let directory = std::env::temp_dir().join(format!(
            "dssh-key-credential-{:032x}",
            rand::random::<u128>()
        ));
        let repo = ProfileRepository::initialize(&directory, "test.db").unwrap();
        let path = directory.join("fixture.key");
        let marker = format!("fixture-{:032x}", rand::random::<u128>());
        std::fs::write(&path, &marker).unwrap();
        let mut request = SaveSshCredentialRequest {
            name: "Key".into(),
            username: "deploy".into(),
            auth_method: AuthMethod::PrivateKey {
                key_data: None,
                key_name: None,
                passphrase_ref: Some(format!("fixture-{:032x}", rand::random::<u128>())),
            },
            key_file_path: Some(path.to_string_lossy().into_owned()),
            clear_passphrase: false,
        };
        let saved = repo.save_ssh_credential(None, request.clone()).unwrap();
        let payload = serde_json::to_value(&saved).unwrap();
        assert_eq!(payload["authMethod"]["keyName"], "fixture.key");
        assert!(payload["authMethod"].get("keyData").is_none());
        assert!(payload["authMethod"].get("passphraseRef").is_none());
        std::fs::remove_file(&path).unwrap();
        let mut profile_request = profile("Files");
        profile_request["credentialId"] = json!(&saved.id);
        let linked = repo
            .create_profile(serde_json::from_value(profile_request).unwrap())
            .unwrap();
        assert!(matches!(linked.auth_method, AuthMethod::PrivateKey {
            key_data: Some(key), passphrase_ref: Some(_), ..
        } if key == marker));

        request.key_file_path = None;
        request.auth_method = AuthMethod::PrivateKey {
            key_data: None,
            key_name: None,
            passphrase_ref: None,
        };
        request.clear_passphrase = true;
        repo.save_ssh_credential(Some(&saved.id), request).unwrap();
        let updated = repo.get_profile(&linked.id).unwrap().unwrap();
        assert!(matches!(updated.auth_method, AuthMethod::PrivateKey {
            key_data: Some(key), passphrase_ref: None, ..
        } if key == marker));
        let _ = std::fs::remove_dir_all(directory);
    }

    #[test]
    fn inline_credentials_and_backup_import_commit_only_with_valid_profiles() {
        let directory = std::env::temp_dir().join(format!(
            "dssh-credential-import-{:032x}",
            rand::random::<u128>()
        ));
        let repo = ProfileRepository::initialize(&directory, "test.db").unwrap();
        let mut request = profile("Inline");
        request["newCredential"] = json!({
            "name": "Inline credential", "username": "operator",
            "authMethod": {"type": "password", "secretRef": format!("fixture-{:032x}", rand::random::<u128>())}
        });
        request["host"] = json!("");
        assert!(
            repo.create_profile(serde_json::from_value(request.clone()).unwrap())
                .is_err()
        );
        assert!(repo.list_ssh_credentials().unwrap().is_empty());

        request["host"] = json!("host.example.test");
        let saved = repo
            .create_profile(serde_json::from_value(request).unwrap())
            .unwrap();
        assert!(saved.credential_id.is_some());
        assert_eq!(repo.list_ssh_credentials().unwrap()[0].connection_count, 1);

        let mut imported = profile("Imported");
        imported["credentialId"] = json!("old-id");
        let imported: CreateSshProfileRequest = serde_json::from_value(imported).unwrap();
        assert!(
            repo.import_ssh_profiles(
                vec![("other-id".into(), credential("deploy"))],
                vec![imported.clone()],
            )
            .is_err()
        );
        assert_eq!(repo.list_ssh_credentials().unwrap().len(), 1);
        let restored = repo
            .import_ssh_profiles(
                vec![("old-id".into(), credential("deploy"))],
                vec![imported.clone(), imported],
            )
            .unwrap();
        assert_eq!(restored[0].credential_id, restored[1].credential_id);
        assert_ne!(restored[0].credential_id.as_deref(), Some("old-id"));
        assert_eq!(restored[0].username, "deploy");

        let reopened = ProfileRepository::initialize(&directory, "test.db").unwrap();
        assert_eq!(reopened.list_ssh_credentials().unwrap().len(), 2);
        assert_eq!(reopened.list_profiles().unwrap().len(), 3);
        let _ = std::fs::remove_dir_all(directory);
    }
}
