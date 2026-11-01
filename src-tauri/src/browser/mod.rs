use std::{
    collections::BTreeMap,
    sync::{
        Mutex,
        atomic::{AtomicU64, Ordering},
    },
};

use crate::{
    error::{AppError, AppResult},
    models::browser::{BrowserBounds, BrowserTab, BrowserTabsEvent},
};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Url, Webview, WebviewUrl,
    webview::{NewWindowResponse, PageLoadEvent, WebviewBuilder},
};

pub mod ai;
pub mod external;

#[derive(Default)]
struct Tabs {
    revision: u64,
    tabs: BTreeMap<String, BrowserTab>,
}
#[derive(Default)]
pub struct BrowserManager {
    tabs: Mutex<Tabs>,
}
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

// WKWebView's default UA omits the Safari product/version tokens. Some sites
// (including Baidu) respond by redirecting to the same URL indefinitely. Use
// a complete, stable Safari compatibility identity for browser content only;
// Windows keeps its native WebView2 identity.
#[cfg(target_os = "macos")]
const MACOS_BROWSER_USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

// Remote content (including local-origin frames) cannot invoke any custom command.
// Core and plugin commands are separately denied by capabilities.
pub fn guard(
    handler: impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static,
) -> impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static {
    move |invoke| {
        if invoke
            .message
            .webview_ref()
            .label()
            .starts_with("web-content-")
        {
            invoke
                .resolver
                .reject("Web content cannot invoke application commands");
            true
        } else {
            handler(invoke)
        }
    }
}
fn error(error: tauri::Error) -> AppError {
    AppError::new("browser_error", error.to_string())
}
fn missing() -> AppError {
    AppError::new("browser_missing", "浏览器页面已关闭。")
}
fn label(id: &str) -> String {
    format!("web-content-{id}")
}
pub fn trusted(caller: &Webview) -> AppResult<()> {
    let id = caller.label();
    if id == caller.window_ref().label()
        && (id == "main" || id.starts_with("browser-ui-") || id.starts_with("detached-"))
    {
        Ok(())
    } else {
        Err(AppError::new("browser_access", "此操作仅限应用工具栏。"))
    }
}
pub fn all(app: &AppHandle) -> Vec<BrowserTab> {
    app.state::<BrowserManager>()
        .tabs
        .lock()
        .unwrap()
        .tabs
        .values()
        .cloned()
        .collect()
}
pub fn get(app: &AppHandle, id: &str) -> AppResult<BrowserTab> {
    app.state::<BrowserManager>()
        .tabs
        .lock()
        .unwrap()
        .tabs
        .get(id)
        .cloned()
        .ok_or_else(missing)
}
pub fn owned(app: &AppHandle, caller: &Webview, id: &str) -> AppResult<BrowserTab> {
    trusted(caller)?;
    let tab = get(app, id)?;
    if tab.owner != caller.label() {
        return Err(AppError::new("browser_access", "页面已移动到其他窗口。"));
    }
    Ok(tab)
}
pub fn list(app: &AppHandle, owner: &str) -> BrowserTabsEvent {
    let manager = app.state::<BrowserManager>();
    let tabs = manager.tabs.lock().unwrap();
    BrowserTabsEvent {
        revision: tabs.revision,
        tabs: tabs
            .tabs
            .values()
            .filter(|t| t.owner == owner)
            .cloned()
            .collect(),
        active_id: None,
    }
}
fn notify(app: &AppHandle, active_id: Option<&str>) {
    let events = {
        let manager = app.state::<BrowserManager>();
        let mut state = manager.tabs.lock().unwrap();
        state.revision += 1;
        let mut owners = vec!["main".to_owned()];
        owners.extend(state.tabs.values().map(|t| t.owner.clone()));
        owners.extend(
            app.windows()
                .keys()
                .filter(|label| label.starts_with("detached-"))
                .cloned(),
        );
        owners.sort();
        owners.dedup();
        owners
            .into_iter()
            .map(|owner| {
                let tabs: Vec<_> = state
                    .tabs
                    .values()
                    .filter(|t| t.owner == owner)
                    .cloned()
                    .collect();
                let active_id = active_id
                    .filter(|id| tabs.iter().any(|t| t.id == *id))
                    .map(str::to_owned);
                (
                    owner,
                    BrowserTabsEvent {
                        revision: state.revision,
                        tabs,
                        active_id,
                    },
                )
            })
            .collect::<Vec<_>>()
    };
    for (owner, event) in events {
        let _ = app.emit_to(owner, "browser://tabs-changed", event);
    }
}
fn update(app: &AppHandle, id: &str, change: impl FnOnce(&mut BrowserTab)) {
    {
        let manager = app.state::<BrowserManager>();
        let mut state = manager.tabs.lock().unwrap();
        if let Some(tab) = state.tabs.get_mut(id) {
            change(tab);
        } else {
            return;
        }
    }
    notify(app, None);
}
fn allowed_url(url: &Url, dev: Option<&Url>) -> bool {
    matches!(url.scheme(), "http" | "https")
        && url.host_str().is_some()
        && url.username().is_empty()
        && url.password().is_none()
        && !matches!(url.host_str(), Some("tauri.localhost" | "asset.localhost"))
        && dev.is_none_or(|dev| dev.origin() != url.origin())
}
fn allowed(app: &AppHandle, url: &Url) -> bool {
    allowed_url(url, app.config().build.dev_url.as_ref())
}
pub fn parse_url(app: &AppHandle, input: &str) -> AppResult<Url> {
    let url = normalize_url(input)?;
    if !allowed(app, &url) {
        return Err(AppError::new("browser_url", "不允许访问应用内部地址。"));
    }
    Ok(url)
}
fn normalize_url(input: &str) -> AppResult<Url> {
    let input = input.trim();
    let value = if input.contains("://") {
        input.to_owned()
    } else {
        format!("https://{input}")
    };
    let url = Url::parse(&value)
        .map_err(|_| AppError::new("browser_url", "请输入有效的 HTTP / HTTPS 地址。"))?;
    if input.is_empty()
        || !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(AppError::new(
            "browser_url",
            "仅支持 HTTP / HTTPS 地址，请勿在地址中填写用户名或密码。",
        ));
    }
    Ok(url)
}
pub fn create(app: &AppHandle, input: Option<String>) -> AppResult<BrowserTab> {
    create_owned(app, input, "main")
}

