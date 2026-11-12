use crate::{
    app::AppState,
    browser,
    error::{AppError, AppResult},
    models::smb::SmbProfile,
};
use tauri::{AppHandle, Manager, Webview};

fn trusted(app: &AppHandle, webview: &Webview) -> AppResult<()> {
    browser::trusted(webview)?;
    if app.state::<AppState>().app_lock.status()?.locked {
        return Err(AppError::new("smb_locked", "请先解锁 Duo SSH。"));
    }
    Ok(())
}

#[tauri::command]
pub fn list_smb_profiles(app: AppHandle, webview: Webview) -> AppResult<Vec<SmbProfile>> {
    trusted(&app, &webview)?;
    app.state::<AppState>().profiles.list_smb_profiles()
}

#[tauri::command]
pub fn save_smb_profile(
    app: AppHandle,
    webview: Webview,
    mut profile: SmbProfile,
) -> AppResult<SmbProfile> {
    trusted(&app, &webview)?;
    profile.normalize_and_validate()?;
    #[cfg(target_os = "macos")]
    crate::models::smb::finder_share_url(&profile.share_path)?;
    let repo = &app.state::<AppState>().profiles;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string();
    if profile.id.is_empty() {
        profile.id = format!("smb:{:032x}", rand::random::<u128>());
        profile.created_at = now.clone();
    } else {
        let existing = repo
            .get_smb_profile(&profile.id)?
            .ok_or_else(|| AppError::new("smb_missing", "网络共享配置已不存在。"))?;
        profile.created_at = existing.created_at;
    }
    profile.updated_at = now;
    repo.save_smb_profile(&profile)?;
    Ok(profile)
}

#[tauri::command]
pub fn delete_smb_profile(app: AppHandle, webview: Webview, id: String) -> AppResult<()> {
    trusted(&app, &webview)?;
    app.state::<AppState>().profiles.delete_smb_profile(&id)
}

#[tauri::command]
pub async fn map_smb_profile(app: AppHandle, webview: Webview, id: String) -> AppResult<()> {
    trusted(&app, &webview)?;
    let profile = app
        .state::<AppState>()
        .profiles
        .get_smb_profile(&id)?
        .ok_or_else(|| AppError::new("smb_missing", "网络共享配置已不存在。"))?;
    tauri::async_runtime::spawn_blocking(move || map_share(&profile))
        .await
        .map_err(|_| AppError::new("smb_task", "网络共享映射任务异常。"))?
}

#[tauri::command]
pub async fn unmap_smb_profile(app: AppHandle, webview: Webview, id: String) -> AppResult<()> {
    trusted(&app, &webview)?;
    let profile = app
        .state::<AppState>()
        .profiles
        .get_smb_profile(&id)?
        .ok_or_else(|| AppError::new("smb_missing", "网络共享配置已不存在。"))?;
    tauri::async_runtime::spawn_blocking(move || unmap_share(&profile))
        .await
        .map_err(|_| AppError::new("smb_task", "断开网络共享任务异常。"))?
}

