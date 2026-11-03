use super::ProfileRepository;
use crate::{
    error::{AppError, AppResult},
    models::connection_folder::normalize_folder,
};
use rusqlite::params;
use serde_json::Value;

fn within(path: &str, parent: &str) -> bool {
    path == parent
        || path
            .strip_prefix(parent)
            .is_some_and(|suffix| suffix.starts_with('/'))
}

struct FolderRecord {
    table: &'static str,
    id: String,
    folder: String,
    json: Option<Value>,
}

impl ProfileRepository {
    /// Metadata-only subtree rename across all connection protocols in one transaction.
    /// Credential references and live session identities are never changed.
    pub fn rename_connection_folder(&self, old_path: &str, new_name: &str) -> AppResult<()> {
        let old_path = normalize_folder(old_path)?;
        let new_name = new_name.trim();
        if old_path.is_empty() || new_name.is_empty() || new_name.contains(['/', '\\']) {
            return Err(AppError::new(
                "invalid_folder",
                "请输入单层目录名称，不能包含 / 或 \\。",
            ));
        }
        let leaf = normalize_folder(new_name)?;
        let target = match old_path.rsplit_once('/') {
            Some((parent, _)) => format!("{parent}/{leaf}"),
            None => leaf,
        };
        normalize_folder(&target)?;
        if target == old_path {
            return Ok(());
        }
        let mut connection = self.connection()?;
        let tx = connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let mut records = Vec::new();
        {
            let mut statement = tx.prepare("SELECT id, folder FROM ssh_profiles")?;
            for row in statement.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })? {
                let (id, folder) = row?;
                records.push(FolderRecord {
                    table: "ssh_profiles",
                    id,
                    folder,
                    json: None,
                });
            }
        }
        for table in ["rdp_profiles", "jumpserver_profiles"] {
            let mut statement = tx.prepare(&format!("SELECT id, profile_json FROM {table}"))?;
            for row in statement.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })? {
                let (id, json) = row?;
                let json: Value = serde_json::from_str(&json).map_err(|_| {
                    AppError::new("storage_error", "连接配置格式无效，未修改目录。")
                })?;
                let folder = match json.get("folder") {
                    None => String::new(),
                    Some(Value::String(path)) => path.clone(),
                    _ => {
                        return Err(AppError::new(
                            "storage_error",
                            "连接目录格式无效，未修改目录。",
                        ));
                    }
                };
                records.push(FolderRecord {
                    table,
                    id,
                    folder,
                    json: Some(json),
                });
            }
        }
        if !records
            .iter()
            .any(|record| within(&record.folder, &old_path))
        {
            return Err(AppError::new(
                "folder_missing",
                "目录已不存在，请刷新后重试。",
            ));
        }
        if records.iter().any(|record| within(&record.folder, &target)) {
            return Err(AppError::new(
                "folder_exists",
                "同级目录已存在，请使用其他名称。",
            ));
        }
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
            .to_string();
        for record in records {
            if !within(&record.folder, &old_path) {
                continue;
            }
            let folder = format!("{target}{}", &record.folder[old_path.len()..]);
            normalize_folder(&folder)?;
            if let Some(mut json) = record.json {
                json["folder"] = Value::String(folder);
                if json.get("updatedAt").is_some() {
                    json["updatedAt"] = Value::String(now.clone());
                }
                tx.execute(
                    &format!(
                        "UPDATE {} SET profile_json = ?1 WHERE id = ?2",
                        record.table
                    ),
                    params![json.to_string(), record.id],
                )?;
            } else {
                tx.execute(
                    "UPDATE ssh_profiles SET folder = ?1, updated_at = ?2 WHERE id = ?3",
                    params![folder, now, record.id],
                )?;
            }
        }
        tx.commit()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{jumpserver::JumpServerProfile, rdp::RdpProfile};
    use serde_json::json;

    #[test]
    fn subtree_rename_is_atomic_across_protocols_and_preserves_other_metadata() {
        let dir = std::env::temp_dir().join(format!(
            "dssh-folder-rename-{:032x}",
            rand::random::<u128>()
        ));
        let repo = ProfileRepository::initialize(&dir, "test.db").unwrap();
        let ssh = repo.create_profile(serde_json::from_value(json!({"name":"SSH", "host":"example.test", "port":22, "username":"user",
            "authMethod":{"type":"password"}, "favorite":false, "tags":["production"], "folder":"a/b/c"})).unwrap()).unwrap();
        let rdp: RdpProfile = serde_json::from_value(json!({"id":"rdp-test", "name":"Desktop", "folder":"a/b", "host":"pc.test", "port":3389,
            "username":"user", "domain":"", "certificateFingerprint":"", "width":1920, "height":1080, "favorite":false,
            "tags":[], "description":"", "hasPassword":true, "createdAt":"1", "updatedAt":"1"})).unwrap();
        repo.save_rdp_profile(&rdp, Some("opaque-test-reference"))
            .unwrap();
        let jms: JumpServerProfile = serde_json::from_value(json!({"id":"jms-test", "name":"Platform", "folder":"a/b/gateways", "coreUrl":"https://jms.test/",
            "orgId":"org-a", "authKind":"password", "username":"alice", "hasCredential":true})).unwrap();
        repo.save_jumpserver_profile(&jms, Some("opaque-test-reference"))
            .unwrap();
        let sibling = JumpServerProfile {
            id: "sibling".into(),
            folder: "a/bb".into(),
            ..jms.clone()
        };
        repo.save_jumpserver_profile(&sibling, None).unwrap();
        let before = serde_json::to_value(repo.get_profile(&ssh.id).unwrap().unwrap()).unwrap();
        for name in [
            "",
            " ",
            "bad/name",
            "bad\\name",
            ".",
            "..",
            "bad\nname",
            "bb",
        ] {
            assert!(repo.rename_connection_folder("a/b", name).is_err());
        }
        let connection = repo.connection().unwrap();
        connection.execute_batch("CREATE TRIGGER reject_folder_update BEFORE UPDATE OF profile_json ON rdp_profiles BEGIN SELECT RAISE(ABORT, 'test failure'); END;").unwrap();
        assert!(repo.rename_connection_folder("a/b", "renamed").is_err());
        assert_eq!(
            serde_json::to_value(repo.get_profile(&ssh.id).unwrap().unwrap()).unwrap(),
            before
        );
        assert_eq!(
            repo.get_jumpserver_profile(&jms.id).unwrap().0.folder,
            jms.folder
        );
        connection
            .execute_batch("DROP TRIGGER reject_folder_update")
            .unwrap();
        repo.rename_connection_folder("a/b", " renamed ").unwrap();
        let mut expected = before;
        let saved = repo.get_profile(&ssh.id).unwrap().unwrap();
        expected["folder"] = json!("a/renamed/c");
        expected["updatedAt"] = json!(saved.updated_at);
        assert_eq!(serde_json::to_value(&saved).unwrap(), expected);
        let stored_rdp = repo.get_rdp_profile(&rdp.id).unwrap().unwrap();
        assert_eq!(stored_rdp.profile.folder, "a/renamed");
        assert_eq!(
            stored_rdp.secret_ref.as_deref(),
            Some("opaque-test-reference")
        );
        let (stored_jms, reference) = repo.get_jumpserver_profile(&jms.id).unwrap();
        assert_eq!(stored_jms.folder, "a/renamed/gateways");
        assert_eq!(reference.as_deref(), Some("opaque-test-reference"));
        assert_eq!(
            repo.get_jumpserver_profile("sibling").unwrap().0.folder,
            "a/bb"
        );
        repo.rename_connection_folder("a/renamed", "renamed")
            .unwrap();
        assert!(repo.rename_connection_folder("a/b", "missing").is_err());
        repo.rename_connection_folder("a", "root").unwrap();
        assert_eq!(
            repo.get_profile(&ssh.id).unwrap().unwrap().folder,
            "root/renamed/c"
        );
        assert_eq!(
            repo.get_jumpserver_profile("sibling").unwrap().0.folder,
            "root/bb"
        );
        drop(connection);
        let _ = std::fs::remove_dir_all(dir);
    }
}
