use crate::error::{AppError, AppResult};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

fn failure() -> AppError {
    AppError::new(
        "browser_external",
        "无法打开所选浏览器，请检查是否已安装，或在设置中选择系统默认浏览器。",
    )
}
pub fn open(app: &AppHandle, url: &str, browser: &str) -> AppResult<()> {
    if !matches!(browser, "system" | "chrome" | "edge") {
        return Err(AppError::new("browser_external", "不支持的外部浏览器。"));
    }
    if browser == "system" {
        return app
            .opener()
            .open_url(url, None::<&str>)
            .map_err(|_| failure());
    }
    #[cfg(target_os = "windows")]
    {
        use std::{os::windows::process::CommandExt, path::PathBuf, process::Command};
        let relative = if browser == "chrome" {
            "Google/Chrome/Application/chrome.exe"
        } else {
            "Microsoft/Edge/Application/msedge.exe"
        };
        // Explicit browsers use a direct executable, never `cmd /c start`.
        // Thus URL percent signs, quotes and shell metacharacters stay data.
        let executable = ["LOCALAPPDATA", "ProgramFiles", "ProgramFiles(x86)"]
            .into_iter()
            .filter_map(std::env::var_os)
            .map(PathBuf::from)
            .map(|base| base.join(relative))
            .find(|path| path.is_file())
            .ok_or_else(failure)?;
        Command::new(executable)
            .arg(url)
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|_| failure())?;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let program = match browser {
            "chrome" => {
                if cfg!(target_os = "macos") {
                    "Google Chrome"
                } else {
                    "google-chrome"
                }
            }
            _ => {
                if cfg!(target_os = "macos") {
                    "Microsoft Edge"
                } else {
                    "microsoft-edge"
                }
            }
        };
        app.opener()
            .open_url(url, Some(program))
            .map_err(|_| failure())
    }
}
