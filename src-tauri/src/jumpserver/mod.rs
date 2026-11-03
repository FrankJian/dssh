//! Authenticated JumpServer directory and ephemeral SSH sources.
//! Target IDs are process-local capabilities scoped to one login generation.
pub mod api;
mod password_auth;
use crate::{
    error::{AppError, AppResult},
    models::{
        jumpserver::*,
        ssh_profile::{AuthMethod, SshProfile},
    },
    storage::ProfileRepository,
};
use api::{Api, error, invalid, required, validate_id};
use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    time::{Duration, Instant},
};
use zeroize::Zeroizing;

const SERVICE: &str = "com.dssh.desktop.jumpserver";
#[derive(Default, Clone)]
pub struct JumpServerManager {
    inner: Arc<Mutex<Runtime>>,
}
#[derive(Default)]
struct Runtime {
    secrets: HashMap<String, Zeroizing<String>>,
    epochs: HashMap<String, String>,
    attempt_owners: HashMap<String, String>,
    logins: HashMap<String, Arc<Login>>,
    targets: HashMap<String, JumpServerTarget>,
    pending: HashMap<String, Arc<PendingLogin>>,
}
struct PendingLogin {
    challenge_id: String,
    owner: String,
    generation: String,
    profile: JumpServerProfile,
    created: Instant,
    attempts: AtomicUsize,
    flow: tokio::sync::Mutex<Option<password_auth::PasswordLogin>>,
}
const OTP_LIFETIME: Duration = Duration::from_secs(300);

