use genai::adapter::AdapterKind;
use genai::resolver::{AuthData, Endpoint, ServiceTargetResolver};
use genai::{Client, ModelIden, ServiceTarget};
use reqwest::header::HeaderMap;

use crate::{
    ai::copilot,
    error::{AppError, AppResult},
    models::ai::AiProviderConfig,
};

/// Build a genai client bound to a user-configured OpenAI-compatible endpoint.
///
/// We route every request through a `ServiceTargetResolver` so the endpoint,
/// auth, and adapter are taken from the UI config instead of environment
/// variables or model-name inference. Treating the backend as OpenAI-compatible
/// covers the vast majority of providers (OpenAI, DeepSeek, Groq, xAI,
/// OpenRouter, Together, Ollama, LM Studio, vLLM, ...). An optional proxy is
/// applied by injecting a custom reqwest client.
pub fn build_client(provider: &AiProviderConfig) -> AppResult<Client> {
    let base_url = normalize_base_url(&provider.base_url);
    let api_key = provider.api_key.clone();

    let resolver = ServiceTargetResolver::from_resolver_fn(
        move |service_target: ServiceTarget| -> Result<ServiceTarget, genai::resolver::Error> {
            let ServiceTarget { model, .. } = service_target;
            let endpoint = Endpoint::from_owned(base_url.clone());
            let auth = if api_key.trim().is_empty() {
                AuthData::from_single("no-key")
            } else {
                AuthData::from_single(api_key.clone())
            };
            let model = ModelIden::new(AdapterKind::OpenAI, model.model_name);
            Ok(ServiceTarget {
                endpoint,
                auth,
                model,
            })
        },
    );

    let http_client = build_reqwest_client(&provider.proxy_url)?;

    Ok(Client::builder()
        .with_service_target_resolver(resolver)
        .with_reqwest(http_client)
        .build())
}

/// Build a genai client for GitHub Copilot: routes to the account's resolved
/// API base with the short-lived session token as the bearer, and injects the
/// editor-identity headers Copilot requires (via the reqwest default headers,
/// which genai does not override).
pub fn build_copilot_client(api_base: &str, token: &str, proxy_url: &str) -> AppResult<Client> {
    let base_url = normalize_base_url(api_base);
    let token = token.to_string();

    let resolver = ServiceTargetResolver::from_resolver_fn(
        move |service_target: ServiceTarget| -> Result<ServiceTarget, genai::resolver::Error> {
            let ServiceTarget { model, .. } = service_target;
            Ok(ServiceTarget {
                endpoint: Endpoint::from_owned(base_url.clone()),
                auth: AuthData::from_single(token.clone()),
                model: ModelIden::new(AdapterKind::OpenAI, model.model_name),
            })
        },
    );

    let http_client = build_reqwest_client_with(proxy_url, Some(copilot::api_headers()))?;

    Ok(Client::builder()
        .with_service_target_resolver(resolver)
        .with_reqwest(http_client)
        .build())
}

/// Build a reqwest client, optionally routing traffic through a proxy
/// (http/https/socks5). An empty proxy URL yields a direct client.
pub fn build_reqwest_client(proxy_url: &str) -> AppResult<reqwest::Client> {
    build_reqwest_client_with(proxy_url, None)
}

/// Like [`build_reqwest_client`] but with optional default headers applied to
/// every request (used to inject Copilot's editor-identity headers).
pub fn build_reqwest_client_with(
    proxy_url: &str,
    headers: Option<HeaderMap>,
) -> AppResult<reqwest::Client> {
    let mut builder = reqwest::Client::builder();
    if let Some(headers) = headers {
        builder = builder.default_headers(headers);
    }
    let trimmed = proxy_url.trim();
    if !trimmed.is_empty() {
        let proxy = reqwest::Proxy::all(trimmed)
            .map_err(|error| AppError::new("ai_proxy_error", format!("代理地址无效：{error}")))?;
        builder = builder.proxy(proxy);
    }
    builder
        .build()
        .map_err(|error| AppError::new("ai_request_error", error.to_string()))
}

/// Ensure the base URL ends with a single trailing slash, since genai appends
/// the `chat/completions` path relative to it.
pub fn normalize_base_url(base_url: &str) -> String {
    let trimmed = base_url.trim();
    if trimmed.is_empty() {
        return trimmed.to_string();
    }
    if trimmed.ends_with('/') {
        trimmed.to_string()
    } else {
        format!("{trimmed}/")
    }
}
