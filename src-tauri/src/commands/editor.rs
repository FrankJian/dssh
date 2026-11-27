use crate::editor::contracts::EditorFileVersion;
use crate::{
    app::AppState,
    editor::{
        contracts::{
            EditorSavedFile, EditorTextFile, OpenEditorRequest, ReadEditorRequest,
            SaveEditorRequest,
        },
        local, open_context, text,
        workspaces::{EditorWorkspace, FileSource, WorkspaceLease},
    },
    error::{AppError, AppResult},
    models::ssh_profile::SshProfile,
};
use std::path::PathBuf;
use tauri::{Emitter, Manager};
use tauri::{State, Webview};

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct EditorFilesChanged {
    workspace_id: String,
    watch_id: String,
}

#[tauri::command]
pub async fn editor_watch_files(
    caller: Webview,
    state: State<'_, AppState>,
    workspace_id: String,
    paths: Vec<String>,
) -> AppResult<String> {
    unlocked(&caller, &state)?;
    let lease = state.editor.require(caller.label(), &workspace_id)?;
    if lease.workspace.source != FileSource::Local {
        return Err(AppError::new(
            "editor_watch_source",
            "远程文件使用活动文档版本检查。",
        ));
    }
    let watch_id = format!("watch-{:032x}", rand::random::<u128>());
    let watch = if paths.is_empty() {
        None
    } else {
        let app = caller.app_handle().clone();
        let owner = lease.owner.clone();
        let event = EditorFilesChanged {
            workspace_id: workspace_id.clone(),
            watch_id: watch_id.clone(),
        };
        Some(crate::editor::watch::LocalWatch::start(
            paths.into_iter().map(PathBuf::from).collect(),
            move || {
                if lease.ensure_active().is_ok()
                    && app
                        .state::<AppState>()
                        .app_lock
                        .status()
                        .is_ok_and(|status| !status.locked)
                {
                    let _ = app.emit_to(&owner, "editor://files-changed", event.clone());
                }
            },
        )?)
    };
    state
        .editor
        .set_watch(caller.label(), &workspace_id, watch)?;
    Ok(watch_id)
}

pub(super) fn unlocked(caller: &Webview, state: &AppState) -> AppResult<()> {
    crate::browser::trusted(caller)?;
    if state.app_lock.status()?.locked {
        return Err(AppError::new("app_locked", "应用已锁定，请先解锁。"));
    }
    Ok(())
}

#[tauri::command]
pub async fn editor_inspect_file(
    caller: Webview,
    state: State<'_, AppState>,
    workspace_id: String,
    path: String,
) -> AppResult<EditorFileVersion> {
    unlocked(&caller, &state)?;
    let lease = state.editor.require(caller.label(), &workspace_id)?;
    let (path, version_token, read_only, byte_length) = match &lease.workspace.source {
        FileSource::Local => super::blocking(move || local::inspect(&PathBuf::from(path))).await?,
        FileSource::Sftp { profile_id } => {
            let session = state
                .sftp
                .editor_session(&profile(&state, &lease).await?)
                .await?;
            session.inspect(profile_id, &path, &lease).await?
        }
    };
    lease.ensure_active()?;
    unlocked(&caller, &state)?;
    Ok(EditorFileVersion {
        source: lease.workspace.source,
        path,
        version_token,
        read_only,
        byte_length,
    })
}

pub(super) async fn profile(state: &AppState, lease: &WorkspaceLease) -> AppResult<SshProfile> {
    let FileSource::Sftp { profile_id } = &lease.workspace.source else {
        return Err(AppError::new("editor_source", "文件来源无效。"));
    };
    let state = state.clone();
    let id = profile_id.clone();
    let profile = super::blocking(move || super::sftp::require_profile(&state, &id)).await?;
    lease.ensure_profile_version(&profile.updated_at)?;
    Ok(profile)
}

