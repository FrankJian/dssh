//! One explicit menu tree per context; never mutate the OS-generated default menu.
use std::{
    collections::{HashMap, HashSet},
    sync::Mutex,
};
use tauri::{
    AppHandle, Emitter, Manager,
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
};

#[derive(Clone, Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorMenuItem {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub enabled: bool,
    pub accelerator: Option<String>,
    #[serde(default)]
    pub children: Vec<EditorMenuItem>,
}
#[derive(Clone, Default)]
struct Context {
    active: bool,
    text_input: bool,
    menus: Vec<EditorMenuItem>,
}
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeEditorCommand {
    owner_label: String,
    command: String,
}

fn valid_menus(menus: &[EditorMenuItem]) -> bool {
    fn visit(
        items: &[EditorMenuItem],
        depth: usize,
        count: &mut usize,
        ids: &mut HashSet<String>,
    ) -> bool {
        if depth > 2 && !items.is_empty() {
            return false;
        }
        for item in items {
            *count += 1;
            if *count > 320
                || item.id.is_empty()
                || item.id.len() > 180
                || item.label.is_empty()
                || item.label.chars().count() > 160
                || item.accelerator.as_ref().is_some_and(|a| a.len() > 80)
                || !ids.insert(item.id.clone())
                || !visit(&item.children, depth + 1, count, ids)
            {
                return false;
            }
        }
        true
    }
    menus.len() <= 8 && visit(menus, 0, &mut 0, &mut HashSet::new())
}

pub struct NativeEditorMenus {
    normal: Menu<tauri::Wry>,
    contexts: Mutex<HashMap<String, Context>>,
}
impl NativeEditorMenus {
    pub fn new(app: &AppHandle) -> tauri::Result<Self> {
        let normal = base_menu(app)?;
        #[cfg(target_os = "macos")]
        app.set_menu(normal.clone())?;
        Ok(Self {
            normal,
            contexts: Mutex::new(HashMap::new()),
        })
    }
    pub fn set_context(
        &self,
        app: &AppHandle,
        owner: &str,
        active: bool,
        text_input: bool,
        menus: Vec<EditorMenuItem>,
    ) -> tauri::Result<()> {
        if let Ok(mut contexts) = self.contexts.lock() {
            contexts.insert(
                owner.into(),
                Context {
                    active,
                    text_input,
                    menus,
                },
            );
        }
        if app
            .get_webview_window(owner)
            .is_some_and(|w| w.is_focused().unwrap_or(false))
        {
            self.focus(app, owner)?;
        }
        Ok(())
    }
    pub fn focus(&self, app: &AppHandle, owner: &str) -> tauri::Result<()> {
        let context = self
            .contexts
            .lock()
            .ok()
            .and_then(|c| c.get(owner).cloned())
            .unwrap_or_default();
        let active = context.active
            && app
                .state::<crate::app::AppState>()
                .app_lock
                .status()
                .is_ok_and(|s| !s.locked);
        let menu = if active && !context.menus.is_empty() {
            let menu = application_menu(app)?;
            for item in &context.menus {
                let submenu = Submenu::new(app, &item.label, true)?;
                append_items(app, &submenu, &item.children, context.text_input)?;
                menu.append(&submenu)?;
            }
            append_window_menu(app, &menu)?;
            menu
        } else {
            self.normal.clone()
        };
        #[cfg(target_os = "macos")]
        app.set_menu(menu)?;
        #[cfg(not(target_os = "macos"))]
        if let Some(window) = app.get_webview_window(owner) {
            if active {
                window.set_menu(menu)?;
            } else {
                window.remove_menu()?;
            }
        }
        Ok(())
    }
    pub fn remove(&self, owner: &str) {
        if let Ok(mut contexts) = self.contexts.lock() {
            contexts.remove(owner);
        }
    }
    pub fn dispatch(&self, app: &AppHandle, id: &str) {
        if id == "application.quit" {
            crate::application_exit::ApplicationExit::request(app, 0);
            return;
        }
        let Some(window) = app
            .webview_windows()
            .into_values()
            .find(|w| w.is_focused().unwrap_or(false))
        else {
            return;
        };
        if id == "application.closeWindow" {
            let _ = window.close();
            return;
        }
        let context = self
            .contexts
            .lock()
            .ok()
            .and_then(|c| c.get(window.label()).cloned())
            .unwrap_or_default();
        if !context.active
            || !app
                .state::<crate::app::AppState>()
                .app_lock
                .status()
                .is_ok_and(|s| !s.locked)
        {
            return;
        }
        let Some(command) = id.strip_prefix("editor.action:") else {
            return;
        };
        fn enabled(items: &[EditorMenuItem], id: &str) -> bool {
            items.iter().any(|item| {
                (item.id == id && item.enabled && item.children.is_empty())
                    || (item.enabled && enabled(&item.children, id))
            })
        }
        if !enabled(&context.menus, command) {
            return;
        }
        let _ = app.emit_to(
            window.label(),
            "editor://native-menu",
            NativeEditorCommand {
                owner_label: window.label().into(),
                command: command.into(),
            },
        );
    }
}
fn application_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::new(app)?;
    #[cfg(target_os = "macos")]
    {
        let application = Submenu::new(app, "Duo SSH", true)?;
        application.append(&PredefinedMenuItem::about(app, Some("关于 Duo SSH"), None)?)?;
        application.append(&PredefinedMenuItem::separator(app)?)?;
        application.append(&PredefinedMenuItem::services(app, Some("服务"))?)?;
        application.append(&PredefinedMenuItem::separator(app)?)?;
        application.append(&PredefinedMenuItem::hide(app, Some("隐藏 Duo SSH"))?)?;
        application.append(&PredefinedMenuItem::hide_others(app, Some("隐藏其他应用"))?)?;
        application.append(&PredefinedMenuItem::show_all(app, Some("显示全部"))?)?;
        application.append(&PredefinedMenuItem::separator(app)?)?;
        application.append(&MenuItem::with_id(
            app,
            "application.quit",
            "退出 Duo SSH",
            true,
            Some("Cmd+Q"),
        )?)?;
        menu.append(&application)?;
    }
    Ok(menu)
}
fn append_window_menu(app: &AppHandle, menu: &Menu<tauri::Wry>) -> tauri::Result<()> {
    let window = Submenu::new(app, "窗口", true)?;
    window.append(&PredefinedMenuItem::minimize(app, Some("最小化"))?)?;
    window.append(&PredefinedMenuItem::maximize(app, Some("缩放"))?)?;
    window.append(&PredefinedMenuItem::fullscreen(app, Some("全屏"))?)?;
    window.append(&PredefinedMenuItem::separator(app)?)?;
    window.append(&MenuItem::with_id(
        app,
        "application.closeWindow",
        "关闭窗口",
        true,
        None::<&str>,
    )?)?;
    menu.append(&window)
}
fn base_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = application_menu(app)?;
    let edit = Submenu::new(app, "编辑", true)?;
    edit.append(&PredefinedMenuItem::undo(app, Some("撤销"))?)?;
    edit.append(&PredefinedMenuItem::redo(app, Some("重做"))?)?;
    append_clipboard(app, &edit)?;
    menu.append(&edit)?;
    append_window_menu(app, &menu)?;
    Ok(menu)
}
fn append_clipboard(app: &AppHandle, menu: &Submenu<tauri::Wry>) -> tauri::Result<()> {
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&PredefinedMenuItem::cut(app, Some("剪切"))?)?;
    menu.append(&PredefinedMenuItem::copy(app, Some("复制"))?)?;
    menu.append(&PredefinedMenuItem::paste(app, Some("粘贴"))?)?;
    menu.append(&PredefinedMenuItem::select_all(app, Some("全选"))?)?;
    Ok(())
}
fn append_items(
    app: &AppHandle,
    parent: &Submenu<tauri::Wry>,
    items: &[EditorMenuItem],
    text_input: bool,
) -> tauri::Result<()> {
    for item in items {
        if !item.children.is_empty() {
            let child = Submenu::new(app, &item.label, item.enabled)?;
            append_items(app, &child, &item.children, text_input)?;
            parent.append(&child)?;
        } else if text_input && item.id.ends_with("/undo") {
            parent.append(&PredefinedMenuItem::undo(app, Some("撤销"))?)?;
        } else if text_input && item.id.ends_with("/redo") {
            parent.append(&PredefinedMenuItem::redo(app, Some("重做"))?)?;
        } else {
            let id = format!("editor.action:{}", item.id);
            let entry = MenuItem::with_id(
                app,
                &id,
                &item.label,
                item.enabled,
                item.accelerator.as_deref(),
            )
            .or_else(|_| MenuItem::with_id(app, &id, &item.label, item.enabled, None::<&str>))?;
            parent.append(&entry)?;
        }
    }
    if items.iter().any(|i| i.id.ends_with("/undo")) {
        append_clipboard(app, parent)?;
    }
    Ok(())
}

