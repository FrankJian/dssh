use percent_encoding::percent_decode_str;
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
        self.share_path = normalize_share_path(&self.share_path)?;
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
        if self.drive_letter.len() != 1 || !self.drive_letter.as_bytes()[0].is_ascii_alphabetic() {
            return Err(invalid("盘符必须是 A 到 Z 的单个字母。"));
        }
        Ok(())
    }
}

fn invalid_share() -> AppError {
    invalid(r"请输入 \\server\share 或 smb://server/share 格式的共享根路径，不包含子目录或凭据。")
}

fn valid_host(host: &str) -> bool {
    host.bytes().any(|byte| byte.is_ascii_alphanumeric())
        && host
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b".-_".contains(&byte))
}

fn normalize_share_path(input: &str) -> AppResult<String> {
    let input = input.trim();
    let path = if let Some((scheme, target)) = input.split_once("://")
        && scheme.eq_ignore_ascii_case("smb")
    {
        let (host, share) = target.split_once('/').ok_or_else(invalid_share)?;
        let share = share.strip_suffix('/').unwrap_or(share);
        if !valid_host(host) || share.contains(['/', '\\', '?', '#']) {
            return Err(invalid_share());
        }
        let share = percent_decode_str(share)
            .decode_utf8()
            .map_err(|_| invalid_share())?;
        if share.contains(['/', '\\']) {
            return Err(invalid_share());
        }
        format!(r"\\{host}\{share}")
    } else {
        input.to_owned()
    };
    let components = path.strip_prefix(r"\\").ok_or_else(invalid_share)?;
    let (host, share) = components.split_once('\\').ok_or_else(invalid_share)?;
    if path.len() > 260
        || [host, share].iter().any(|part| {
            part.is_empty()
                || matches!(*part, "." | "..")
                || part
                    .chars()
                    .any(|c| c.is_control() || "/\\:*?\"<>|".contains(c))
        })
    {
        return Err(invalid_share());
    }
    Ok(path)
}

#[cfg(any(target_os = "macos", test))]
pub fn finder_share_url(input: &str) -> AppResult<tauri::Url> {
    let path = normalize_share_path(input)?;
    let (host, share) = path[2..].split_once('\\').ok_or_else(invalid_share)?;
    if !valid_host(host) {
        return Err(invalid("请输入有效的 SMB 主机名或 IPv4 地址。"));
    }
    let mut url = tauri::Url::parse(&format!("smb://{host}/")).map_err(|_| invalid_share())?;
    url.path_segments_mut()
        .map_err(|_| invalid_share())?
        .pop_if_empty()
        .push(share);
    Ok(url)
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

    #[test]
    fn finder_urls_round_trip_through_existing_unc_storage() {
        let path = normalize_share_path("smb://nas.local/Team%20Files%20%23%25/").unwrap();
        assert_eq!(path, r"\\nas.local\Team Files #%");
        assert_eq!(
            finder_share_url(&path).unwrap().as_str(),
            "smb://nas.local/Team%20Files%20%23%25"
        );
        for input in [
            "smb://alice:password@nas/share",
            "smb://nas/share?query",
            "smb://nas/share%2fchild",
            "smb://nas/share%5cchild",
            "smb://nas/%2e%2e",
            r"\\alice@nas\share",
        ] {
            assert!(finder_share_url(input).is_err(), "{input}");
        }
    }
}
