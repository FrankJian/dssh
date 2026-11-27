//! Native quit is a request, not permission to discard work in another window.
use crate::{
    app::AppState,
    error::{AppError, AppResult},
};
use std::sync::{
    Mutex,
    atomic::{AtomicBool, Ordering},
};
use tauri::{AppHandle, Emitter, Manager, Webview};
use tokio::sync::oneshot;

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ExitRequest {
    owner_label: String,
    request_id: String,
    phase: &'static str,
}
struct Waiting {
    id: String,
    owner: String,
    phase: String,
    reply: oneshot::Sender<bool>,
}
#[derive(Default)]
pub struct ApplicationExit {
    busy: AtomicBool,
    allowed: AtomicBool,
    waiting: Mutex<Option<Waiting>>,
    window_creation: Mutex<()>,
}
impl ApplicationExit {
    pub fn allowed(&self) -> bool {
        self.allowed.load(Ordering::SeqCst)
    }
    fn after_window_creation<T>(&self, action: impl FnOnce() -> T) -> AppResult<T> {
        let _guard = self
            .window_creation
            .lock()
            .map_err(|_| AppError::new("application_exit", "无法确认窗口状态，请重试。"))?;
        Ok(action())
    }
    fn try_after_window_creation<T>(&self, action: impl FnOnce() -> T) -> AppResult<Option<T>> {
        match self.window_creation.try_lock() {
            Ok(_guard) => Ok(Some(action())),
            Err(std::sync::TryLockError::WouldBlock) => Ok(None),
            Err(_) => Err(AppError::new(
                "application_exit",
                "无法确认窗口状态，请重试。",
            )),
        }
    }
    /// An in-flight build finishes before the quit snapshot; later builds fail closed.
    pub fn with_window_creation<T>(&self, create: impl FnOnce() -> AppResult<T>) -> AppResult<T> {
        self.after_window_creation(|| {
            if self.busy.load(Ordering::SeqCst) || self.allowed() {
                return Err(AppError::new(
                    "application_exit_pending",
                    "正在确认退出，请取消退出后再打开独立窗口。",
                ));
            }
            create()
        })?
    }
    fn owners(app: &AppHandle) -> Vec<String> {
        let manager = app.state::<crate::workspace::DetachedWorkspaceManager>();
        let mut owners: Vec<_> = app
            .webview_windows()
            .keys()
            .filter(|label| label.as_str() == "main" || manager.get(label).ok().flatten().is_some())
            .cloned()
            .collect();
        owners.sort();
        owners
    }
    fn unlocked(app: &AppHandle) -> bool {
        app.state::<AppState>()
            .app_lock
            .status()
            .is_ok_and(|status| !status.locked)
    }
    fn participants_valid(app: &AppHandle, expected: &[String], committing: bool) -> bool {
        let live: Vec<_> = app.webview_windows().into_keys().collect();
        participant_set_valid(expected, &Self::owners(app), &live, committing)
    }
    async fn ask(
        app: &AppHandle,
        owner: &str,
        request: ExitRequest,
        deadline: tokio::time::Instant,
        owners: &[String],
    ) -> bool {
        let (reply, response) = oneshot::channel();
        let state = app.state::<Self>();
        if let Ok(mut waiting) = state.waiting.lock() {
            *waiting = Some(Waiting {
                id: request.request_id.clone(),
                owner: owner.into(),
                phase: request.phase.into(),
                reply,
            });
        } else {
            return false;
        }
        let committing = request.phase == "commit";
        let delivered = app
            .emit_to(owner, "workspace://application-exit", request)
            .is_ok();
        let result = if delivered {
            tokio::time::timeout_at(deadline, async {
                let mut response = response;
                let mut heartbeat = tokio::time::interval(std::time::Duration::from_millis(100));
                loop {
                    tokio::select! {
                        reply = &mut response => return reply.unwrap_or(false),
                        _ = heartbeat.tick() => {
                            if !Self::unlocked(app) || !Self::participants_valid(app, owners, committing) { return false; }
                        }
                    }
                }
            }).await.unwrap_or(false)
        } else {
            false
        };
        if let Ok(mut waiting) = state.waiting.lock() {
            *waiting = None;
        }
        result
    }
    pub fn request(app: &AppHandle, code: i32) {
        if app.state::<Self>().busy.swap(true, Ordering::SeqCst) {
            return;
        }
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            // Cocoa permits at most two minutes during logout; keep the entire
            // multi-window decision, not each window, inside a shorter budget.
            let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(90);
            let owners = loop {
                let snapshot = app
                    .state::<Self>()
                    .try_after_window_creation(|| Self::owners(&app));
                match snapshot {
                    Ok(Some(owners)) => break owners,
                    Ok(None) if tokio::time::Instant::now() < deadline => {
                        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
                    }
                    _ => break Vec::new(),
                }
            };
            let id = format!("quit-{:032x}", rand::random::<u128>());
            let mut success = !owners.is_empty() && Self::unlocked(&app);
            for phase in ["prepare", "validate", "commit"] {
                for owner in &owners {
                    if !success
                        || !Self::unlocked(&app)
                        || !Self::participants_valid(&app, &owners, phase == "commit")
                    {
                        success = false;
                        break;
                    }
                    if phase == "prepare"
                        && let Some(window) = app.get_webview_window(owner)
                    {
                        let _ = window.set_focus();
                    }
                    success = Self::ask(
                        &app,
                        owner,
                        ExitRequest {
                            owner_label: owner.clone(),
                            request_id: id.clone(),
                            phase,
                        },
                        deadline,
                        &owners,
                    )
                    .await;
                }
                if !success {
                    break;
                }
            }
            success =
                success && Self::unlocked(&app) && Self::participants_valid(&app, &owners, true);
            if success {
                app.state::<Self>().allowed.store(true, Ordering::SeqCst);
                #[cfg(target_os = "macos")]
                let replied_to_cocoa = crate::native_application_exit::finish(&app, true);
                #[cfg(not(target_os = "macos"))]
                let replied_to_cocoa = false;
                if !replied_to_cocoa {
                    app.exit(code);
                }
            } else {
                for owner in &owners {
                    let _ = app.emit_to(
                        owner,
                        "workspace://application-exit",
                        ExitRequest {
                            owner_label: owner.clone(),
                            request_id: id.clone(),
                            phase: "abort",
                        },
                    );
                }
            }
            #[cfg(target_os = "macos")]
            if !success {
                crate::native_application_exit::finish(&app, false);
            }
            app.state::<Self>().busy.store(false, Ordering::SeqCst);
        });
    }
}
fn participant_set_valid(
    expected: &[String],
    registered: &[String],
    live: &[String],
    committing: bool,
) -> bool {
    // Commit may discard ownership records, but must not create or destroy windows.
    expected.iter().all(|owner| live.contains(owner))
        && if committing {
            registered.iter().all(|owner| expected.contains(owner))
        } else {
            registered == expected
        }
}
#[tauri::command]
pub fn application_exit_reply(
    caller: Webview,
    request_id: String,
    phase: String,
    accepted: bool,
) -> AppResult<()> {
    crate::browser::trusted(&caller)?;
    let app = caller.app_handle();
    let state = app.state::<ApplicationExit>();
    state.reply(
        caller.label(),
        &request_id,
        &phase,
        accepted && ApplicationExit::unlocked(app),
    )
}
impl ApplicationExit {
    fn reply(&self, owner: &str, id: &str, phase: &str, accepted: bool) -> AppResult<()> {
        let mut waiting = self
            .waiting
            .lock()
            .map_err(|_| AppError::new("application_exit", "无法处理退出请求，请重试。"))?;
        if waiting
            .as_ref()
            .is_some_and(|item| item.id == id && item.owner == owner && item.phase == phase)
            && let Some(item) = waiting.take()
        {
            let _ = item.reply.send(accepted);
        }
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn window_creation_is_rejected_without_side_effects_until_exit_is_cancelled() {
        let state = ApplicationExit::default();
        let mut created = 0;
        state.busy.store(true, Ordering::SeqCst);
        let error = state
            .with_window_creation(|| {
                created += 1;
                Ok(())
            })
            .unwrap_err();
        assert_eq!(error.code, "application_exit_pending");
        assert_eq!(created, 0);
        state.busy.store(false, Ordering::SeqCst);
        state
            .with_window_creation(|| {
                created += 1;
                Ok(())
            })
            .unwrap();
        assert_eq!(created, 1);
        state.allowed.store(true, Ordering::SeqCst);
        assert!(
            state
                .with_window_creation(|| {
                    created += 1;
                    Ok(())
                })
                .is_err()
        );
        assert_eq!(created, 1);
    }

    #[test]
    fn quit_snapshot_waits_for_a_window_build_that_started_before_quit() {
        use std::sync::{Arc, mpsc};
        let state = Arc::new(ApplicationExit::default());
        let built = Arc::new(AtomicBool::new(false));
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let creation_state = state.clone();
        let creation_built = built.clone();
        let creation = std::thread::spawn(move || {
            creation_state
                .with_window_creation(|| {
                    entered_tx.send(()).unwrap();
                    release_rx
                        .recv_timeout(std::time::Duration::from_secs(5))
                        .unwrap();
                    creation_built.store(true, Ordering::SeqCst);
                    Ok(())
                })
                .unwrap();
        });
        entered_rx
            .recv_timeout(std::time::Duration::from_secs(5))
            .unwrap();
        state.busy.store(true, Ordering::SeqCst);
        assert!(state.window_creation.try_lock().is_err());
        assert!(state.try_after_window_creation(|| false).unwrap().is_none());
        let snapshot_state = state.clone();
        let snapshot = std::thread::spawn(move || {
            snapshot_state
                .after_window_creation(|| built.load(Ordering::SeqCst))
                .unwrap()
        });
        release_tx.send(()).unwrap();
        creation.join().unwrap();
        assert!(snapshot.join().unwrap());
        assert_eq!(
            state.try_after_window_creation(|| true).unwrap(),
            Some(true)
        );
        assert!(state.with_window_creation(|| Ok(())).is_err());
    }

    #[test]
    fn commit_allows_discarded_records_but_rejects_missing_or_unconfirmed_windows() {
        let expected = vec!["detached-workbench-1".into(), "main".into()];
        let main_only = vec!["main".into()];
        assert!(participant_set_valid(
            &expected, &expected, &expected, false
        ));
        assert!(!participant_set_valid(
            &expected, &main_only, &expected, false
        ));
        assert!(participant_set_valid(
            &expected, &main_only, &expected, true
        ));
        assert!(!participant_set_valid(
            &expected, &main_only, &main_only, true
        ));
        let mut added = expected.clone();
        added.push("detached-workbench-2".into());
        assert!(!participant_set_valid(&expected, &added, &added, true));
    }

    #[test]
    fn exit_decisions_are_bound_to_owner_request_and_phase_and_consumed_once() {
        let state = ApplicationExit::default();
        let (reply, mut response) = oneshot::channel();
        *state.waiting.lock().unwrap() = Some(Waiting {
            id: "current".into(),
            owner: "main".into(),
            phase: "prepare".into(),
            reply,
        });
        for (owner, id, phase) in [
            ("other", "current", "prepare"),
            ("main", "stale", "prepare"),
            ("main", "current", "commit"),
        ] {
            state.reply(owner, id, phase, true).unwrap();
            assert!(matches!(
                response.try_recv(),
                Err(oneshot::error::TryRecvError::Empty)
            ));
        }
        state.reply("main", "current", "prepare", false).unwrap();
        assert_eq!(response.try_recv(), Ok(false));
        state.reply("main", "current", "prepare", true).unwrap();
        assert!(state.waiting.lock().unwrap().is_none());
        assert!(!state.allowed());
    }
}
