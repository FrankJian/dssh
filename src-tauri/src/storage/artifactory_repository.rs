use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};

use super::ProfileRepository;
use crate::error::{AppError, AppResult};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactoryProfile {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub has_token: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveArtifactoryProfileRequest {
    pub id: Option<String>,
    pub name: String,
    pub base_url: String,
    pub token: Option<String>,
}

pub fn normalize_base_url(input: &str) -> AppResult<String> {
    let mut url = reqwest::Url::parse(input.trim())
        .map_err(|_| AppError::new("artifactory_url", "请输入有效的 Artifactory URL。"))?;
    if !matches!(url.scheme(), "https" | "http")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(AppError::new(
            "artifactory_url",
            "URL 只能包含 http(s) 地址和路径，不能包含凭据、查询或片段。",
        ));
    }
    let path = url.path().trim_end_matches('/');
    let path = path
        .strip_suffix("/artifactory")
        .unwrap_or(path)
        .to_string();
    url.set_path(&path);
    Ok(url.to_string().trim_end_matches('/').to_string())
}

fn token_key(id: &str) -> String {
    format!("artifactory:{id}:token")
}

impl ProfileRepository {
    pub fn list_artifactory_profiles(&self) -> AppResult<Vec<ArtifactoryProfile>> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT id, name, base_url FROM artifactory_profiles ORDER BY name COLLATE NOCASE",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?;
        rows.map(|row| {
            let (id, name, base_url) = row?;
            Ok(ArtifactoryProfile {
                has_token: self.get_secret(&token_key(&id))?.is_some(),
                id,
                name,
                base_url,
            })
        })
        .collect()
    }

    pub fn get_artifactory_profile(&self, id: &str) -> AppResult<ArtifactoryProfile> {
        let connection = self.connection()?;
        let row = connection
            .query_row(
                "SELECT name, base_url FROM artifactory_profiles WHERE id=?1",
                [id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?;
        let (name, base_url) =
            row.ok_or_else(|| AppError::new("artifactory_profile", "Artifactory 连接不存在。"))?;
        Ok(ArtifactoryProfile {
            id: id.into(),
            name,
            base_url,
            has_token: self.get_secret(&token_key(id))?.is_some(),
        })
    }

    pub fn save_artifactory_profile(
        &self,
        request: SaveArtifactoryProfileRequest,
    ) -> AppResult<ArtifactoryProfile> {
        let name = request.name.trim();
        if name.is_empty() {
            return Err(AppError::new("artifactory_name", "请输入连接名称。"));
        }
        let base_url = normalize_base_url(&request.base_url)?;
        let id = request.id.unwrap_or_else(|| {
            format!(
                "artifactory-{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|time| time.as_nanos())
                    .unwrap_or_default()
            )
        });
        let existing = self
            .connection()?
            .query_row(
                "SELECT 1 FROM artifactory_profiles WHERE id=?1",
                [&id],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if !existing && request.token.as_deref().is_none_or(str::is_empty) {
            return Err(AppError::new(
                "artifactory_token",
                "新连接需要 Access Token。",
            ));
        }
        let connection = self.connection()?;
        connection.execute("INSERT INTO artifactory_profiles(id,name,base_url,created_at,updated_at) VALUES (?1,?2,?3,datetime('now'),datetime('now')) ON CONFLICT(id) DO UPDATE SET name=excluded.name, base_url=excluded.base_url, updated_at=datetime('now')", params![id, name, base_url])?;
        if let Some(token) = request.token.filter(|value| !value.is_empty()) {
            self.set_secret(&token_key(&id), &token)?;
        }
        self.get_artifactory_profile(&id)
    }

    pub fn delete_artifactory_profile(&self, id: &str) -> AppResult<()> {
        self.connection()?
            .execute("DELETE FROM artifactory_profiles WHERE id=?1", [id])?;
        self.delete_secret(&token_key(id))
    }

    pub fn artifactory_token(&self, id: &str) -> AppResult<String> {
        self.get_secret(&token_key(id))?.ok_or_else(|| {
            AppError::new("artifactory_token", "连接缺少 Access Token，请编辑连接。")
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn url_normalization_rejects_credentials_and_query() {
        assert_eq!(
            normalize_base_url("https://acme.jfrog.io/artifactory/").unwrap(),
            "https://acme.jfrog.io"
        );
        assert!(normalize_base_url("https://user:pass@acme.jfrog.io").is_err());
        assert!(normalize_base_url("https://acme.jfrog.io/?token=x").is_err());
    }

    #[test]
    fn profile_roundtrip_keeps_token_out_of_public_payload() {
        let directory =
            std::env::temp_dir().join(format!("dssh-artifactory-test-{}", rand::random::<u128>()));
        let repository = ProfileRepository::initialize(&directory, "test.sqlite3").unwrap();
        let profile = repository
            .save_artifactory_profile(SaveArtifactoryProfileRequest {
                id: None,
                name: "Builds".into(),
                base_url: "https://acme.jfrog.io/artifactory".into(),
                token: Some("secret-token".into()),
            })
            .unwrap();
        assert_eq!(
            repository.artifactory_token(&profile.id).unwrap(),
            "secret-token"
        );
        assert!(
            !serde_json::to_string(&profile)
                .unwrap()
                .contains("secret-token")
        );
        repository
            .save_artifactory_profile(SaveArtifactoryProfileRequest {
                id: Some(profile.id.clone()),
                name: "Builds 2".into(),
                base_url: "https://acme.jfrog.io".into(),
                token: None,
            })
            .unwrap();
        assert_eq!(
            repository.artifactory_token(&profile.id).unwrap(),
            "secret-token"
        );
        assert_eq!(
            repository.list_artifactory_profiles().unwrap()[0].name,
            "Builds 2"
        );
        repository.delete_artifactory_profile(&profile.id).unwrap();
        assert!(repository.artifactory_token(&profile.id).is_err());
        let _ = std::fs::remove_dir_all(directory);
    }
}