pub fn create_owned(app: &AppHandle, input: Option<String>, owner: &str) -> AppResult<BrowserTab> {
    let url = input
        .map(|s| parse_url(app, &s))
        .transpose()?
        .map(|u| u.to_string())
        .unwrap_or_default();
    let tab = BrowserTab {
        id: format!("browser-{}", NEXT_ID.fetch_add(1, Ordering::Relaxed)),
        owner: owner.into(),
        title: "浏览器".into(),
        url,
        loading: false,
        custom_title: false,
    };
    app.state::<BrowserManager>()
        .tabs
        .lock()
        .unwrap()
        .tabs
        .insert(tab.id.clone(), tab.clone());
    notify(app, Some(&tab.id));
    Ok(tab)
}
pub fn rename(app: &AppHandle, id: &str, title: String) {
    update(app, id, |tab| {
        tab.title = title;
        tab.custom_title = true;
    });
}
pub fn close(app: &AppHandle, id: &str) -> AppResult<()> {
    let tab = get(app, id)?;
    if let Some(view) = app.get_webview(&label(id)) {
        view.close().map_err(error)?;
    }
    app.state::<BrowserManager>()
        .tabs
        .lock()
        .unwrap()
        .tabs
        .remove(id);
    notify(app, None);
    if tab.owner.starts_with("browser-ui-")
        && let Some(window) = app.get_window(&tab.owner)
    {
        window.destroy().map_err(error)?;
    }
    Ok(())
}
pub fn detach(app: &AppHandle, id: &str) -> AppResult<()> {
    let tab = get(app, id)?;
    let workspace = app
        .state::<crate::workspace::DetachedWorkspaceManager>()
        .open_workbench(app, tab.title.clone())?;
    if let Err(cause) = move_to(app, id, &workspace.label) {
        let _ = app
            .state::<crate::workspace::DetachedWorkspaceManager>()
            .discard(&workspace.label);
        if let Some(window) = app.get_window(&workspace.label) {
            let _ = window.destroy();
        }
        return Err(cause);
    }
    Ok(())
}

/// Reparent the live content WebView without navigating or destroying its source workbench.
pub fn move_to(app: &AppHandle, id: &str, owner: &str) -> AppResult<()> {
    let target = app.get_window(owner).ok_or_else(missing)?;
    if let Some(view) = app.get_webview(&label(id)) {
        view.hide().map_err(error)?;
        view.reparent(&target).map_err(error)?;
    }
    update(app, id, |tab| tab.owner = owner.into());
    notify(app, Some(id));
    Ok(())
}

