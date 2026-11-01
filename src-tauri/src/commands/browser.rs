use crate::{
    browser,
    error::{AppError, AppResult},
    models::browser::{BrowserBounds, BrowserTab, BrowserTabsEvent},
};
use tauri::{AppHandle, Webview};

#[tauri::command]
pub async fn open_browser(
    app: AppHandle,
    webview: Webview,
    url: Option<String>,
    detached: Option<bool>,
) -> AppResult<BrowserTab> {
    browser::trusted(&webview)?;
    let owner = webview.label();
    // Legacy browser toolbars have no multi-tab workbench of their own.
    let owner = if owner.starts_with("browser-ui-") {
        "main"
    } else {
        owner
    };
    let tab = browser::create_owned(&app, url, owner)?;
    if detached.unwrap_or(false) {
        browser::detach(&app, &tab.id)?;
    }
    browser::get(&app, &tab.id)
}
#[tauri::command]
pub async fn list_browser_tabs(app: AppHandle, webview: Webview) -> AppResult<BrowserTabsEvent> {
    browser::trusted(&webview)?;
    Ok(browser::list(&app, webview.label()))
}
#[tauri::command]
pub async fn close_browser_tab(app: AppHandle, webview: Webview, id: String) -> AppResult<()> {
    browser::owned(&app, &webview, &id)?;
    browser::close(&app, &id)
}
#[tauri::command]
pub async fn rename_browser_tab(
    app: AppHandle,
    webview: Webview,
    id: String,
    title: String,
) -> AppResult<()> {
    browser::owned(&app, &webview, &id)?;
    let title = title.trim().chars().take(160).collect::<String>();
    if title.is_empty() {
        return Err(AppError::new("browser_title", "请输入标签名称。"));
    }
    browser::rename(&app, &id, title);
    Ok(())
}
#[tauri::command]
pub async fn detach_browser_tab(app: AppHandle, webview: Webview, id: String) -> AppResult<()> {
    browser::owned(&app, &webview, &id)?;
    browser::detach(&app, &id)
}
#[tauri::command]
pub async fn mount_browser(
    app: AppHandle,
    webview: Webview,
    id: String,
    url: String,
    bounds: BrowserBounds,
    navigate: bool,
) -> AppResult<()> {
    browser::mount(&app, &webview, &id, &url, bounds, navigate)
}
#[tauri::command]
pub async fn resize_browser(
    app: AppHandle,
    webview: Webview,
    id: String,
    bounds: BrowserBounds,
    visible: bool,
) -> AppResult<()> {
    browser::resize(&app, &webview, &id, bounds, visible)
}
#[tauri::command]
pub async fn browser_action(
    app: AppHandle,
    webview: Webview,
    id: String,
    action: String,
) -> AppResult<()> {
    browser::owned(&app, &webview, &id)?;
    browser::action(&app, &id, &action)
}
#[tauri::command]
pub async fn open_browser_external(
    app: AppHandle,
    webview: Webview,
    url: String,
    browser: String,
) -> AppResult<()> {
    browser::trusted(&webview)?;
    let url = browser::parse_url(&app, &url)?;
    browser::external::open(&app, url.as_str(), &browser)
}
