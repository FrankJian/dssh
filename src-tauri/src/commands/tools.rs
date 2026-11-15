use std::io::Write;

use sha2::{Digest, Sha256};
use tauri::{
    WebviewWindow,
    ipc::{InvokeBody, Request},
};
use tauri_plugin_dialog::DialogExt;

use crate::error::{AppError, AppResult};

const PNG_HEADER: &[u8; 16] = b"\x89PNG\r\n\x1a\n\0\0\0\x0dIHDR";
const MAX_PNG_BYTES: usize = 20 * 1024 * 1024;

fn valid_tool_png(bytes: &[u8]) -> bool {
    if !(33..=MAX_PNG_BYTES).contains(&bytes.len()) || !bytes.starts_with(PNG_HEADER) {
        return false;
    }
    let width = u32::from_be_bytes(bytes[16..20].try_into().expect("PNG width field"));
    let height = u32::from_be_bytes(bytes[20..24].try_into().expect("PNG height field"));
    (1..=1024).contains(&width) && (1..=4096).contains(&height)
}

#[tauri::command]
pub async fn save_tool_png(window: WebviewWindow, request: Request<'_>) -> AppResult<bool> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(AppError::new("invalid_tool_png", "图片数据格式无效。"));
    };
    if !valid_tool_png(bytes) {
        return Err(AppError::new("invalid_tool_png", "图片格式或尺寸无效。"));
    }
    let bytes = bytes.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = window
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("保存文本图片")
            .set_file_name("text.png")
            .add_filter("PNG", &["png"])
            .blocking_save_file()
        else {
            return Ok(false);
        };
        let path = file
            .into_path()
            .map_err(|_| AppError::new("tool_png_path", "请选择本地文件位置。"))?;
        let directory = path
            .parent()
            .ok_or_else(|| AppError::new("tool_png_path", "请选择有效的保存位置。"))?;
        let mut temporary = tempfile::NamedTempFile::new_in(directory)
            .map_err(|_| AppError::new("tool_png_write", "无法在所选位置保存 PNG。"))?;
        temporary
            .write_all(&bytes)
            .and_then(|()| temporary.as_file().sync_all())
            .map_err(|_| AppError::new("tool_png_write", "无法写入 PNG 文件。"))?;
        temporary
            .persist(path)
            .map_err(|_| AppError::new("tool_png_write", "无法替换目标文件，请检查文件权限。"))?;
        Ok(true)
    })
    .await
    .map_err(|_| AppError::new("tool_png_write", "保存任务失败，请重试。"))?
}

#[tauri::command]
pub fn hash_tool_text(text: &str) -> AppResult<String> {
    if text.len() > 3 * 256 * 1024 {
        return Err(AppError::new(
            "tool_hash_size",
            "文本过长，无法计算 SHA-256。",
        ));
    }
    Ok(format!("{:x}", Sha256::digest(text.as_bytes())))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hashes_utf8_text() {
        assert_eq!(
            hash_tool_text("abc").expect("hash failed"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn bounds_png_payload_and_dimensions() {
        let mut bytes = [0; 33];
        bytes[..16].copy_from_slice(PNG_HEADER);
        bytes[16..20].copy_from_slice(&1024_u32.to_be_bytes());
        bytes[20..24].copy_from_slice(&4096_u32.to_be_bytes());
        assert!(valid_tool_png(&bytes));
        assert!(!valid_tool_png(&bytes[..24]));
        bytes[20..24].copy_from_slice(&4097_u32.to_be_bytes());
        assert!(!valid_tool_png(&bytes));
    }
}
