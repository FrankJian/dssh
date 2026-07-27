//! Password-based encryption for portable secret payloads (encrypted profile
//! export / import).
//!
//! Scheme: Argon2id derives a 256-bit key from the user's password and a random
//! salt; AES-256-GCM then encrypts the payload with a random nonce. The salt,
//! nonce and ciphertext are packed into a small binary envelope and Base64
//! encoded so the result is a single copy-pasteable string.

use aes_gcm::{
    Aes256Gcm, Nonce,
    aead::{Aead, KeyInit},
};
use argon2::Argon2;
use base64::{Engine as _, engine::general_purpose::STANDARD};
use rand::Rng;

use crate::error::{AppError, AppResult};

/// Magic prefix that identifies the binary envelope. Bumped if the format ever
/// changes so decryption can reject incompatible payloads early.
const MAGIC: &[u8; 5] = b"DSSHc";
const VERSION: u8 = 1;
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;
const KEY_LEN: usize = 32;

/// Human-facing prefix so the exported text is self-describing and easy to
/// detect on import.
pub const ENCRYPTED_PREFIX: &str = "DSSH-ENCRYPTED-1:";

fn crypto_error(message: impl Into<String>) -> AppError {
    AppError::new("crypto_error", message)
}

fn derive_key(password: &str, salt: &[u8]) -> AppResult<[u8; KEY_LEN]> {
    let mut key = [0u8; KEY_LEN];
    Argon2::default()
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|error| crypto_error(format!("密钥派生失败：{error}")))?;
    Ok(key)
}

/// Encrypt `plaintext` with `password`, returning a self-describing, Base64
/// text blob.
pub fn encrypt(plaintext: &str, password: &str) -> AppResult<String> {
    if password.is_empty() {
        return Err(crypto_error("密码不能为空。"));
    }

    let mut salt = [0u8; SALT_LEN];
    let mut nonce_bytes = [0u8; NONCE_LEN];
    let mut rng = rand::rng();
    rng.fill_bytes(&mut salt);
    rng.fill_bytes(&mut nonce_bytes);

    let key = derive_key(password, &salt)?;
    let cipher =
        Aes256Gcm::new_from_slice(&key).map_err(|_| crypto_error("加密密钥初始化失败。"))?;
    let nonce = Nonce::try_from(&nonce_bytes[..]).map_err(|_| crypto_error("nonce 长度错误。"))?;
    let ciphertext = cipher
        .encrypt(&nonce, plaintext.as_bytes())
        .map_err(|_| crypto_error("加密失败。"))?;

    let mut envelope =
        Vec::with_capacity(MAGIC.len() + 1 + SALT_LEN + NONCE_LEN + ciphertext.len());
    envelope.extend_from_slice(MAGIC);
    envelope.push(VERSION);
    envelope.extend_from_slice(&salt);
    envelope.extend_from_slice(&nonce_bytes);
    envelope.extend_from_slice(&ciphertext);

    Ok(format!("{ENCRYPTED_PREFIX}{}", STANDARD.encode(&envelope)))
}

/// Decrypt a blob produced by [`encrypt`] using `password`.
pub fn decrypt(blob: &str, password: &str) -> AppResult<String> {
    let encoded = blob
        .trim()
        .strip_prefix(ENCRYPTED_PREFIX)
        .unwrap_or_else(|| blob.trim());
    let envelope = STANDARD
        .decode(encoded.trim())
        .map_err(|_| crypto_error("文件格式无效，无法解析。"))?;

    let header_len = MAGIC.len() + 1 + SALT_LEN + NONCE_LEN;
    if envelope.len() <= header_len {
        return Err(crypto_error("文件已损坏或不是有效的加密配置。"));
    }
    if &envelope[..MAGIC.len()] != MAGIC {
        return Err(crypto_error("文件已损坏或不是有效的加密配置。"));
    }
    if envelope[MAGIC.len()] != VERSION {
        return Err(crypto_error("加密文件版本不受支持。"));
    }

    let salt_start = MAGIC.len() + 1;
    let nonce_start = salt_start + SALT_LEN;
    let cipher_start = nonce_start + NONCE_LEN;
    let salt = &envelope[salt_start..nonce_start];
    let nonce_bytes = &envelope[nonce_start..cipher_start];
    let ciphertext = &envelope[cipher_start..];

    let key = derive_key(password, salt)?;
    let cipher =
        Aes256Gcm::new_from_slice(&key).map_err(|_| crypto_error("加密密钥初始化失败。"))?;
    let nonce = Nonce::try_from(nonce_bytes).map_err(|_| crypto_error("nonce 长度错误。"))?;
    let plaintext = cipher
        .decrypt(&nonce, ciphertext)
        .map_err(|_| crypto_error("密码错误或文件已损坏。"))?;

    String::from_utf8(plaintext).map_err(|_| crypto_error("解密内容不是有效的文本。"))
}

/// Whether a blob looks like an encrypted export (used to pick the import path).
pub fn is_encrypted(blob: &str) -> bool {
    blob.trim_start().starts_with(ENCRYPTED_PREFIX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        let secret = "hello: world\npassword: hunter2\n";
        let blob = encrypt(secret, "correct horse").unwrap();
        assert!(is_encrypted(&blob));
        assert_eq!(decrypt(&blob, "correct horse").unwrap(), secret);
    }

    #[test]
    fn wrong_password_fails() {
        let blob = encrypt("data", "right").unwrap();
        assert!(decrypt(&blob, "wrong").is_err());
    }
}
