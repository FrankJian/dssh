//! Native browser regression, without a model provider, SSH or the user's database.
//! Run with `cargo run --example browser_smoke` on macOS / Windows with a desktop session.
use dssh_lib::{browser, models::browser::BrowserBounds};
use serde_json::{Value, json};
use std::{
    io::{Read, Write},
    net::TcpListener,
    time::Duration,
};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

const PAGE: &str = r#"<!doctype html><meta charset="utf-8"><title>Browser smoke</title>
<h1>Browser smoke</h1><input id="note" placeholder="Review note">
<input type="password" value="sensitive-field-placeholder">
<button onclick="this.textContent='Clicked'">Mark done</button>"#;

fn fixture() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind test server");
    let url = format!("http://{}/", listener.local_addr().unwrap());
    std::thread::spawn(move || {
        for mut stream in listener.incoming().flatten() {
            let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
            let mut request = [0; 4096];
            let size = stream.read(&mut request).unwrap_or(0);
            let headers = String::from_utf8_lossy(&request[..size]).to_ascii_lowercase();
            // Reproduce sites which refresh forever for WKWebView's incomplete
            // default UA. Exercise the real HTTP header, not a constant match.
            let complete_browser_ua = !cfg!(target_os = "macos")
                || headers.lines().any(|line| {
                    line.starts_with("user-agent:")
                        && line.contains("version/")
                        && line.contains("safari/")
                });
            let body = if complete_browser_ua {
                PAGE
            } else {
                r#"<!doctype html><meta http-equiv="refresh" content="0">"#
            };
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = stream.write_all(response.as_bytes());
        }
    });
    url
}
async fn tool(app: &AppHandle, name: &str, args: Value) -> Value {
    let (output, failed) = browser::ai::execute(app, name, &args).await;
    assert!(!failed, "{name}: {output}");
    serde_json::from_str(&output).unwrap()
}
async fn value(app: &AppHandle, id: &str) -> String {
    let view = app.get_webview(&format!("web-content-{id}")).unwrap();
    let (tx, rx) = tokio::sync::oneshot::channel();
    let tx = std::sync::Mutex::new(Some(tx));
    view.eval_with_callback("document.getElementById('note').value", move |value| {
        if let Some(tx) = tx.lock().unwrap().take() {
            let _ = tx.send(value);
        }
    })
    .unwrap();
    let raw = tokio::time::timeout(Duration::from_secs(5), rx)
        .await
        .unwrap()
        .unwrap();
    serde_json::from_str(&raw).unwrap()
}
async fn check(app: AppHandle, url: String) {
    let tab = browser::create(&app, Some(url.clone())).unwrap();
    let root = app.get_webview("main").unwrap();
    browser::mount(
        &app,
        &root,
        &tab.id,
        &url,
        BrowserBounds {
            x: 0.0,
            y: 0.0,
            width: 640.0,
            height: 400.0,
        },
        false,
    )
    .unwrap();
    let snapshot = tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            let (result, failed) =
                browser::ai::execute(&app, "browser_read", &json!({"page_id":tab.id})).await;
            if !failed
                && let Ok(value) = serde_json::from_str::<Value>(&result)
                && value["title"] == "Browser smoke"
            {
                break value;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("page load");
    assert!(!snapshot.to_string().contains("sensitive-field-placeholder"));
    assert!(
        !snapshot["elements"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["type"] == "password")
    );
    let note = snapshot["elements"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["label"] == "Review note")
        .unwrap()["element"]
        .clone();
    let input = "quoted \" text; no script execution";
    let args = json!({"page_id":tab.id,"url":url,"element":note,"action":"fill","text":input});
    let confirmation = browser::ai::confirmation_args(&app, "browser_interact", &args).await;
    assert_eq!(confirmation["target_element"]["label"], "Review note");
    assert_eq!(
        tool(&app, "browser_interact", args.clone()).await["filled"],
        true
    );
    assert_eq!(value(&app, &tab.id).await, input);
    assert!(
        browser::ai::execute(&app, "browser_interact", &args)
            .await
            .1,
        "old element refs must expire"
    );
    browser::detach(&app, &tab.id).unwrap();
    assert_ne!(browser::get(&app, &tab.id).unwrap().owner, "main");
    assert_eq!(value(&app, &tab.id).await, input);
    let owner = browser::get(&app, &tab.id).unwrap().owner;
    assert!(owner.starts_with("detached-workbench-"));
    let second = browser::create_owned(&app, None, &owner).unwrap();
    assert_eq!(browser::list(&app, &owner).tabs.len(), 2);
    assert!(
        browser::list(&app, "main")
            .tabs
            .iter()
            .all(|item| item.id != second.id)
    );
    browser::close(&app, &second.id).unwrap();
    assert!(
        app.get_window(&owner).is_some(),
        "closing a browser tab must retain its workbench"
    );
    browser::attach(&app, &tab.id).unwrap();
    assert_eq!(browser::get(&app, &tab.id).unwrap().owner, "main");
    assert!(
        app.get_window(&owner).is_some(),
        "moving a browser must not destroy the source workbench"
    );
    app.get_window(&owner).unwrap().destroy().unwrap();
    assert_eq!(value(&app, &tab.id).await, input);
    let fresh = tool(&app, "browser_read", json!({"page_id":tab.id})).await;
    let button = fresh["elements"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["label"] == "Mark done")
        .unwrap()["element"]
        .clone();
    let wrong = json!({"page_id":tab.id,"url":"https://example.invalid/","element":button,"action":"click"});
    assert!(
        browser::ai::execute(&app, "browser_interact", &wrong)
            .await
            .1
    );
    tool(
        &app,
        "browser_interact",
        json!({"page_id":tab.id,"url":url,"element":button,"action":"click"}),
    )
    .await;
    let final_page = tool(&app, "browser_read", json!({"page_id":tab.id})).await;
    assert!(final_page["text"].as_str().unwrap().contains("Clicked"));
    browser::close(&app, &tab.id).unwrap();
    assert!(browser::all(&app).is_empty());
    assert!(
        app.get_webview(&format!("web-content-{}", tab.id))
            .is_none()
    );
}
fn main() {
    let url = fixture();
    let mut context = dssh_lib::application_context();
    context.config_mut().app.windows.clear();
    tauri::Builder::default().manage(browser::BrowserManager::default()).manage(dssh_lib::workspace::DetachedWorkspaceManager::default())
        .invoke_handler(browser::guard(|_|false))
        .setup(move |app| {
            WebviewWindowBuilder::new(app,"main",WebviewUrl::External("about:blank".parse().unwrap())).build()?;
            let handle=app.handle().clone(); let check_handle=handle.clone();
            tauri::async_runtime::spawn(async move {
                let result=tauri::async_runtime::spawn(check(check_handle,url)).await;
                if let Err(error)=result { eprintln!("browser smoke failed: {error}"); handle.exit(1); }
                else { println!("browser smoke passed: read, sensitive-field exclusion, confirmation metadata, fill, stale references, URL binding, click, detach/attach state, close"); handle.exit(0); }
            }); Ok(())
        }).run(context).expect("run native browser regression");
}
