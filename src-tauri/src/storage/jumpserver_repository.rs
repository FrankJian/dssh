use super::ProfileRepository;
use crate::{
    error::{AppError, AppResult},
    models::jumpserver::JumpServerProfile,
};
use rusqlite::{OptionalExtension, params};

impl ProfileRepository {
    pub fn list_jumpserver_profiles(&self) -> AppResult<Vec<JumpServerProfile>> {
        let conn = self.connection()?;
        let mut stmt =
            conn.prepare("SELECT profile_json, secret_ref FROM jumpserver_profiles ORDER BY id")?;
        let rows = stmt.query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
        })?;
        rows.map(|row| {
            let (json, reference) = row?;
            let mut profile: JumpServerProfile =
                serde_json::from_str(&json).map_err(|_| storage_error())?;
            profile.has_credential = reference.is_some();
            Ok(profile)
        })
        .collect()
    }

    pub fn get_jumpserver_profile(
        &self,
        id: &str,
    ) -> AppResult<(JumpServerProfile, Option<String>)> {
        let row = self
            .connection()?
            .query_row(
                "SELECT profile_json, secret_ref FROM jumpserver_profiles WHERE id = ?1",
                [id],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?)),
            )
            .optional()?
            .ok_or_else(|| AppError::new("jumpserver_missing", "JumpServer 配置已不存在。"))?;
        let mut profile: JumpServerProfile =
            serde_json::from_str(&row.0).map_err(|_| storage_error())?;
        profile.has_credential = row.1.is_some();
        Ok((profile, row.1))
    }

    pub fn save_jumpserver_profile(
        &self,
        profile: &JumpServerProfile,
        reference: Option<&str>,
    ) -> AppResult<()> {
        self.connection()?.execute(
            "INSERT INTO jumpserver_profiles(id, profile_json, secret_ref) VALUES (?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET profile_json=excluded.profile_json, secret_ref=excluded.secret_ref",
            params![profile.id, serde_json::to_string(profile).map_err(|_| storage_error())?, reference],
        )?;
        Ok(())
    }

    pub fn delete_jumpserver_profile(&self, id: &str) -> AppResult<()> {
        self.connection()?
            .execute("DELETE FROM jumpserver_profiles WHERE id=?1", [id])?;
        Ok(())
    }
}
fn storage_error() -> AppError {
    AppError::new("jumpserver_storage", "JumpServer 配置格式无效。")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn migration_preserves_existing_database_and_never_serializes_secret_reference() {
        let dir = std::env::temp_dir().join(format!(
            "dssh-jumpserver-test-{:032x}",
            rand::random::<u128>()
        ));
        let repo = ProfileRepository::initialize(&dir, "test.db").unwrap();
        let profile = JumpServerProfile {
            id: "jumpserver:test".into(),
            name: "Example".into(),
            core_url: "https://example.invalid/".into(),
            key_id: "test-key".into(),
            auth_kind: crate::models::jumpserver::JumpServerAuthKind::AccessKey,
            username: String::new(),
            ssh_profile_id: None,
            org_id: "org-a".into(),
            has_credential: false,
        };
        repo.save_jumpserver_profile(&profile, Some("opaque-keychain-reference"))
            .unwrap();
        let repo = ProfileRepository::initialize(&dir, "test.db").unwrap();
        assert!(repo.list_profiles().unwrap().is_empty());
        let listed = repo.list_jumpserver_profiles().unwrap();
        assert!(listed[0].has_credential);
        let public = serde_json::to_string(&listed).unwrap();
        assert!(!public.contains("opaque-keychain-reference"));
        assert_eq!(
            repo.get_jumpserver_profile(&profile.id)
                .unwrap()
                .1
                .as_deref(),
            Some("opaque-keychain-reference")
        );
        repo.delete_jumpserver_profile(&profile.id).unwrap();
        assert!(repo.list_jumpserver_profiles().unwrap().is_empty());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