struct Login {
    api: Api,
    identity: JumpServerIdentity,
    name: String,
}
pub fn is_target(id: &str) -> bool {
    id.starts_with("jms:")
}
fn nonce() -> String {
    format!("{:032x}", rand::random::<u128>())
}
fn credential_error() -> AppError {
    error(
        "jumpserver_credential",
        "系统凭据库不可用。可输入密码 / Secret 并选择仅本次使用。",
    )
}
fn entry(reference: &str) -> AppResult<keyring::Entry> {
    keyring::Entry::new(SERVICE, reference).map_err(|_| credential_error())
}
fn remove_secret(reference: &str) -> AppResult<()> {
    match entry(reference)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err(credential_error()),
    }
}
impl JumpServerManager {
    fn lock(&self) -> AppResult<std::sync::MutexGuard<'_, Runtime>> {
        self.inner
            .lock()
            .map_err(|_| error("jumpserver_state", "无法读取 JumpServer 状态。"))
    }
    pub fn save(
        &self,
        repo: &ProfileRepository,
        mut request: SaveJumpServerProfile,
    ) -> AppResult<JumpServerProfile> {
        let folder = crate::models::connection_folder::normalize_folder(&request.folder)?;
        let core_url = api::core_url(&request.core_url)?.to_string();
        if let Some(source_id) = &request.clone_source_id {
            if request.id.is_some() {
                return Err(error(
                    "jumpserver_invalid",
                    "克隆必须创建新的 JumpServer 连接。",
                ));
            }
            let (source, reference) = repo.get_jumpserver_profile(source_id)?;
            if request.remember_secret && request.secret.as_ref().is_none_or(|s| s.is_empty()) {
                let same_identity = source.core_url == core_url
                    && source.auth_kind == request.auth_kind
                    && source.key_id == request.key_id
                    && source.username == request.username.trim();
                if !same_identity {
                    return Err(error(
                        "jumpserver_secret_required",
                        "更改地址、认证方式或用户身份时，请重新输入密码 / Secret。",
                    ));
                }
                if let Some(reference) = reference {
                    request.secret = Some(Zeroizing::new(
                        entry(&reference)?
                            .get_password()
                            .map_err(|_| credential_error())?,
                    ));
                }
            }
        }
        if request.secret.as_ref().is_some_and(|s| s.len() > 4096) {
            return Err(error("jumpserver_invalid", "Secret 长度超过限制。"));
        }
        match request.auth_kind {
            JumpServerAuthKind::AccessKey => validate_id(&request.key_id)?,
            JumpServerAuthKind::Password => {
                if request.username.trim().is_empty()
                    || request.username.len() > 256
                    || request.username.chars().any(char::is_control)
                {
                    return Err(error(
                        "jumpserver_invalid",
                        "请输入有效的 JumpServer 用户名。",
                    ));
                }
            }
        }
        if let Some(id) = request.ssh_profile_id.as_ref().filter(|s| !s.is_empty())
            && repo.get_profile(id)?.is_none()
        {
            return Err(error("profile_not_found", "关联的 SSH 连接已不存在。"));
        }
        validate_id(&request.org_id)?;
        if request.name.trim().is_empty() || request.name.len() > 128 {
            return Err(error("jumpserver_invalid", "请输入有效的平台名称。"));
        }
        let mut state = self.lock()?;
        let existing = request
            .id
            .as_deref()
            .map(|id| repo.get_jumpserver_profile(id))
            .transpose()?;
        let id = request
            .id
            .unwrap_or_else(|| format!("jumpserver:{}", nonce()));
        // Editing an authenticated source could silently retarget live sessions.
        if state.logins.contains_key(&id) {
            return Err(error(
                "jumpserver_active",
                "请先退出此平台并关闭其会话，再编辑配置。",
            ));
        }
        let same_credentials = existing.as_ref().is_some_and(|(old, _)| {
            old.core_url == core_url
                && old.auth_kind == request.auth_kind
                && old.key_id == request.key_id
                && old.username == request.username.trim()
        });
        if existing.is_some()
            && !same_credentials
            && request.remember_secret
            && request.secret.as_ref().is_none_or(|s| s.is_empty())
        {
            return Err(error(
                "jumpserver_secret_required",
                "更改地址、认证方式或用户身份时，请重新输入密码 / Secret。",
            ));
        }
        let old_ref = existing.as_ref().and_then(|(_, r)| r.as_deref());
        let new_ref = if request.remember_secret {
            if let Some(secret) = request.secret.as_ref().filter(|s| !s.is_empty()) {
                let reference = nonce();
                entry(&reference)?
                    .set_password(secret)
                    .map_err(|_| credential_error())?;
                Some(reference)
            } else {
                old_ref
                    .filter(|_| same_credentials)
                    .map(str::to_string)
                    .ok_or_else(|| {
                        error(
                            "jumpserver_secret_required",
                            "请先输入要保存的密码 / Secret。",
                        )
                    })
                    .map(Some)?
            }
        } else {
            None
        };
        let profile = JumpServerProfile {
            id: id.clone(),
            name: request.name.trim().into(),
            folder,
            core_url,
            key_id: if request.auth_kind == JumpServerAuthKind::AccessKey {
                request.key_id
            } else {
                String::new()
            },
            auth_kind: request.auth_kind,
            username: request.username.trim().into(),
            ssh_profile_id: request.ssh_profile_id.filter(|s| !s.is_empty()),
            org_id: request.org_id,
            has_credential: new_ref.is_some(),
        };
        if let Err(err) = repo.save_jumpserver_profile(&profile, new_ref.as_deref()) {
            if new_ref.as_deref() != old_ref
                && let Some(reference) = &new_ref
            {
                let _ = remove_secret(reference);
            }
            return Err(err);
        }
        state.epochs.insert(id.clone(), nonce());
        state.pending.remove(&id);
        state.attempt_owners.remove(&id);
        state.secrets.remove(&id);
        if let Some(secret) = request.secret.filter(|s| !s.is_empty()) {
            state.secrets.insert(id.clone(), secret);
        }
        if let Some(reference) = old_ref.filter(|r| Some(*r) != new_ref.as_deref()) {
            remove_secret(reference)?;
        }
        Ok(profile)
    }
    pub fn delete(&self, repo: &ProfileRepository, id: &str) -> AppResult<()> {
        let mut state = self.lock()?;
        if state.logins.contains_key(id) || state.targets.values().any(|t| t.profile_id == id) {
            return Err(error("jumpserver_active", "请先退出此平台并关闭其会话。"));
        }
        let (_, reference) = repo.get_jumpserver_profile(id)?;
        if let Some(reference) = reference {
            remove_secret(&reference)?;
        }
        repo.delete_jumpserver_profile(id)?;
        state.secrets.remove(id);
        state.pending.remove(id);
        state.attempt_owners.remove(id);
        state.epochs.insert(id.into(), nonce());
        Ok(())
    }
    pub async fn login(
        &self,
        repo: &ProfileRepository,
        id: &str,
        supplied: Option<Zeroizing<String>>,
        owner: &str,
    ) -> AppResult<JumpServerLoginResult> {
        if supplied.as_ref().is_some_and(|s| s.len() > 4096) {
            return Err(error("jumpserver_invalid", "密码 / Secret 长度超过限制。"));
        }
        let generation = nonce();
        let (profile, reference, secret) = {
            let mut state = self.lock()?;
            let (profile, reference) = repo.get_jumpserver_profile(id)?;
            if state.logins.contains_key(id) {
                return Err(error(
                    "jumpserver_active",
                    "此平台已登录，请先退出再切换身份。",
                ));
            }
            state.epochs.insert(id.into(), generation.clone());
            state.attempt_owners.insert(id.into(), owner.into());
            state.pending.remove(id);
            let secret = supplied
                .filter(|s| !s.is_empty())
                .or_else(|| state.secrets.remove(id));
            (profile, reference, secret)
        };
        let secret = match secret {
            Some(s) => s,
            None => {
                let reference = reference.ok_or_else(|| {
                    error(
                        "jumpserver_secret_required",
                        "请输入密码或 Access Key Secret。",
                    )
                })?;
                tauri::async_runtime::spawn_blocking(move || {
                    entry(&reference)?
                        .get_password()
                        .map(Zeroizing::new)
                        .map_err(|_| credential_error())
                })
                .await
                .map_err(|_| credential_error())??
            }
        };
        if profile.auth_kind == JumpServerAuthKind::AccessKey {
            let api = Api::new(&profile, secret)?;
            return self.finish_login(profile, &generation, api).await;
        }
        let mut flow = password_auth::PasswordLogin::new(&profile)?;
        let result = flow.begin(&profile.username, &secret).await?;
        drop(secret);
        if let Some(token) = result {
            return self
                .finish_login(profile, &generation, flow.into_api(token))
                .await;
        }
        let challenge_id = nonce();
        let pending = Arc::new(PendingLogin {
            challenge_id: challenge_id.clone(),
            owner: owner.into(),
            generation: generation.clone(),
            profile,
            created: Instant::now(),
            attempts: AtomicUsize::new(0),
            flow: tokio::sync::Mutex::new(Some(flow)),
        });
        {
            let mut state = self.lock()?;
            if state.epochs.get(id) != Some(&generation) {
                return Err(error("jumpserver_cancelled", "登录已取消。"));
            }
            state.pending.insert(id.into(), pending);
        }
        let manager = self.clone();
        let platform = id.to_string();
        let challenge = challenge_id.clone();
        let owner = owner.to_string();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(OTP_LIFETIME).await;
            let _ = manager.cancel_password_login(&platform, &challenge, &owner);
        });
        Ok(JumpServerLoginResult::OtpRequired { challenge_id })
    }

    async fn finish_login(
        &self,
        profile: JumpServerProfile,
        generation: &str,
        api: Api,
    ) -> AppResult<JumpServerLoginResult> {
        let user = api.get("/api/v1/users/profile/").await?;
        let identity = JumpServerIdentity {
            user_id: required(&user, "id")?,
            username: required(&user, "username")?,
            org_id: profile.org_id,
            generation: generation.into(),
        };
        let login = Arc::new(Login {
            api,
            identity: identity.clone(),
            name: profile.name,
        });
        let mut state = self.lock()?;
        if state.epochs.get(&profile.id).map(String::as_str) != Some(generation) {
            return Err(error("jumpserver_cancelled", "登录已取消。"));
        }
        state.pending.remove(&profile.id);
        state.attempt_owners.remove(&profile.id);
        state.logins.insert(profile.id.clone(), login);
        state.secrets.remove(&profile.id);
        Ok(JumpServerLoginResult::Ready { identity })
    }

    pub async fn verify_otp(
        &self,
        id: &str,
        challenge_id: &str,
        owner: &str,
        code: Zeroizing<String>,
    ) -> AppResult<JumpServerLoginResult> {
        let pending = {
            let state = self.lock()?;
            state
                .pending
                .get(id)
                .filter(|p| {
                    p.challenge_id == challenge_id
                        && p.owner == owner
                        && state.epochs.get(id) == Some(&p.generation)
                })
                .cloned()
                .ok_or_else(|| error("jumpserver_otp_expired", "验证会话已失效，请重新登录。"))?
        };
        if pending.created.elapsed() >= OTP_LIFETIME {
            self.cancel_password_login(id, challenge_id, owner)?;
            return Err(error(
                "jumpserver_otp_expired",
                "验证会话已过期，请重新登录。",
            ));
        }
        let mut guard = pending
            .flow
            .try_lock()
            .map_err(|_| error("jumpserver_otp_busy", "正在验证，请勿重复提交。"))?;
        let flow = guard
            .as_mut()
            .ok_or_else(|| error("jumpserver_otp_expired", "验证会话已结束，请重新登录。"))?;
        let result = flow.verify(&code).await;
        drop(code);
        let attempts = pending.attempts.fetch_add(1, Ordering::AcqRel) + 1;
        {
            let state = self.lock()?;
            if pending.created.elapsed() >= OTP_LIFETIME
                || state.epochs.get(id) != Some(&pending.generation)
                || !state
                    .pending
                    .get(id)
                    .is_some_and(|p| Arc::ptr_eq(p, &pending))
            {
                return Err(error(
                    "jumpserver_otp_expired",
                    "验证已取消或过期，请重新登录。",
                ));
            }
        }
        let token = match result {
            Ok(token) => token,
            Err(e) => {
                if attempts >= 5 || e.code != "jumpserver_otp_invalid" {
                    self.cancel_password_login(id, challenge_id, owner)?;
                }
                return Err(e);
            }
        };
        let flow = guard.take().ok_or_else(invalid)?;
        let result = self
            .finish_login(
                pending.profile.clone(),
                &pending.generation,
                flow.into_api(token),
            )
            .await;
        if result.is_err() {
            self.cancel_password_login(id, challenge_id, owner)?;
        }
        result
    }

    pub fn cancel_password_login(
        &self,
        id: &str,
        challenge_id: &str,
        owner: &str,
    ) -> AppResult<()> {
        let mut state = self.lock()?;
        if state
            .pending
            .get(id)
            .is_some_and(|p| p.challenge_id == challenge_id && p.owner == owner)
        {
            state.pending.remove(id);
            state.attempt_owners.remove(id);
            state.epochs.insert(id.into(), nonce());
        }
        Ok(())
    }
    pub fn cancel_owner(&self, owner: &str) {
        if let Ok(mut state) = self.lock() {
            let ids = state
                .attempt_owners
                .iter()
                .filter(|(_, label)| label.as_str() == owner)
                .map(|(id, _)| id.clone())
                .collect::<Vec<_>>();
            for id in ids {
                state.pending.remove(&id);
                state.attempt_owners.remove(&id);
                state.epochs.insert(id, nonce());
            }
        }
    }
    pub fn identity(&self, id: &str) -> AppResult<Option<JumpServerIdentity>> {
        Ok(self.lock()?.logins.get(id).map(|l| l.identity.clone()))
    }
    fn login_context(&self, id: &str, generation: &str) -> AppResult<Arc<Login>> {
        self.lock()?
            .logins
            .get(id)
            .filter(|l| l.identity.generation == generation)
            .cloned()
            .ok_or_else(|| {
                error(
                    "jumpserver_auth_expired",
                    "JumpServer 登录已失效，请重新登录。",
                )
            })
    }
    fn check(&self, id: &str, login: &Arc<Login>) -> AppResult<()> {
        if self
            .lock()?
            .logins
            .get(id)
            .is_some_and(|current| Arc::ptr_eq(current, login))
        {
            Ok(())
        } else {
            Err(error(
                "jumpserver_auth_expired",
                "JumpServer 身份已变更，此请求已取消。",
            ))
        }
    }
    pub async fn assets(&self, q: JumpServerQuery) -> AppResult<JumpServerPage<JumpServerAsset>> {
        let l = self.login_context(&q.profile_id, &q.generation)?;
        let result = l.api.assets(&q).await?;
        self.check(&q.profile_id, &l)?;
        Ok(result)
    }
    pub async fn nodes(
        &self,
        id: &str,
        generation: &str,
        offset: u32,
    ) -> AppResult<JumpServerPage<JumpServerNode>> {
        let l = self.login_context(id, generation)?;
        let result = l.api.nodes(offset).await?;
        self.check(id, &l)?;
        Ok(result)
    }
    pub async fn accounts(
        &self,
        id: &str,
        generation: &str,
        asset: &str,
    ) -> AppResult<Vec<JumpServerAccount>> {
        let l = self.login_context(id, generation)?;
        let result = api::accounts(&l.api.detail(asset).await?)?;
        self.check(id, &l)?;
        Ok(result)
    }
    pub fn register_target(&self, target: JumpServerTarget) -> AppResult<SshProfile> {
        validate_id(&target.asset_id)?;
        if target.account_alias.is_empty()
            || target.account_alias.len() > 128
            || target.account_alias.chars().any(char::is_control)
            || target.account_label.len() > 256
            || target.account_label.chars().any(char::is_control)
            || target.asset_name.len() > 256
            || target.asset_name.chars().any(char::is_control)
        {
            return Err(invalid());
        }
        let login = self.login_context(&target.profile_id, &target.generation)?;
        let mut state = self.lock()?;
        // Reuse a non-secret identity, never a grant or transport.
        let key = state
            .targets
            .iter()
            .find(|(_, t)| {
                t.profile_id == target.profile_id
                    && t.generation == target.generation
                    && t.asset_id == target.asset_id
                    && t.account_alias == target.account_alias
            })
            .map(|(id, _)| id.clone())
            .unwrap_or_else(|| format!("jms:{}", nonce()));
        state.targets.insert(key.clone(), target.clone());
        Ok(source_profile(&key, &target, &login.name))
    }
    pub fn source(&self, id: &str) -> AppResult<SshProfile> {
        let t = self.lock()?.targets.get(id).cloned().ok_or_else(|| {
            error(
                "jumpserver_target_missing",
                "资产连接上下文已失效，请从资产工作台重新连接。",
            )
        })?;
        let l = self.login_context(&t.profile_id, &t.generation)?;
        Ok(source_profile(id, &t, &l.name))
    }
    pub async fn prepare(&self, id: &str) -> AppResult<SshProfile> {
        let target = self.lock()?.targets.get(id).cloned().ok_or_else(invalid)?;
        let login = self.login_context(&target.profile_id, &target.generation)?;
        let detail = login.api.detail(&target.asset_id).await?;
        if detail["is_active"].as_bool() == Some(false) {
            return Err(error("jumpserver_permission_denied", "此资产已禁用。"));
        }
        let account = api::accounts(&detail)?
            .into_iter()
            .find(|a| a.alias == target.account_alias && a.supported)
            .ok_or_else(|| {
                error(
                    "jumpserver_permission_denied",
                    "此账号未授权或需要手动凭据，请在官方 Web 检查。",
                )
            })?;
        let grant = login.api.grant(&target.asset_id, &account.alias).await?;
        self.check(&target.profile_id, &login)?;
        let mut profile = source_profile(id, &target, &login.name);
        profile.name = format!(
            "{} / {} · {}",
            login.name,
            required(&detail, "name")?,
            account.username
        );
        profile.host = grant.host;
        profile.port = grant.port;
        profile.username = grant.username;
        profile.updated_at = nonce(); // Each attempt must acquire a new transport.
        profile.auth_method = AuthMethod::Password {
            secret_ref: Some(grant.password.to_string()),
        };
        Ok(profile)
    }
    // Invalidate first, so in-flight requests and reconnects cannot resurrect a login.
    pub fn logout(&self, id: &str) -> AppResult<Vec<String>> {
        let mut state = self.lock()?;
        state.epochs.insert(id.into(), nonce());
        state.logins.remove(id);
        state.pending.remove(id);
        state.attempt_owners.remove(id);
        state.secrets.remove(id);
        let ids = state
            .targets
            .iter()
            .filter(|(_, t)| t.profile_id == id)
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>();
        // Retain non-secret target IDs until teardown acknowledges completion,
        // so a failed close can be retried after the login has been invalidated.
        Ok(ids)
    }
    pub fn forget_targets(&self, ids: &[String]) -> AppResult<()> {
        self.lock()?.targets.retain(|id, _| !ids.contains(id));
        Ok(())
    }
}
fn source_profile(id: &str, target: &JumpServerTarget, platform: &str) -> SshProfile {
    SshProfile {
        folder: String::new(),
        id: id.into(),
        name: format!(
            "{platform} / {} · {}",
            target.asset_name,
            if target.account_label.is_empty() {
                &target.account_alias
            } else {
                &target.account_label
            }
        ),
        host: String::new(),
        port: 0,
        username: String::new(),
        auth_method: AuthMethod::Password { secret_ref: None },
        proxy: None,
        description: None,
        favorite: false,
        icon: "server".into(),
        tags: vec![],
        created_at: String::new(),
        updated_at: target.generation.clone(),
    }
}