#[tauri::command]
pub async fn editor_open_workspace(
    caller: Webview,
    state: State<'_, AppState>,
    request: OpenEditorRequest,
) -> AppResult<EditorWorkspace> {
    unlocked(&caller, &state)?;
    let (root, initial, version) = match &request.source {
        FileSource::Local => {
            let requested = if request.directory && request.path.is_none() {
                Some(local::display_path(&super::sftp::local_home_path()?)?)
            } else {
                request.path.clone()
            };
            let directory = request.directory;
            let context_root = request.root_path.clone();
            let (root, initial) = super::blocking(move || {
                open_context::local_paths(requested, directory, context_root)
            })
            .await?;
            (root, initial, None)
        }
        FileSource::Sftp { profile_id } => {
            let cloned = state.inner().clone();
            let id = profile_id.clone();
            let profile =
                super::blocking(move || super::sftp::require_profile(&cloned, &id)).await?;
            let Some(target) =
                open_context::remote_target(request.path.as_deref(), request.directory)
            else {
                let (root, initial) = open_context::workspace_paths(
                    &request.source,
                    None,
                    false,
                    request.root_path.clone(),
                )?;
                unlocked(&caller, &state)?;
                return state.editor.open(
                    caller.label(),
                    request.source,
                    root,
                    initial,
                    Some(profile.updated_at),
                );
            };
            let session = state.sftp.editor_session(&profile).await?;
            let path = session.canonical_path(target, false).await?;
            session.check_type(&path, request.directory).await?;
            let context_root = if let Some(root) = &request.root_path {
                let root = session.canonical_path(root, false).await?;
                session.check_type(&root, true).await?;
                Some(root)
            } else {
                None
            };
            let (root, initial) = open_context::workspace_paths(
                &request.source,
                Some(path),
                request.directory,
                context_root,
            )?;
            (root, initial, Some(profile.updated_at))
        }
    };
    unlocked(&caller, &state)?;
    state
        .editor
        .open(caller.label(), request.source, root, initial, version)
}

#[tauri::command]
pub async fn editor_close_workspace(
    caller: Webview,
    state: State<'_, AppState>,
    workspace_id: String,
) -> AppResult<()> {
    crate::browser::trusted(&caller)?;
    state.editor.close(caller.label(), &workspace_id)
}

#[tauri::command]
pub async fn editor_list(
    caller: Webview,
    state: State<'_, AppState>,
    workspace_id: String,
    path: String,
) -> AppResult<crate::editor::contracts::EditorDirectoryListing> {
    const MAX_TREE_ENTRIES: usize = 10_000;
    unlocked(&caller, &state)?;
    let lease = state.editor.require(caller.label(), &workspace_id)?;
    let (listing, truncated) = match lease.workspace.source {
        FileSource::Local => {
            super::blocking(move || local::list_bounded(&PathBuf::from(path), MAX_TREE_ENTRIES))
                .await?
        }
        FileSource::Sftp { .. } => {
            state
                .sftp
                .editor_session(&profile(&state, &lease).await?)
                .await?
                .list_bounded(&path, MAX_TREE_ENTRIES, &lease)
                .await?
        }
    };
    lease.ensure_active()?;
    unlocked(&caller, &state)?;
    Ok(crate::editor::contracts::EditorDirectoryListing { listing, truncated })
}

#[tauri::command]
pub async fn editor_read_text(
    caller: Webview,
    state: State<'_, AppState>,
    request: ReadEditorRequest,
) -> AppResult<EditorTextFile> {
    unlocked(&caller, &state)?;
    let lease = state
        .editor
        .require(caller.label(), &request.workspace_id)?;
    let result = match &lease.workspace.source {
        FileSource::Local => {
            let read = super::blocking(move || {
                local::read(
                    &PathBuf::from(request.path),
                    request.encoding,
                    request.allow_large,
                )
            })
            .await?;
            EditorTextFile {
                source: FileSource::Local,
                path: read.path,
                content: read.content,
                metadata: read.metadata,
                version_token: read.version_token,
                read_only: read.read_only,
                byte_length: read.byte_length,
                large_file: read.byte_length > text::NORMAL_TEXT_BYTES as u64,
            }
        }
        FileSource::Sftp { profile_id } => {
            let session = state
                .sftp
                .editor_session(&profile(&state, &lease).await?)
                .await?;
            let read = session
                .read(profile_id, &request.path, request.allow_large, &lease)
                .await?;
            let size = read.data.len() as u64;
            let encoding = request.encoding;
            let read_only = read
                .attributes
                .permissions
                .is_none_or(|mode| mode & 0o222 == 0);
            let path = read.path.clone();
            let decoded =
                super::blocking(move || text::decode(&path, &read.data, encoding)).await?;
            EditorTextFile {
                source: lease.workspace.source.clone(),
                path: read.path,
                content: decoded.content,
                metadata: decoded.metadata,
                version_token: read.version,
                read_only,
                byte_length: size,
                large_file: size > text::NORMAL_TEXT_BYTES as u64,
            }
        }
    };
    lease.ensure_active()?;
    unlocked(&caller, &state)?;
    Ok(result)
}

