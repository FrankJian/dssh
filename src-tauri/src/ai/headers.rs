//! Shared validation and transport headers. Values are write-only credentials.
use crate::{
    error::{AppError, AppResult},
    models::ai::AiRequestHeader,
};
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use std::collections::HashSet;

fn invalid() -> AppError {
    AppError::new(
        "ai_headers_error",
        "额外请求头无效：请检查名称、重复项及值（不允许换行或控制字符）。",
    )
}

pub fn validate(headers: &[AiRequestHeader]) -> AppResult<()> {
    if headers.len() > 32 {
        return Err(invalid());
    }
    let mut ids = HashSet::new();
    let mut names = HashSet::new();
    for header in headers {
        if header.id.is_empty()
            || header.id.len() > 128
            || !header
                .id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
            || !ids.insert(&header.id)
        {
            return Err(invalid());
        }
        let name = HeaderName::from_bytes(header.name.as_bytes()).map_err(|_| invalid())?;
        if !names.insert(name.clone())
            || matches!(
                name.as_str(),
                "host"
                    | "content-length"
                    | "transfer-encoding"
                    | "connection"
                    | "proxy-connection"
                    | "te"
                    | "trailer"
                    | "upgrade"
            )
        {
            return Err(invalid());
        }
        if let Some(value) = &header.value {
            if value.len() > 8192 || value.bytes().any(|c| c.is_ascii_control()) {
                return Err(invalid());
            }
            HeaderValue::from_str(value)
                .map_err(|_| invalid())?
                .to_str()
                .map_err(|_| invalid())?;
        }
    }
    Ok(())
}

pub fn request_headers(headers: &[AiRequestHeader]) -> AppResult<HeaderMap> {
    validate(headers)?;
    let mut result = HeaderMap::new();
    for header in headers {
        let value = header.value.as_deref().ok_or_else(|| {
            AppError::new("ai_headers_error", "请求头的值不存在，请重新填写并保存。")
        })?;
        let mut value = HeaderValue::from_str(value).map_err(|_| invalid())?;
        value.set_sensitive(true);
        result.insert(
            HeaderName::from_bytes(header.name.as_bytes()).map_err(|_| invalid())?,
            value,
        );
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn header(name: &str, value: &str) -> AiRequestHeader {
        AiRequestHeader {
            id: "header-one".into(),
            name: name.into(),
            value: Some(value.into()),
            has_value: false,
        }
    }
    #[test]
    fn rejects_injection_duplicates_and_transport_headers() {
        for (name, value) in [
            ("X-Key", "key\r\nInjected: true"),
            ("Bad Name", "ok"),
            ("Host", "evil.test"),
            ("Content-Length", "4"),
            ("Connection", "close"),
        ] {
            assert!(request_headers(&[header(name, value)]).is_err());
        }
        let mut duplicate = header("x-key", "second");
        duplicate.id = "two".into();
        assert!(validate(&[header("X-Key", "first"), duplicate]).is_err());
        assert!(
            request_headers(&[AiRequestHeader {
                value: None,
                ..header("X-Key", "")
            }])
            .is_err()
        );
    }
    #[test]
    fn custom_headers_override_defaults_and_allow_empty_values() {
        let extra = request_headers(&[header("Authorization", "Bearer gateway-secret")]).unwrap();
        let request = reqwest::Client::new()
            .post("https://example.test/")
            .bearer_auth("original")
            .headers(extra)
            .build()
            .unwrap();
        assert_eq!(request.headers()["authorization"], "Bearer gateway-secret");
        assert!(request.headers()["authorization"].is_sensitive());
        assert_eq!(
            request_headers(&[header("X-Empty", "")]).unwrap()["x-empty"],
            ""
        );
    }
}
