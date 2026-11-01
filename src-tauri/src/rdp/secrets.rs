//! Saved RDP credentials never use the legacy SQLite secret table.
use crate::error::{AppError, AppResult};
use zeroize::Zeroizing;

const SERVICE: &str = "com.dssh.desktop.rdp";
fn unavailable() -> AppError {
    AppError::new(
        "rdp_secret_store",
        "系统凭据存储不可用或访问被拒绝。可选择本次输入，不保存密码。",
    )
}
pub fn read(reference: &str) -> AppResult<Zeroizing<String>> {
    keyring::Entry::new(SERVICE, reference)
        .map_err(|_| unavailable())?
        .get_password()
        .map(Zeroizing::new)
        .map_err(|_| unavailable())
}
pub fn write(reference: &str, password: &str) -> AppResult<()> {
    keyring::Entry::new(SERVICE, reference)
        .map_err(|_| unavailable())?
        .set_password(password)
        .map_err(|_| unavailable())
}
pub fn remove(reference: &str) -> AppResult<()> {
    match keyring::Entry::new(SERVICE, reference)
        .map_err(|_| unavailable())?
        .delete_credential()
    {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err(unavailable()),
    }
}