#[tauri::command]
pub async fn editor_save_text(
    caller: Webview,
    state: State<'_, AppState>,
    request: SaveEditorRequest,
) -> AppResult<EditorSavedFile> {
    unlocked(&caller, &state)?;
    let lease = state
        .editor
        .require(caller.label(), &request.workspace_id)?;
    let (path, version_token) = match &lease.workspace.source {
        FileSource::Local => {
            let requested = request.path.clone();
            let target =
                super::blocking(move || local::canonical_target(&PathBuf::from(requested))).await?;
            let path = local::display_path(&target)?;
            let lock_target = target.clone();
            let lock_key = super::blocking(move || local::save_lock_key(&lock_target)).await?;
            let lock = state.editor.save_lock(&FileSource::Local, &lock_key)?;
            let _guard = lock.lock().await;
            unlocked(&caller, &state)?;
            lease.ensure_active()?;
            let active = lease.clone();
            let version = super::blocking(move || {
                active.ensure_active()?;
                local::save_authorized(
                    &target,
                    &request.content,
                    &request.metadata,
                    request.expected_version.as_deref(),
                    || active.ensure_active(),
                )
            })
            .await?;
            (path, version)
        }
        FileSource::Sftp { profile_id } => {
            let remote_profile = profile(&state, &lease).await?;
            let session = state.sftp.editor_session(&remote_profile).await?;
            let path = session.canonical_path(&request.path, true).await?;
            let lock = state.editor.save_lock(&lease.workspace.source, &path)?;
            let _guard = lock.lock().await;
            unlocked(&caller, &state)?;
            lease.ensure_active()?;
            profile(&state, &lease).await?;
            let bytes =
                super::blocking(move || text::encode(&request.content, &request.metadata)).await?;
            let version = session
                .save(
                    profile_id,
                    &path,
                    &bytes,
                    request.expected_version.as_deref(),
                    request.allow_non_atomic,
                    &lease,
                )
                .await?;
            (path, version)
        }
    };
    Ok(EditorSavedFile {
        source: lease.workspace.source,
        path,
        version_token,
    })
}

#[tauri::command]
pub async fn editor_start_scan(
    caller: Webview,
    state: State<'_, AppState>,
    request: crate::editor::search::ScanRequest,
) -> AppResult<String> {
    unlocked(&caller, &state)?;
    let lease = state
        .editor
        .require(caller.label(), &request.workspace_id)?;
    let remote = if matches!(lease.workspace.source, FileSource::Sftp { .. }) {
        Some((state.sftp.clone(), profile(&state, &lease).await?))
    } else {
        None
    };
    unlocked(&caller, &state)?;
    state.editor.scans.start(lease, request, remote)
}
#[tauri::command]
pub async fn editor_next_scan(
    caller: Webview,
    state: State<'_, AppState>,
    workspace_id: String,
    operation_id: String,
) -> AppResult<crate::editor::search::ScanBatch> {
    unlocked(&caller, &state)?;
    let lease = state.editor.require(caller.label(), &workspace_id)?;
    if matches!(lease.workspace.source, FileSource::Sftp { .. }) {
        profile(&state, &lease).await?;
    }
    let result = state
        .editor
        .scans
        .next(caller.label(), &workspace_id, &operation_id)
        .await?;
    lease.ensure_active()?;
    unlocked(&caller, &state)?;
    Ok(result)
}
#[tauri::command]
pub async fn editor_cancel_scan(
    caller: Webview,
    state: State<'_, AppState>,
    workspace_id: String,
    operation_id: String,
) -> AppResult<()> {
    crate::browser::trusted(&caller)?;
    state.editor.require(caller.label(), &workspace_id)?;
    state
        .editor
        .scans
        .cancel(caller.label(), &workspace_id, &operation_id)
}

