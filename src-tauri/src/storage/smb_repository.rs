use super::ProfileRepository;
use crate::{
    error::{AppError, AppResult},
    models::smb::SmbProfile,
};
use rusqlite::params;

impl ProfileRepository {
    pub fn list_smb_profiles(&self) -> AppResult<Vec<SmbProfile>> {
        let connection = self.connection()?;
        let mut statement = connection.prepare("SELECT profile_json FROM smb_profiles")?;
        let mut profiles = statement
            .query_map([], |row| row.get::<_, String>(0))?
            .map(|row| serde_json::from_str::<SmbProfile>(&row?).map_err(json_error))
            .collect::<AppResult<Vec<_>>>()?;
        profiles.sort_by(|a, b| {
            b.favorite
                .cmp(&a.favorite)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        Ok(profiles)
    }

    pub fn get_smb_profile(&self, id: &str) -> AppResult<Option<SmbProfile>> {
        use rusqlite::OptionalExtension;
        self.connection()?
            .query_row(
                "SELECT profile_json FROM smb_profiles WHERE id = ?1",
                [id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .map(|json| serde_json::from_str(&json).map_err(json_error))
            .transpose()
    }

    pub fn save_smb_profile(&self, profile: &SmbProfile) -> AppResult<()> {
        self.connection()?.execute(
            "INSERT INTO smb_profiles (id, profile_json) VALUES (?1, ?2)
            ON CONFLICT(id) DO UPDATE SET profile_json = excluded.profile_json",
            params![
                profile.id,
                serde_json::to_string(profile).map_err(json_error)?
            ],
        )?;
        Ok(())
    }

    pub fn delete_smb_profile(&self, id: &str) -> AppResult<()> {
        self.connection()?
            .execute("DELETE FROM smb_profiles WHERE id = ?1", [id])?;
        Ok(())
    }
}

fn json_error(_: serde_json::Error) -> AppError {
    AppError::new("smb_storage", "网络共享配置格式损坏或版本不兼容。")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn smb_profiles_survive_reopen_and_folder_rename() {
        let dir = std::env::temp_dir().join(format!(
            "dssh-smb-repository-{:032x}",
            rand::random::<u128>()
        ));
        let repo = ProfileRepository::initialize(&dir, "test.db").unwrap();
        let profile = SmbProfile {
            id: "smb:test".into(),
            name: "Team".into(),
            folder: "work/team".into(),
            share_path: r"\\server\share".into(),
            drive_letter: "Z".into(),
            favorite: false,
            tags: vec!["team".into()],
            description: String::new(),
            created_at: "1".into(),
            updated_at: "1".into(),
        };
        repo.save_smb_profile(&profile).unwrap();
        let repo = ProfileRepository::initialize(&dir, "test.db").unwrap();
        assert_eq!(
            repo.list_smb_profiles().unwrap()[0].share_path,
            profile.share_path
        );
        repo.rename_connection_folder("work", "office").unwrap();
        assert_eq!(
            repo.get_smb_profile("smb:test").unwrap().unwrap().folder,
            "office/team"
        );
        repo.delete_smb_profile("smb:test").unwrap();
        assert!(repo.list_smb_profiles().unwrap().is_empty());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
