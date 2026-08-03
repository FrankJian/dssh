use tauri::{AppHandle, State};

use crate::{
    app::AppState,
    error::{AppError, AppResult},
    kubernetes,
    models::kubernetes::{
        CreateKubernetesProfileRequest, ImportLocalKubeconfigRequest, ImportLocalKubeconfigResult,
        KubernetesActionResult, KubernetesApplyPreview, KubernetesApplyRequest,
        KubernetesApplyResult, KubernetesAuditEntry, KubernetesCapabilities,
        KubernetesCapabilityRequest, KubernetesCliLaunch, KubernetesCliRequest,
        KubernetesConnectionTestRequest, KubernetesConnectionTestResult, KubernetesDeleteRequest,
        KubernetesDeleteResult, KubernetesDryRunRequest, KubernetesDryRunResult,
        KubernetesExecLaunch, KubernetesExecPluginTrustRequest, KubernetesMetricsRequest,
        KubernetesMetricsResult, KubernetesPodExecRequest, KubernetesPodLogs,
        KubernetesPodLogsRequest, KubernetesPortForwardInfo, KubernetesPortForwardRequest,
        KubernetesProfile, KubernetesResourceDocument, KubernetesResourceDocumentRequest,
        KubernetesResourceList, KubernetesResourceQuery, KubernetesResourceWatchRequest,
        KubernetesRolloutRequest, KubernetesScaleRequest, KubernetesSource,
        LocalKubeconfigScanRequest, LocalKubeconfigScanResult, RemoteKubernetesDiscoveryRequest,
        RemoteKubernetesDiscoveryResult, UpdateKubernetesProfileRequest,
    },
    storage::KubernetesAuditRecord,
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

fn discard_imported_if_unused(state: &AppState, secret_ref: &str) -> AppResult<()> {
    let is_referenced = state.profiles.list_kubernetes_profiles()?.iter().any(|profile| {
        matches!(&profile.source, KubernetesSource::LocalImported { secret_ref: existing, .. } if existing == secret_ref)
    });
    if is_referenced {
        return Ok(());
    }
    state.kubernetes.delete_imported_kubeconfig(secret_ref)?;
    state.profiles.delete_kubernetes_import(secret_ref)
}

fn kubernetes_source_label(source: &KubernetesSource) -> &'static str {
    match source {
        KubernetesSource::Local { .. } => "localPath",
        KubernetesSource::LocalImported { .. } => "localImported",
        KubernetesSource::RemoteSsh { .. } => "remoteSsh",
    }
}

fn record_kubernetes_audit(state: &AppState, record: KubernetesAuditRecord) {
    // An audit write must never turn a completed remote mutation into a
    // user-visible failure. The record contains only stable identity fields.
    let _ = state.profiles.record_kubernetes_audit(&record);
}

fn apply_audit_metadata(
    request: &KubernetesApplyRequest,
) -> (Vec<String>, Option<String>, Option<String>) {
    let dry_run = KubernetesDryRunRequest {
        profile_id: request.profile_id.clone(),
        context: request.context.clone(),
        yaml: request.yaml.clone(),
    };
    kubernetes::parse_dry_run_manifests(&dry_run)
        .map(|items| {
            let resource = items.first().map(|item| item.kind.clone());
            let namespace = items.first().and_then(|item| item.namespace.clone());
            (
                items.into_iter().map(|item| item.name).collect(),
                resource,
                namespace,
            )
        })
        .unwrap_or_default()
}

#[tauri::command]
pub fn list_kubernetes_profiles(state: State<'_, AppState>) -> AppResult<Vec<KubernetesProfile>> {
    state.profiles.list_kubernetes_profiles()
}

#[tauri::command]
pub fn list_kubernetes_audit(
    state: State<'_, AppState>,
    profile_id: Option<String>,
    limit: Option<u32>,
) -> AppResult<Vec<KubernetesAuditEntry>> {
    state
        .profiles
        .list_kubernetes_audit(profile_id.as_deref(), limit.unwrap_or(200))
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
    let existing = state.profiles.get_kubernetes_profile(&request.id)?;
    let updated = state.profiles.update_kubernetes_profile(request)?;
    if let Some(KubernetesSource::LocalImported { secret_ref, .. }) =
        existing.map(|profile| profile.source)
        && !matches!(&updated.source, KubernetesSource::LocalImported { secret_ref: next, .. } if next == &secret_ref)
    {
        discard_imported_if_unused(&state, &secret_ref)?;
    }
    Ok(updated)
}