pub fn attach(app: &AppHandle, id: &str) -> AppResult<()> {
    let tab = get(app, id)?;
    move_to(app, id, "main")?;
    if tab.owner.starts_with("browser-ui-")
        && let Some(window) = app.get_window(&tab.owner)
    {
        window.destroy().map_err(error)?;
    }
    Ok(())
}
fn validate_bounds(bounds: &BrowserBounds) -> AppResult<()> {
    if [bounds.x, bounds.y, bounds.width, bounds.height]
        .iter()
        .any(|v| !v.is_finite())
        || bounds.x < 0.0
        || bounds.y < 0.0
        || bounds.width < 1.0
        || bounds.height < 1.0
    {
        return Err(AppError::new("browser_bounds", "浏览区域尺寸无效。"));
    }
    Ok(())
}
pub fn mount(
    app: &AppHandle,
    caller: &Webview,
    id: &str,
    input: &str,
    bounds: BrowserBounds,
    navigate: bool,
) -> AppResult<()> {
    owned(app, caller, id)?;
    let url = parse_url(app, input)?;
    validate_bounds(&bounds)?;
    if let Some(view) = app.get_webview(&label(id)) {
        return if navigate {
            view.navigate(url).map_err(error)
        } else {
            Ok(())
        };
    }
    let nav_app = app.clone();
    let popup_app = app.clone();
    let popup_id = id.to_owned();
    let load_id = id.to_owned();
    let title_id = id.to_owned();
    let builder = WebviewBuilder::new(label(id), WebviewUrl::External(url))
        .devtools(false)
        .focused(false);
    #[cfg(target_os = "macos")]
    let builder = builder.user_agent(MACOS_BROWSER_USER_AGENT);
    let builder = builder
        .initialization_script(r#"document.addEventListener('click', event => { const a=event.target instanceof Element?event.target.closest('a'):null; if(a && a.target.toLowerCase()==='_blank') a.target='_self'; },true);"#)
        .on_navigation(move |url| allowed(&nav_app,url))
        .on_new_window(move |url,_| { if allowed(&popup_app,&url) {
            let app=popup_app.clone(); let id=popup_id.clone(); tauri::async_runtime::spawn(async move { if let Some(view)=app.get_webview(&label(&id)) { let _=view.navigate(url); } });
        } NewWindowResponse::Deny })
        .on_download(|_,_|false)
        .on_document_title_changed(move |view,title| { update(view.app_handle(), &title_id, |tab| { if !tab.custom_title { tab.title=title.chars().take(160).collect(); } }); })
        .on_page_load(move |view,payload| { update(view.app_handle(),&load_id,|tab| { tab.url=payload.url().to_string(); tab.loading=matches!(payload.event(),PageLoadEvent::Started); }); });
    // Do not hold window_ref() across add_child: it waits for the UI thread,
    // which may need the same mutex to dispatch another incoming IPC message.
    let view = caller
        .window()
        .add_child(
            builder,
            LogicalPosition::new(bounds.x, bounds.y),
            LogicalSize::new(bounds.width, bounds.height),
        )
        .map_err(error)?;
    view.hide().map_err(error)?;
    Ok(())
}
pub fn resize(
    app: &AppHandle,
    caller: &Webview,
    id: &str,
    bounds: BrowserBounds,
    visible: bool,
) -> AppResult<()> {
    owned(app, caller, id)?;
    if let Some(view) = app.get_webview(&label(id)) {
        if !visible {
            return view.hide().map_err(error);
        }
        validate_bounds(&bounds)?;
        view.set_bounds(tauri::Rect {
            position: LogicalPosition::new(bounds.x, bounds.y).into(),
            size: LogicalSize::new(bounds.width, bounds.height).into(),
        })
        .map_err(error)?;
        view.show().map_err(error)?;
    }
    Ok(())
}
pub fn action(app: &AppHandle, id: &str, action: &str) -> AppResult<()> {
    let view = app
        .get_webview(&label(id))
        .ok_or_else(|| AppError::new("browser_missing", "请先打开网页。"))?;
    let script = match action {
        "back" => "window.history.back()",
        "forward" => "window.history.forward()",
        "reload" => "window.location.reload()",
        "stop" => "window.stop()",
        _ => return Err(AppError::new("browser_action", "不支持的浏览器操作。")),
    };
    view.eval(script).map_err(error)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn web_content_cannot_navigate_to_application_origins() {
        let dev = Url::parse("http://localhost:1420/").unwrap();
        for input in [
            "tauri://localhost",
            "file:///tmp/test.html",
            "http://tauri.localhost/",
            "https://asset.localhost/",
            "http://localhost:1420/index.html",
        ] {
            assert!(
                !allowed_url(&Url::parse(input).unwrap(), Some(&dev)),
                "{input}"
            );
        }
        for input in [
            "https://example.com",
            "http://localhost:8080/",
            "http://127.0.0.1:8080/",
        ] {
            assert!(
                allowed_url(&Url::parse(input).unwrap(), Some(&dev)),
                "{input}"
            );
        }
    }
    #[test]
    fn validate_addresses() {
        assert_eq!(
            normalize_url("example.com").unwrap().as_str(),
            "https://example.com/"
        );
        assert_eq!(
            normalize_url("http://127.0.0.1:8080/a").unwrap().port(),
            Some(8080)
        );
        assert!(normalize_url("http://[::1]:8080").is_ok());
        for input in [
            "",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "data:text/html,test",
            "tauri://localhost",
            "https://user:secret@example.com",
            "http://",
        ] {
            assert!(normalize_url(input).is_err(), "{input}");
        }
    }
}
