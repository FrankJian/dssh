use tauri::{AppHandle, State};

use crate::{
    app::AppState,
    error::{AppError, AppResult},
    kubernetes,
    models::kubernetes::{
        CreateKubernetesProfileRequest, KubernetesCapabilities, KubernetesCapabilityRequest,
        KubernetesCliLaunch, KubernetesCliRequest, KubernetesPodLogs, KubernetesPodLogsRequest,
        KubernetesProfile, KubernetesResourceDocument, KubernetesResourceDocumentRequest,
        KubernetesResourceList, KubernetesResourceQuery, KubernetesSource,
        LocalKubeconfigScanRequest, LocalKubeconfigScanResult, RemoteKubernetesDiscoveryRequest,
        RemoteKubernetesDiscoveryResult, UpdateKubernetesProfileRequest,
    },
};

fn validate_profile_source(state: &AppState, source: &KubernetesSource) -> AppResult<()> {
    if let KubernetesSource::RemoteSsh { ssh_profile_id, .. } = source
        && state.profiles.get_profile(ssh_profile_id)?.is_none()
    {
        return Err(AppError::new(
            "profile_not_found",
            "找不到 Kubernetes 来源所选的 SSH 连接。",
        ));
    }
    Ok(())
}

#[tauri::command]
pub fn list_kubernetes_profiles(state: State<'_, AppState>) -> AppResult<Vec<KubernetesProfile>> {
    state.profiles.list_kubernetes_profiles()
}

#[tauri::command]
pub fn create_kubernetes_profile(
    state: State<'_, AppState>,
    request: CreateKubernetesProfileRequest,
) -> AppResult<KubernetesProfile> {
    validate_profile_source(&state, &request.source)?;
    state.profiles.create_kubernetes_profile(request)
}

#[tauri::command]
pub fn update_kubernetes_profile(
    state: State<'_, AppState>,
    request: UpdateKubernetesProfileRequest,
) -> AppResult<KubernetesProfile> {
    validate_profile_source(&state, &request.source)?;
    state.profiles.update_kubernetes_profile(request)
}

#[tauri::command]
pub fn delete_kubernetes_profile(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.profiles.delete_kubernetes_profile(&id)
}

#[tauri::command]
pub fn set_kubernetes_profile_favorite(
    state: State<'_, AppState>,
    id: String,
    favorite: bool,
) -> AppResult<KubernetesProfile> {
    state
        .profiles
        .set_kubernetes_profile_favorite(&id, favorite)
}

#[tauri::command]
pub async fn list_kubernetes_resources(
    state: State<'_, AppState>,
    query: KubernetesResourceQuery,
) -> AppResult<KubernetesResourceList> {
    let profile = state
        .profiles
        .get_kubernetes_profile(&query.profile_id)?
        .ok_or_else(|| {
            AppError::new(
                "kubernetes_profile_not_found",
                "找不到 Kubernetes 连接配置。",
            )
        })?;
    kubernetes::list_resources(
        profile,
        query,
        &state.kubernetes,
        &state.profiles,
        &state.ssh_pool,
    )
    .await
}

#[tauri::command]
pub async fn get_kubernetes_resource_document(
    state: State<'_, AppState>,
    request: KubernetesResourceDocumentRequest,
) -> AppResult<KubernetesResourceDocument> {
    let profile = state
        .profiles
        .get_kubernetes_profile(&request.profile_id)?
        .ok_or_else(|| {
            AppError::new(
                "kubernetes_profile_not_found",
                "找不到 Kubernetes 连接配置。",
            )
        })?;
    kubernetes::get_resource_document(
        profile,
        request,
        &state.kubernetes,
        &state.profiles,
        &state.ssh_pool,
    )
    .await
}

#[tauri::command]
pub async fn get_kubernetes_pod_logs(
    state: State<'_, AppState>,
    request: KubernetesPodLogsRequest,
) -> AppResult<KubernetesPodLogs> {
    let profile = state
        .profiles
        .get_kubernetes_profile(&request.profile_id)?
        .ok_or_else(|| {
            AppError::new(
                "kubernetes_profile_not_found",
                "找不到 Kubernetes 连接配置。",
            )
        })?;
    kubernetes::pod_logs(
        profile,
        request,
        &state.kubernetes,
        &state.profiles,
        &state.ssh_pool,
    )
    .await
}

#[tauri::command]
pub async fn start_kubernetes_pod_log_follow(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    request: KubernetesPodLogsRequest,
) -> AppResult<String> {
    let profile = state
        .profiles
        .get_kubernetes_profile(&request.profile_id)?
        .ok_or_else(|| {
            AppError::new(
                "kubernetes_profile_not_found",
                "找不到 Kubernetes 连接配置。",
            )
        })?;
    kubernetes::start_pod_log_follow(
        app_handle,
        profile,
        request,
        state.kubernetes.clone(),
        state.profiles.clone(),
        state.ssh_pool.clone(),
    )
    .await
}

#[tauri::command]
pub async fn cancel_kubernetes_pod_log_follow(
    state: State<'_, AppState>,
    operation_id: String,
) -> AppResult<()> {
    kubernetes::cancel_pod_log_follow(&state.kubernetes, &operation_id).await;
    Ok(())
}

#[tauri::command]
pub async fn prepare_kubernetes_cli(
    state: State<'_, AppState>,
    request: KubernetesCliRequest,
) -> AppResult<KubernetesCliLaunch> {
    let profile = state
        .profiles
        .get_kubernetes_profile(&request.profile_id)?
        .ok_or_else(|| {
            AppError::new(
                "kubernetes_profile_not_found",
                "找不到 Kubernetes 连接配置。",
            )
        })?;
    kubernetes::cli_launch(&profile, &request.context, &state.profiles, &state.ssh_pool).await
}

#[tauri::command]
pub async fn get_kubernetes_capabilities(
    state: State<'_, AppState>,
    request: KubernetesCapabilityRequest,
) -> AppResult<KubernetesCapabilities> {
    let profile = state
        .profiles
        .get_kubernetes_profile(&request.profile_id)?
        .ok_or_else(|| {
            AppError::new(
                "kubernetes_profile_not_found",
                "找不到 Kubernetes 连接配置。",
            )
        })?;
    kubernetes::capabilities(
        profile,
        request,
        &state.kubernetes,
        &state.profiles,
        &state.ssh_pool,
    )
    .await
}

/// Scan local kubeconfig paths without returning credential material.
#[tauri::command]
pub fn scan_local_kubeconfig(
    request: LocalKubeconfigScanRequest,
) -> AppResult<LocalKubeconfigScanResult> {
    kubernetes::scan_local_kubeconfig(request)
}

/// Discover kubectl and kubeconfig contexts through a saved SSH profile. The
/// backend only executes fixed, read-only command templates.
#[tauri::command]
pub async fn discover_remote_kubernetes(
    state: State<'_, AppState>,
    profile_id: String,
    request: RemoteKubernetesDiscoveryRequest,
) -> AppResult<RemoteKubernetesDiscoveryResult> {
    let profile = state
        .profiles
        .get_profile(&profile_id)?
        .ok_or_else(|| AppError::new("profile_not_found", "找不到该 SSH 连接配置。"))?;
    kubernetes::discover_remote_kubernetes(profile, request, &state.ssh_pool).await
}