#[tauri::command]
pub fn editor_set_native_context(
    caller: tauri::Webview,
    active: bool,
    menus: Option<Vec<EditorMenuItem>>,
    text_input: Option<bool>,
) -> crate::error::AppResult<()> {
    crate::browser::trusted(&caller)?;
    let menus = menus.unwrap_or_default();
    if !valid_menus(&menus) {
        return Err(crate::error::AppError::new(
            "editor_native_menu",
            "编辑器菜单内容无效。",
        ));
    }
    let app = caller.app_handle();
    let unlocked = !app
        .state::<crate::app::AppState>()
        .app_lock
        .status()?
        .locked;
    app.state::<NativeEditorMenus>()
        .set_context(
            app,
            caller.label(),
            active && unlocked,
            text_input.unwrap_or(false),
            menus,
        )
        .map_err(|_| {
            crate::error::AppError::new("editor_native_menu", "无法切换编辑器菜单，请重试。")
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn leaf(id: &str) -> EditorMenuItem {
        EditorMenuItem {
            id: id.into(),
            label: "菜单".into(),
            enabled: true,
            ..Default::default()
        }
    }
    #[test]
    fn menu_contract_rejects_duplicates_depth_and_unbounded_payloads() {
        assert!(valid_menus(&[EditorMenuItem {
            children: vec![leaf("file/save")],
            ..leaf("file")
        }]));
        assert!(!valid_menus(&[leaf("same"), leaf("same")]));
        let mut node = leaf("deep");
        for i in 0..4 {
            node = EditorMenuItem {
                children: vec![node],
                ..leaf(&format!("node{i}"))
            };
        }
        assert!(!valid_menus(&[node]));
        assert!(!valid_menus(
            &(0..9)
                .map(|n| leaf(&format!("menu{n}")))
                .collect::<Vec<_>>()
        ));
    }
}