#[cfg(test)]
mod tests {

    #[test]
    fn cloning_a_platform_creates_a_new_identity_without_a_login() {
        let dir = std::env::temp_dir().join(format!("dssh-jms-clone-{}", nonce()));
        let repo = ProfileRepository::initialize(&dir, "test.db").unwrap();
        let manager = JumpServerManager::default();
        let source = manager
            .save(
                &repo,
                serde_json::from_value(serde_json::json!({
                    "name":"Original", "coreUrl":"https://example.invalid/", "authKind":"password",
                    "username":"alice", "orgId":"org-a", "rememberSecret":false
                }))
                .unwrap(),
            )
            .unwrap();
        let mut request = serde_json::json!({"cloneSourceId":source.id, "name":"Original 克隆",
            "coreUrl":source.core_url, "authKind":"password", "username":"alice", "orgId":"org-a", "rememberSecret":false});
        request["id"] = serde_json::json!(source.id);
        assert!(
            manager
                .save(&repo, serde_json::from_value(request.clone()).unwrap())
                .is_err()
        );
        request.as_object_mut().unwrap().remove("id");
        let clone = manager
            .save(&repo, serde_json::from_value(request).unwrap())
            .unwrap();
        assert_ne!(clone.id, source.id);
        assert_eq!(clone.core_url, source.core_url);
        assert_eq!(clone.username, source.username);
        assert!(!clone.has_credential);
        assert!(!manager.lock().unwrap().logins.contains_key(&clone.id));
        manager.delete(&repo, &source.id).unwrap();
        assert!(repo.get_jumpserver_profile(&clone.id).is_ok());
        let _ = std::fs::remove_dir_all(dir);
    }
    use super::*;
    #[test]
    fn logout_invalidates_pending_login_and_target_generation() {
        let m = JumpServerManager::default();
        let profile = JumpServerProfile {
            id: "platform".into(),
            name: "test".into(),
            folder: String::new(),
            core_url: "https://example.invalid/".into(),
            key_id: "test".into(),
            auth_kind: JumpServerAuthKind::AccessKey,
            username: String::new(),
            ssh_profile_id: None,
            org_id: "org-a".into(),
            has_credential: false,
        };
        let identity = JumpServerIdentity {
            user_id: "user-a".into(),
            username: "alice".into(),
            org_id: "org-a".into(),
            generation: "generation-a".into(),
        };
        let l = Arc::new(Login {
            api: Api::new(&profile, Zeroizing::new("synthetic-secret".into())).unwrap(),
            identity,
            name: "test".into(),
        });
        m.lock()
            .unwrap()
            .logins
            .insert("platform".into(), l.clone());
        let target = |asset: &str| JumpServerTarget {
            profile_id: "platform".into(),
            generation: "generation-a".into(),
            asset_id: asset.into(),
            asset_name: "same-name".into(),
            account_alias: "alias".into(),
            account_label: "deploy".into(),
        };
        let a = m.register_target(target("asset-a")).unwrap();
        let b = m.register_target(target("asset-b")).unwrap();
        assert_ne!(a.id, b.id);
        assert_eq!(a.id, m.register_target(target("asset-a")).unwrap().id);
        let json = serde_json::to_string(&a).unwrap();
        assert!(!json.contains("synthetic-secret"));
        assert!(!json.contains("JMS-"));
        let ids = m.logout("platform").unwrap();
        assert_eq!(ids.len(), 2);
        assert!(m.check("platform", &l).is_err());
        assert!(m.source(&a.id).is_err());
        assert!(m.register_target(target("asset-a")).is_err());
    }
    fn pending_fixture(manager: &JumpServerManager) -> Arc<PendingLogin> {
        let profile:JumpServerProfile=serde_json::from_value(serde_json::json!({"id":"platform","name":"test","coreUrl":"https://example.invalid/","authKind":"password","username":"alice","orgId":"org-a","hasCredential":false})).unwrap();
        let pending = Arc::new(PendingLogin {
            challenge_id: "challenge-a".into(),
            owner: "main".into(),
            generation: "generation-a".into(),
            profile,
            created: Instant::now(),
            attempts: AtomicUsize::new(0),
            flow: tokio::sync::Mutex::new(Some(password_auth::PasswordLogin::test_anonymous(
                reqwest::Url::parse("http://127.0.0.1/").unwrap(),
            ))),
        });
        let mut state = manager.lock().unwrap();
        state
            .epochs
            .insert("platform".into(), "generation-a".into());
        state
            .attempt_owners
            .insert("platform".into(), "main".into());
        state.pending.insert("platform".into(), pending.clone());
        pending
    }
    #[tokio::test]
    async fn otp_is_window_owned_single_flight_and_cannot_resume_after_cancel() {
        let manager = JumpServerManager::default();
        let pending = pending_fixture(&manager);
        assert_eq!(
            manager
                .verify_otp(
                    "platform",
                    "challenge-a",
                    "detached-other",
                    Zeroizing::new("123456".into())
                )
                .await
                .err()
                .unwrap()
                .code,
            "jumpserver_otp_expired"
        );
        manager
            .cancel_password_login("platform", "challenge-a", "detached-other")
            .unwrap();
        assert!(manager.lock().unwrap().pending.contains_key("platform"));
        let lock = pending.flow.lock().await;
        assert_eq!(
            manager
                .verify_otp(
                    "platform",
                    "challenge-a",
                    "main",
                    Zeroizing::new("123456".into())
                )
                .await
                .err()
                .unwrap()
                .code,
            "jumpserver_otp_busy"
        );
        drop(lock);
        manager
            .cancel_password_login("platform", "challenge-a", "main")
            .unwrap();
        assert!(
            manager
                .verify_otp(
                    "platform",
                    "challenge-a",
                    "main",
                    Zeroizing::new("123456".into())
                )
                .await
                .is_err()
        );
        assert!(!manager.lock().unwrap().pending.contains_key("platform"));
    }
    #[tokio::test]
    async fn closing_owner_prevents_an_in_flight_password_identity_from_committing() {
        let manager = JumpServerManager::default();
        let pending = pending_fixture(&manager);
        let (url, server) = password_auth::tests::fixture(vec![(
            200,
            serde_json::json!({"id":"alice-id","username":"alice"}),
            vec![],
        )])
        .await;
        let api = Api::test_anonymous(url).with_bearer(Zeroizing::new("synthetic-bearer".into()));
        manager.cancel_owner("main");
        let result = manager
            .finish_login(pending.profile.clone(), &pending.generation, api)
            .await;
        assert_eq!(result.err().unwrap().code, "jumpserver_cancelled");
        assert!(manager.identity("platform").unwrap().is_none());
        assert!(!manager.lock().unwrap().pending.contains_key("platform"));
        server.await.unwrap();
    }
    #[test]
    fn password_profiles_reference_saved_ssh_without_copying_either_credential() {
        let dir = std::env::temp_dir().join(format!("dssh-password-auth-{}", nonce()));
        let repo = ProfileRepository::initialize(&dir, "test.db").unwrap();
        let manager = JumpServerManager::default();
        let ssh=repo.create_profile(serde_json::from_value(serde_json::json!({"name":"original SSH","host":"gateway.example.invalid","port":2222,"username":"alice","authMethod":{"type":"password","secretRef":"synthetic-ssh-password"},"favorite":false})).unwrap()).unwrap();
        let profile=manager.save(&repo,serde_json::from_value(serde_json::json!({"name":"platform","coreUrl":"https://example.invalid/","authKind":"password","username":"alice","orgId":"org-a","secret":"synthetic-password","rememberSecret":false,"sshProfileId":ssh.id})).unwrap()).unwrap();
        assert!(matches!(profile.auth_kind, JumpServerAuthKind::Password));
        assert_eq!(profile.ssh_profile_id.as_deref(), Some(ssh.id.as_str()));
        assert!(!profile.has_credential);
        let encoded = serde_json::to_string(&repo.list_jumpserver_profiles().unwrap()).unwrap();
        assert!(!encoded.contains("synthetic-password"));
        assert!(!encoded.contains("synthetic-ssh-password"));
        assert!(
            repo.get_jumpserver_profile(&profile.id)
                .unwrap()
                .1
                .is_none()
        );
        let changed=manager.save(&repo,serde_json::from_value(serde_json::json!({"id":profile.id,"name":"platform","coreUrl":"https://example.invalid/","authKind":"accessKey","keyId":"new-key","orgId":"org-a","rememberSecret":false})).unwrap()).unwrap();
        assert!(!manager.lock().unwrap().secrets.contains_key(&changed.id));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
