use crate::error::{AppError, AppResult};

/// Virtual connection-library paths; these are never used as filesystem paths.
pub fn normalize_folder(value: &str) -> AppResult<String> {
    let invalid = || {
        AppError::new(
            "invalid_folder",
            "目录最多 32 层、1024 字节，不能包含控制字符、. 或 ..。",
        )
    };
    if value.len() > 1024 || value.chars().any(char::is_control) {
        return Err(invalid());
    }
    let normalized = value.replace('\\', "/");
    let parts: Vec<_> = normalized
        .split('/')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .collect();
    if parts.len() > 32 || parts.iter().any(|s| matches!(*s, "." | "..")) {
        return Err(invalid());
    }
    Ok(parts.join("/"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn folder_normalization_is_platform_independent() {
        assert_eq!(normalize_folder(" / a // b \\ c / ").unwrap(), "a/b/c");
        assert_eq!(normalize_folder("/生产/应用/").unwrap(), "生产/应用");
        assert_eq!(normalize_folder("").unwrap(), "");
        for invalid in [
            "a/../b",
            "a/./b",
            "a\nb",
            &"a/".repeat(33),
            &"a".repeat(1025),
        ] {
            assert!(normalize_folder(invalid).is_err());
        }
    }
}