#[tauri::command]
pub async fn editor_filter_open_paths(
    caller: Webview,
    state: State<'_, AppState>,
    request: crate::editor::search::ScanRequest,
) -> AppResult<Vec<String>> {
    unlocked(&caller, &state)?;
    let lease = state
        .editor
        .require(caller.label(), &request.workspace_id)?;
    crate::editor::search::filter_open_paths(&lease, &request)
}

#[tauri::command]
pub async fn editor_read_image(
    caller: Webview,
    state: State<'_, AppState>,
    workspace_id: String,
    path: String,
) -> AppResult<crate::sftp::SftpImageFile> {
    unlocked(&caller, &state)?;
    let lease = state.editor.require(caller.label(), &workspace_id)?;
    let image = match lease.workspace.source {
        FileSource::Local => super::sftp::sftp_local_read_image(path).await?,
        FileSource::Sftp { .. } => {
            state
                .sftp
                .read_image(&profile(&state, &lease).await?, &path)
                .await?
        }
    };
    lease.ensure_active()?;
    unlocked(&caller, &state)?;
    Ok(image)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorHandoffWindow {
    workspace: crate::models::workspace::DetachedWorkspace,
    handoff_id: String,
}
#[tauri::command]
pub async fn editor_detach_workspace(
    caller: Webview,
    state: State<'_, AppState>,
    workspace_id: String,
    reference: crate::editor::contracts::EditorWorkspaceReference,
) -> AppResult<EditorHandoffWindow> {
    unlocked(&caller, &state)?;
    reference.validate()?;
    let lease = state.editor.require(caller.label(), &workspace_id)?;
    if reference.source != lease.workspace.source
        || reference.root_path != lease.workspace.root_path
    {
        return Err(AppError::new(
            "editor_source",
            "移窗不能改变编辑器文件来源。",
        ));
    }
    if matches!(lease.workspace.source, FileSource::Sftp { .. }) {
        profile(&state, &lease).await?;
    }
    let label = format!("detached-editor-{:032x}", rand::random::<u128>());
    let handoff_id = state.editor.handoffs.start(lease, &label)?;
    match state.detached_workspaces.open_editor(
        caller.app_handle(),
        label,
        reference,
        handoff_id.clone(),
    ) {
        Ok(workspace) => Ok(EditorHandoffWindow {
            workspace,
            handoff_id,
        }),
        Err(error) => {
            let _ = state
                .editor
                .handoffs
                .finish(caller.label(), &handoff_id, false, |_| Ok(()));
            Err(error)
        }
    }
}
#[tauri::command]
pub fn editor_handoff_ready(
    caller: Webview,
    state: State<'_, AppState>,
    handoff_id: String,
    ready: bool,
) -> AppResult<()> {
    crate::browser::trusted(&caller)?;
    state
        .editor
        .handoffs
        .ready(caller.label(), &handoff_id, ready)
}
#[tauri::command]
pub async fn editor_wait_handoff(
    caller: Webview,
    state: State<'_, AppState>,
    handoff_id: String,
    release: bool,
) -> AppResult<bool> {
    crate::browser::trusted(&caller)?;
    state
        .editor
        .handoffs
        .wait(caller.label(), &handoff_id, release)
        .await
}
#[tauri::command]
pub fn editor_finish_handoff(
    caller: Webview,
    state: State<'_, AppState>,
    handoff_id: String,
    commit: bool,
) -> AppResult<()> {
    crate::browser::trusted(&caller)?;
    if commit {
        unlocked(&caller, &state)?;
    }
    state
        .editor
        .handoffs
        .finish(caller.label(), &handoff_id, commit, |id| {
            state.editor.close(caller.label(), id)
        })
}
