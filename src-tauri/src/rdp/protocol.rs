use crate::{
    error::{AppError, AppResult},
    models::rdp::RdpProfile,
};
use zeroize::Zeroizing;

/// A length-delimited private pipe protocol, never shell/argv or line based.
/// The native adapter also enforces these bounds before invoking FreeRDP.
pub fn encode_arguments(profile: &RdpProfile, password: &str) -> AppResult<Zeroizing<Vec<u8>>> {
    if password.is_empty() || password.len() > 4096 || password.contains('\0') {
        return Err(AppError::new(
            "rdp_password_invalid",
            "密码不能为空、包含空字符或超过 4096 字节。",
        ));
    }
    let host = if profile.host.contains(':') {
        format!("[{}]", profile.host)
    } else {
        profile.host.clone()
    };
    let mut args = Zeroizing::new(vec![
        format!("/v:{host}:{}", profile.port),
        format!("/u:{}", profile.username),
        format!("/p:{password}"),
        format!("/d:{}", profile.domain),
        format!("/size:{}x{}", profile.width, profile.height),
        format!(
            "/title:{}{} · Duo SSH",
            profile.name,
            if profile.skip_certificate_verification {
                " [未验证证书]"
            } else {
                ""
            }
        ),
        "/sec:nla".into(),
        "-f".into(),
        "+decorations".into(),
        "-auto-reconnect".into(),
        "-clipboard".into(),
        "-drives".into(),
        "-multimon".into(),
        "-dynamic-resolution".into(),
        "/smart-sizing".into(),
        "/log-level:OFF".into(),
        "/timeout:15000".into(),
    ]);
    if profile.skip_certificate_verification {
        args.push("/cert:ignore".into());
    } else if profile.certificate_fingerprint.is_empty() {
        args.push("/cert:deny".into());
    } else {
        args.push(format!(
            "/cert:fingerprint:sha256:{}",
            profile.certificate_fingerprint
        ));
    }
    let mut bytes = Zeroizing::new(Vec::new());
    bytes.extend_from_slice(&(args.len() as u32).to_be_bytes());
    for arg in args.iter() {
        bytes.extend_from_slice(&(arg.len() as u32).to_be_bytes());
        bytes.extend_from_slice(arg.as_bytes());
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn decode_arguments(bytes: &[u8]) -> Vec<String> {
        let count = u32::from_be_bytes(bytes[..4].try_into().unwrap());
        let mut cursor = 4;
        let mut args = vec![];
        for _ in 0..count {
            let len = u32::from_be_bytes(bytes[cursor..cursor + 4].try_into().unwrap()) as usize;
            cursor += 4;
            args.push(
                std::str::from_utf8(&bytes[cursor..cursor + len])
                    .unwrap()
                    .to_owned(),
            );
            cursor += len;
        }
        assert_eq!(cursor, bytes.len());
        args
    }
    #[test]
    fn skipping_verification_is_explicit_and_does_not_disable_nla() {
        let mut p: RdpProfile = serde_json::from_value(serde_json::json!({"id":"rdp:test","name":"PC","host":"pc","port":3389,
            "username":"user","domain":"","certificateFingerprint":"","width":1920,"height":1080,"favorite":false,
            "tags":[],"description":"","hasPassword":false,"createdAt":"1","updatedAt":"1"})).unwrap();
        // Missing field in old SQLite JSON defaults to strict verification.
        assert!(!p.skip_certificate_verification);
        let strict = decode_arguments(&encode_arguments(&p, "test-only").unwrap());
        assert!(strict.iter().any(|a| a == "/cert:deny"));
        assert!(strict.iter().any(|a| a == "-f"));
        assert!(strict.iter().any(|a| a == "+decorations"));
        assert!(strict.iter().any(|a| a == "/smart-sizing"));
        p.certificate_fingerprint = "ab".repeat(32);
        let pinned = decode_arguments(&encode_arguments(&p, "test-only").unwrap());
        assert!(pinned.iter().any(|a| a.starts_with("/cert:fingerprint:")));
        p.skip_certificate_verification = true;
        let skipped = decode_arguments(&encode_arguments(&p, "test-only").unwrap());
        assert!(skipped.iter().any(|a| a == "/cert:ignore"));
        assert!(skipped.iter().any(|a| a == "/sec:nla"));
        assert!(
            !skipped
                .iter()
                .any(|a| a == "/cert:deny" || a.starts_with("/cert:fingerprint:"))
        );
        assert!(
            skipped
                .iter()
                .any(|a| a.starts_with("/title:") && a.contains("未验证证书"))
        );
        p.skip_certificate_verification = false;
        let restored = decode_arguments(&encode_arguments(&p, "test-only").unwrap());
        assert!(restored.iter().any(|a| a.starts_with("/cert:fingerprint:")));
        assert!(!restored.iter().any(|a| a == "/cert:ignore"));
    }
    #[test]
    fn credentials_cannot_inject_options_even_with_newlines() {
        let p: RdpProfile = serde_json::from_value(serde_json::json!({"id":"rdp:test","name":"PC","host":"::1","port":3389,
            "username":"user","domain":"","certificateFingerprint":"","width":1920,"height":1080,"favorite":false,
            "tags":[],"description":"","hasPassword":false,"createdAt":"1","updatedAt":"1"})).unwrap();
        let bytes = encode_arguments(&p, "test-only\n/cert:ignore").unwrap();
        let count = u32::from_be_bytes(bytes[..4].try_into().unwrap());
        let mut cursor = 4;
        let mut args = vec![];
        for _ in 0..count {
            let len = u32::from_be_bytes(bytes[cursor..cursor + 4].try_into().unwrap()) as usize;
            cursor += 4;
            args.push(std::str::from_utf8(&bytes[cursor..cursor + len]).unwrap());
            cursor += len;
        }
        assert_eq!(cursor, bytes.len());
        assert!(args.contains(&"/sec:nla"));
        assert!(args.contains(&"/cert:deny"));
        assert!(!args.contains(&"/cert:ignore"));
        assert!(args.contains(&"/v:[::1]:3389"));
    }
}
