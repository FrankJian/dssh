use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SmbProfile {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub folder: String,
    pub share_path: String,
    pub drive_letter: String,
    pub favorite: bool,
    pub tags: Vec<String>,
    pub description: String,
    pub created_at: String,
    pub updated_at: String,
}

impl SmbProfile {
    pub fn normalize_and_validate(&mut self) -> AppResult<()> {
        self.name = self.name.trim().to_owned();
        self.folder = super::connection_folder::normalize_folder(&self.folder)?;
        self.share_path = self.share_path.trim().to_owned();
        self.drive_letter = self
            .drive_letter
            .trim()
            .trim_end_matches(':')
            .to_ascii_uppercase();
        self.tags = self
            .tags
            .iter()
            .map(|tag| tag.trim().to_owned())
            .filter(|tag| !tag.is_empty())
            .collect();
        self.tags.sort();
        self.tags.dedup();
        if self.name.is_empty()
            || self.name.len() > 160
            || self.name.chars().any(char::is_control)
            || self.description.len() > 4096
            || self.description.chars().any(char::is_control)
            || self.tags.len() > 64
            || self
                .tags
                .iter()
                .any(|tag| tag.len() > 128 || tag.chars().any(char::is_control))
        {
            return Err(invalid("名称、描述或标签无效。"));
        }
        let components: Vec<_> = self
            .share_path
            .strip_prefix(r"\\")
            .ok_or_else(|| invalid(r"请输入 \\server\share 格式的共享路径。"))?
            .split('\u{5c}')
            .collect();
        if components.len() != 2
            || components.iter().any(|part| {
                part.is_empty()
                    || *part == "."
                    || *part == ".."
                    || part
                        .chars()
                        .any(|c| c.is_control() || "/:*?\"<>|".contains(c))
            })
            || self.share_path.len() > 260
        {
            return Err(invalid(
                r"请输入共享根路径，例如 \\server\share，不包含子目录。",
            ));
        }
        if self.drive_letter.len() != 1 || !self.drive_letter.as_bytes()[0].is_ascii_alphabetic() {
            return Err(invalid("盘符必须是 A 到 Z 的单个字母。"));
        }
        Ok(())
    }
}

fn invalid(message: &str) -> AppError {
    AppError::new("smb_invalid_profile", message)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn profile(path: &str, drive: &str) -> SmbProfile {
        SmbProfile {
            id: String::new(),
            name: "共享".into(),
            folder: String::new(),
            share_path: path.into(),
            drive_letter: drive.into(),
            favorite: false,
            tags: vec![],
            description: String::new(),
            created_at: String::new(),
            updated_at: String::new(),
        }
    }
    #[test]
    fn accepts_only_share_roots_and_drive_letters() {
        let mut valid = profile(r"\\server\share", "z:");
        valid.normalize_and_validate().unwrap();
        assert_eq!(valid.drive_letter, "Z");
        for path in [
            r"\server\share",
            r"\\server",
            r"\\server\share\folder",
            r"\\server\..",
            r"\\?\UNC\server\share",
            r"\\server\bad/name",
        ] {
            assert!(
                profile(path, "Z").normalize_and_validate().is_err(),
                "{path}"
            );
        }
        assert!(
            profile(r"\\server\share", "Z:")
                .normalize_and_validate()
                .is_ok()
        );
        assert!(
            profile(r"\\server\share", "1")
                .normalize_and_validate()
                .is_err()
        );
    }
}
