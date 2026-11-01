use super::ProfileRepository;
use crate::{
    error::{AppError, AppResult},
    models::rdp::RdpProfile,
};
use rusqlite::{OptionalExtension, params};

pub struct StoredRdpProfile {
    pub profile: RdpProfile,
    pub secret_ref: Option<String>,
}

impl ProfileRepository {
    pub fn list_rdp_profiles(&self) -> AppResult<Vec<RdpProfile>> {
        let connection = self.connection()?;
        let mut statement =
            connection.prepare("SELECT profile_json, secret_ref FROM rdp_profiles")?;
        let rows = statement.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
        })?;
        let mut profiles = vec![];
        for row in rows {
            let (json, secret_ref) = row?;
            let mut profile: RdpProfile = serde_json::from_str(&json).map_err(json_error)?;
            profile.has_password = secret_ref.is_some();
            profiles.push(profile);
        }
        profiles.sort_by(|a, b| {
            b.favorite
                .cmp(&a.favorite)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        Ok(profiles)
    }

    pub fn get_rdp_profile(&self, id: &str) -> AppResult<Option<StoredRdpProfile>> {
        let connection = self.connection()?;
        let row = connection
            .query_row(
                "SELECT profile_json, secret_ref FROM rdp_profiles WHERE id = ?1",
                [id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
            )
            .optional()?;
        row.map(|(json, secret_ref)| {
            let mut profile: RdpProfile = serde_json::from_str(&json).map_err(json_error)?;
            profile.has_password = secret_ref.is_some();
            Ok(StoredRdpProfile {
                profile,
                secret_ref,
            })
        })
        .transpose()
    }

    pub fn save_rdp_profile(
        &self,
        profile: &RdpProfile,
        secret_ref: Option<&str>,
    ) -> AppResult<()> {
        self.connection()?.execute("INSERT INTO rdp_profiles (id, profile_json, secret_ref) VALUES (?1, ?2, ?3)
            ON CONFLICT(id) DO UPDATE SET profile_json = excluded.profile_json, secret_ref = excluded.secret_ref",
            params![profile.id, serde_json::to_string(profile).map_err(json_error)?, secret_ref])?;
        Ok(())
    }

    pub fn delete_rdp_profile(&self, id: &str) -> AppResult<()> {
        self.connection()?
            .execute("DELETE FROM rdp_profiles WHERE id = ?1", [id])?;
        Ok(())
    }
}

fn json_error(_: serde_json::Error) -> AppError {
    AppError::new("rdp_storage", "RDP 配置格式损坏或版本不兼容。")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn migration_is_repeatable_and_public_profiles_hide_secret_references() {
        let dir = std::env::temp_dir().join(format!(
            "dssh-rdp-repository-{:032x}",
            rand::random::<u128>()
        ));
        let repo = ProfileRepository::initialize(&dir, "test.db").unwrap();
        let profile: RdpProfile = serde_json::from_value(serde_json::json!({ "id":"rdp:test", "name":"PC", "host":"pc", "port":3389,
            "username":"user", "domain":"", "certificateFingerprint":"", "width":1920, "height":1080,
            "favorite":false, "tags":[], "description":"", "hasPassword":false, "createdAt":"1", "updatedAt":"1" })).unwrap();
        repo.save_rdp_profile(&profile, Some("opaque-keychain-reference"))
            .unwrap();
        let repo = ProfileRepository::initialize(&dir, "test.db").unwrap();
        assert!(repo.list_rdp_profiles().unwrap()[0].has_password);
        assert!(
            !serde_json::to_string(&repo.list_rdp_profiles().unwrap())
                .unwrap()
                .contains("opaque-keychain-reference")
        );
        let stored = repo.get_rdp_profile("rdp:test").unwrap().unwrap();
        assert_eq!(
            stored.secret_ref.as_deref(),
            Some("opaque-keychain-reference")
        );
        assert!(!stored.profile.skip_certificate_verification);
        let mut profile = stored.profile;
        profile.skip_certificate_verification = true;
        repo.save_rdp_profile(&profile, stored.secret_ref.as_deref())
            .unwrap();
        assert!(
            repo.get_rdp_profile("rdp:test")
                .unwrap()
                .unwrap()
                .profile
                .skip_certificate_verification
        );
        profile.skip_certificate_verification = false;
        repo.save_rdp_profile(&profile, stored.secret_ref.as_deref())
            .unwrap();
        assert!(
            !repo
                .get_rdp_profile("rdp:test")
                .unwrap()
                .unwrap()
                .profile
                .skip_certificate_verification
        );
        repo.delete_rdp_profile("rdp:test").unwrap();
        assert!(repo.list_rdp_profiles().unwrap().is_empty());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