#[tauri::command]
pub fn delete_kubernetes_profile(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let existing = state.profiles.get_kubernetes_profile(&id)?;
    state.profiles.delete_kubernetes_profile(&id)?;
    if let Some(KubernetesSource::LocalImported { secret_ref, .. }) =
        existing.map(|profile| profile.source)
    {
        discard_imported_if_unused(&state, &secret_ref)?;
    }
    Ok(())
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
pub fn preview_kubernetes_dry_run(
    request: KubernetesDryRunRequest,
) -> AppResult<KubernetesDryRunResult> {
    kubernetes::dry_run_preview(request)
}

#[tauri::command]
pub async fn server_dry_run_kubernetes_apply(
    state: State<'_, AppState>,
    request: KubernetesApplyRequest,
) -> AppResult<KubernetesApplyPreview> {
    let profile = state
        .profiles
        .get_kubernetes_profile(&request.profile_id)?
        .ok_or_else(|| {
            AppError::new(
                "kubernetes_profile_not_found",
                "找不到 Kubernetes 连接配置。",
            )
        })?;
    kubernetes::server_dry_run_apply(
        profile,
        request,
        &state.kubernetes,
        &state.profiles,
        &state.ssh_pool,
    )
    .await
}

#[tauri::command]
pub async fn apply_kubernetes_resources(
    state: State<'_, AppState>,
    request: KubernetesApplyRequest,
) -> AppResult<KubernetesApplyResult> {
    let profile = state
        .profiles
        .get_kubernetes_profile(&request.profile_id)?
        .ok_or_else(|| {
            AppError::new(
                "kubernetes_profile_not_found",
                "找不到 Kubernetes 连接配置。",
            )
        })?;
    let (names, resource, manifest_namespace) = apply_audit_metadata(&request);
    let context = request.context.clone();
    let audit_profile = profile.clone();
    let result = kubernetes::apply_resources(
        profile,
        request,
        &state.kubernetes,
        &state.profiles,
        &state.ssh_pool,
    )
    .await;
    let (status, error_code) = match &result {
        Ok(_) => ("success", None),
        Err(error) => ("failed", Some(error.code.as_str())),
    };
    record_kubernetes_audit(
        &state,
        KubernetesAuditRecord {
            profile_id: audit_profile.id.clone(),
            source: kubernetes_source_label(&audit_profile.source).to_string(),
            context: context.name.clone(),
            identity: context.user.clone(),
            resource,
            namespace: manifest_namespace.or(context.namespace.clone()),
            names,
            action: "apply".to_string(),
            result: status.to_string(),
            error_code: error_code.map(str::to_string),
        },
    );
    result
}

#[tauri::command]
pub async fn delete_kubernetes_resources(
    state: State<'_, AppState>,
    request: KubernetesDeleteRequest,
) -> AppResult<KubernetesDeleteResult> {
    let profile = state
        .profiles
        .get_kubernetes_profile(&request.profile_id)?
        .ok_or_else(|| {
            AppError::new(
                "kubernetes_profile_not_found",
                "找不到 Kubernetes 连接配置。",
            )
        })?;
    let audit_profile = profile.clone();
    let context = request.context.clone();
    let names = request.names.clone();
    let resource = request
        .kind
        .clone()
        .or_else(|| Some(request.resource.clone()));
    let namespace = request.namespace.clone();
    let result = kubernetes::delete_resources(
        profile,
        request,
        &state.kubernetes,
        &state.profiles,
        &state.ssh_pool,
    )
    .await;
    let (status, error_code) = match &result {
        Ok(value) if value.items.iter().all(|item| item.success) => ("success", None),
        Ok(_) => ("partial", None),
        Err(error) => ("failed", Some(error.code.as_str())),
    };
    record_kubernetes_audit(
        &state,
        KubernetesAuditRecord {
            profile_id: audit_profile.id.clone(),
            source: kubernetes_source_label(&audit_profile.source).to_string(),
            context: context.name.clone(),
            identity: context.user.clone(),
            resource,
            namespace: namespace.or(context.namespace.clone()),
            names,
            action: "delete".to_string(),
            result: status.to_string(),
            error_code: error_code.map(str::to_string),
        },
    );
    result
}

#[tauri::command]
pub async fn scale_kubernetes_resource(
    state: State<'_, AppState>,
    request: KubernetesScaleRequest,
) -> AppResult<KubernetesActionResult> {
    let profile = state
        .profiles
        .get_kubernetes_profile(&request.profile_id)?
        .ok_or_else(|| {
            AppError::new(
                "kubernetes_profile_not_found",
                "找不到 Kubernetes 连接配置。",
            )
        })?;
    let audit_profile = profile.clone();
    let context = request.context.clone();
    let name = request.name.clone();
    let resource = request
        .kind
        .clone()
        .or_else(|| Some(request.resource.clone()));
    let namespace = request.namespace.clone();
    let result = kubernetes::scale_resource(
        profile,
        request,
        &state.kubernetes,
        &state.profiles,
        &state.ssh_pool,
    )
    .await;
    let (status, error_code) = match &result {
        Ok(_) => ("success", None),
        Err(error) => ("failed", Some(error.code.as_str())),
    };
    record_kubernetes_audit(
        &state,
        KubernetesAuditRecord {
            profile_id: audit_profile.id.clone(),
            source: kubernetes_source_label(&audit_profile.source).to_string(),
            context: context.name.clone(),
            identity: context.user.clone(),
            resource,
            namespace: namespace.or(context.namespace.clone()),
            names: vec![name],
            action: "scale".to_string(),
            result: status.to_string(),
            error_code: error_code.map(str::to_string),
        },
    );
    result
}

#[tauri::command]
pub async fn restart_kubernetes_rollout(
    state: State<'_, AppState>,
    request: KubernetesRolloutRequest,
) -> AppResult<KubernetesActionResult> {
    let profile = state
        .profiles
        .get_kubernetes_profile(&request.profile_id)?
        .ok_or_else(|| {
            AppError::new(
                "kubernetes_profile_not_found",
                "找不到 Kubernetes 连接配置。",
            )
        })?;
    let audit_profile = profile.clone();
    let context = request.context.clone();
    let name = request.name.clone();
    let resource = request
        .kind
        .clone()
        .or_else(|| Some(request.resource.clone()));
    let namespace = request.namespace.clone();
    let result = kubernetes::restart_rollout(
        profile,
        request,
        &state.kubernetes,
        &state.profiles,
        &state.ssh_pool,
    )
    .await;
    let (status, error_code) = match &result {
        Ok(_) => ("success", None),
        Err(error) => ("failed", Some(error.code.as_str())),
    };
    record_kubernetes_audit(
        &state,
        KubernetesAuditRecord {
            profile_id: audit_profile.id.clone(),
            source: kubernetes_source_label(&audit_profile.source).to_string(),
            context: context.name.clone(),
            identity: context.user.clone(),
            resource,
            namespace: namespace.or(context.namespace.clone()),
            names: vec![name],
            action: "rolloutRestart".to_string(),
            result: status.to_string(),
            error_code: error_code.map(str::to_string),
        },
    );
    result
}

#[tauri::command]
pub async fn start_kubernetes_resource_watch(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    request: KubernetesResourceWatchRequest,
) -> AppResult<String> {
    let profile = state
        .profiles
        .get_kubernetes_profile(&request.query.profile_id)?
        .ok_or_else(|| {
            AppError::new(
                "kubernetes_profile_not_found",
                "找不到 Kubernetes 连接配置。",
            )
        })?;
    kubernetes::start_resource_watch(
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
pub async fn cancel_kubernetes_resource_watch(
    state: State<'_, AppState>,
    operation_id: String,
) -> AppResult<()> {
    kubernetes::cancel_resource_watch(&state.kubernetes, &operation_id).await;
    Ok(())
}

#[tauri::command]
pub async fn start_kubernetes_port_forward(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    request: KubernetesPortForwardRequest,
) -> AppResult<KubernetesPortForwardInfo> {
    let profile = state
        .profiles
        .get_kubernetes_profile(&request.profile_id)?
        .ok_or_else(|| {
            AppError::new(
                "kubernetes_profile_not_found",
                "找不到 Kubernetes 连接配置。",
            )
        })?;
    kubernetes::start_port_forward(
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
pub async fn cancel_kubernetes_port_forward(
    state: State<'_, AppState>,
    operation_id: String,
) -> AppResult<()> {
    kubernetes::cancel_port_forward(&state.kubernetes, &operation_id).await;
    Ok(())
}

#[tauri::command]
pub async fn list_kubernetes_port_forwards(
    state: State<'_, AppState>,
) -> AppResult<Vec<KubernetesPortForwardInfo>> {
    Ok(kubernetes::list_port_forwards(&state.kubernetes).await)
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
pub async fn prepare_kubernetes_pod_exec(
    state: State<'_, AppState>,
    request: KubernetesPodExecRequest,
) -> AppResult<KubernetesExecLaunch> {
    let profile = state
        .profiles
        .get_kubernetes_profile(&request.profile_id)?
        .ok_or_else(|| {
            AppError::new(
                "kubernetes_profile_not_found",
                "找不到 Kubernetes 连接配置。",
            )
        })?;
    kubernetes::pod_exec_launch(&profile, request, &state.profiles, &state.ssh_pool).await
}

#[tauri::command]
pub async fn get_kubernetes_metrics(
    state: State<'_, AppState>,
    request: KubernetesMetricsRequest,
) -> AppResult<KubernetesMetricsResult> {
    let profile = state
        .profiles
        .get_kubernetes_profile(&request.profile_id)?
        .ok_or_else(|| {
            AppError::new(
                "kubernetes_profile_not_found",
                "找不到 Kubernetes 连接配置。",
            )
        })?;
    kubernetes::metrics(
        profile,
        request,
        &state.kubernetes,
        &state.profiles,
        &state.ssh_pool,
    )
    .await
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
    state: State<'_, AppState>,
    request: LocalKubeconfigScanRequest,
) -> AppResult<LocalKubeconfigScanResult> {
    kubernetes::scan_local_kubeconfig(request, &state.kubernetes)
}

/// Securely import a kubeconfig chosen through the system file picker. The
/// selected content is read only in Rust and stored in the OS credential store.
#[tauri::command]
pub fn import_local_kubeconfig(
    state: State<'_, AppState>,
    request: ImportLocalKubeconfigRequest,
) -> AppResult<ImportLocalKubeconfigResult> {
    kubernetes::import_local_kubeconfig(request, &state.kubernetes, &state.profiles)
}

#[tauri::command]
pub fn scan_imported_local_kubeconfig(
    state: State<'_, AppState>,
    source: KubernetesSource,
) -> AppResult<crate::models::kubernetes::LocalKubeconfigScanResult> {
    kubernetes::scan_imported_local_kubeconfig(&source, &state.kubernetes)
}

/// Drop an uncommitted import when the editor is cancelled. A source already
/// referenced by a saved profile cannot be discarded through this endpoint.
#[tauri::command]
pub fn discard_imported_local_kubeconfig(
    state: State<'_, AppState>,
    secret_ref: String,
) -> AppResult<()> {
    if state.profiles.list_kubernetes_profiles()?.iter().any(|profile| {
        matches!(&profile.source, KubernetesSource::LocalImported { secret_ref: existing, .. } if existing == &secret_ref)
    }) {
        return Err(AppError::new(
            "kubernetes_import_in_use",
            "已保存的 Kubernetes 连接仍在使用该导入配置。",
        ));
    }
    discard_imported_if_unused(&state, &secret_ref)
}

#[tauri::command]
pub fn set_kubernetes_exec_plugin_trust(
    state: State<'_, AppState>,
    request: KubernetesExecPluginTrustRequest,
) -> AppResult<()> {
    kubernetes::set_local_exec_plugin_trust(request, &state.kubernetes)
}

#[tauri::command]
pub async fn test_kubernetes_connection(
    state: State<'_, AppState>,
    request: KubernetesConnectionTestRequest,
) -> AppResult<Vec<KubernetesConnectionTestResult>> {
    validate_profile_source(&state, &request.source)?;
    kubernetes::test_connection(request, &state.kubernetes, &state.profiles, &state.ssh_pool).await
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