#[cfg(target_os = "macos")]
fn map_share(profile: &SmbProfile) -> AppResult<()> {
    let url = crate::models::smb::finder_share_url(&profile.share_path)?;
    let status = std::process::Command::new("/usr/bin/open")
        .args(["-b", "com.apple.finder", url.as_str()])
        .status()
        .map_err(|_| AppError::new("smb_finder", "无法打开 Finder。"))?;
    if !status.success() {
        return Err(AppError::new(
            "smb_finder",
            "无法在 Finder 中打开网络共享。",
        ));
    }
    Ok(())
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn map_share(_: &SmbProfile) -> AppResult<()> {
    Err(AppError::new(
        "smb_unsupported",
        "网络共享连接仅在 Windows 和 macOS 上可用。",
    ))
}
#[cfg(target_os = "macos")]
fn unmap_share(_: &SmbProfile) -> AppResult<()> {
    Err(AppError::new(
        "smb_finder",
        "请在 Finder 中推出共享卷以断开连接。",
    ))
}
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn unmap_share(_: &SmbProfile) -> AppResult<()> {
    Err(AppError::new(
        "smb_unsupported",
        "盘符映射仅在 Windows 上可用。",
    ))
}

#[cfg(target_os = "windows")]
mod windows {
    use super::*;
    use std::{ffi::OsStr, os::windows::ffi::OsStrExt, ptr};

    #[repr(C)]
    struct NetResourceW {
        scope: u32,
        resource_type: u32,
        display_type: u32,
        usage: u32,
        local_name: *const u16,
        remote_name: *const u16,
        comment: *const u16,
        provider: *const u16,
    }
    #[link(name = "Mpr")]
    unsafe extern "system" {
        fn WNetAddConnection2W(
            resource: *const NetResourceW,
            password: *const u16,
            username: *const u16,
            flags: u32,
        ) -> u32;
        fn WNetCancelConnection2W(name: *const u16, flags: u32, force: i32) -> u32;
        fn WNetGetConnectionW(local: *const u16, remote: *mut u16, size: *mut u32) -> u32;
    }
    fn wide(value: &str) -> Vec<u16> {
        OsStr::new(value).encode_wide().chain(Some(0)).collect()
    }
    fn drive(profile: &SmbProfile) -> String {
        format!("{}:", profile.drive_letter)
    }
    fn current_mapping(local: &[u16]) -> Result<Option<String>, u32> {
        let mut remote = vec![0_u16; 1024];
        let mut size = remote.len() as u32;
        // SAFETY: all pointers refer to live, writable buffers for the duration of the call.
        let code = unsafe { WNetGetConnectionW(local.as_ptr(), remote.as_mut_ptr(), &mut size) };
        match code {
            0 => Ok(Some(String::from_utf16_lossy(
                &remote[..remote
                    .iter()
                    .position(|ch| *ch == 0)
                    .unwrap_or(remote.len())],
            ))),
            2250 => Ok(None), // ERROR_NOT_CONNECTED
            other => Err(other),
        }
    }
    fn failure(action: &str, code: u32) -> AppError {
        let hint = match code {
            5 => "权限不足。",
            53 | 67 => "找不到服务器或共享名。",
            85 => "盘符已被占用。",
            86 | 1326 => "Windows 凭据无效；请先在系统中登录该共享。",
            1219 => "同一服务器已使用另一组凭据连接，请先在 Windows 中断开冲突连接。",
            2401 => "该盘符有打开的文件，请先关闭后重试。",
            _ => "请检查网络、共享权限和 Windows 凭据。",
        };
        AppError::new(
            "smb_mapping",
            format!("{action}失败（Windows 错误 {code}）。{hint}"),
        )
    }
    pub(super) fn map_share(profile: &SmbProfile) -> AppResult<()> {
        let local = drive(profile);
        let local_w = wide(&local);
        let remote_w = wide(&profile.share_path);
        match current_mapping(&local_w) {
            Ok(Some(existing)) if existing.eq_ignore_ascii_case(&profile.share_path) => {}
            Ok(Some(_)) => {
                return Err(AppError::new(
                    "smb_drive_in_use",
                    "盘符已映射到其他共享，请修改盘符。",
                ));
            }
            Ok(None) | Err(2250) => {
                let resource = NetResourceW {
                    scope: 0,
                    resource_type: 1,
                    display_type: 0,
                    usage: 0,
                    local_name: local_w.as_ptr(),
                    remote_name: remote_w.as_ptr(),
                    comment: ptr::null(),
                    provider: ptr::null(),
                };
                // SAFETY: NETRESOURCEW and both UTF-16 strings remain valid for the synchronous call.
                let code = unsafe { WNetAddConnection2W(&resource, ptr::null(), ptr::null(), 0) };
                if code != 0 {
                    return Err(failure("映射网络共享", code));
                }
            }
            Err(code) => return Err(failure("检查盘符", code)),
        }
        std::process::Command::new("explorer.exe")
            .arg(format!("{local}\\"))
            .spawn()
            .map_err(|_| AppError::new("smb_explorer", "映射成功，但无法打开文件资源管理器。"))?;
        Ok(())
    }
    pub(super) fn unmap_share(profile: &SmbProfile) -> AppResult<()> {
        let local_w = wide(&drive(profile));
        match current_mapping(&local_w) {
            Ok(None) => return Ok(()),
            Ok(Some(existing)) if existing.eq_ignore_ascii_case(&profile.share_path) => {}
            Ok(Some(_)) => {
                return Err(AppError::new(
                    "smb_drive_in_use",
                    "盘符目前属于其他共享，未断开。",
                ));
            }
            Err(code) => return Err(failure("检查盘符", code)),
        }
        // SAFETY: local_w remains valid for the synchronous call. force=0 preserves open files.
        let code = unsafe { WNetCancelConnection2W(local_w.as_ptr(), 0, 0) };
        if code != 0 {
            return Err(failure("断开网络共享", code));
        }
        Ok(())
    }
}

#[cfg(target_os = "windows")]
use windows::{map_share, unmap_share};
