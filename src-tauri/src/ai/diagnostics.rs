//! Safe diagnostic text only; credentials never leave Rust, including error echoes.
use base64::Engine;
use serde_json::{Value, json};

pub struct Redactor {
    secrets: Vec<String>,
}

impl Redactor {
    #[cfg(test)]
    pub fn new(api_key: Option<&str>, proxy: &str) -> Self {
        Self::with_values(api_key, proxy, std::iter::empty())
    }

    pub fn with_values<'a>(
        api_key: Option<&str>,
        proxy: &str,
        values: impl Iterator<Item = &'a str>,
    ) -> Self {
        let mut secrets: Vec<String> = api_key
            .into_iter()
            .filter(|key| !key.is_empty())
            .map(String::from)
            .collect();
        if let Ok(url) = reqwest::Url::parse(proxy)
            && let Some(password) = url.password().filter(|password| !password.is_empty())
        {
            secrets.push(password.into());
            secrets.push(decode_percent(password));
        }
        secrets.extend(values.filter(|value| !value.is_empty()).map(String::from));
        // Gateways sometimes echo only the credential, without its auth scheme.
        let mut auth_secrets = Vec::new();
        for secret in &secrets {
            if let Some((scheme, credential)) = secret.split_once(' ')
                && !credential.trim().is_empty()
                && (scheme.eq_ignore_ascii_case("bearer") || scheme.eq_ignore_ascii_case("basic"))
            {
                auth_secrets.push(credential.trim().to_string());
                if scheme.eq_ignore_ascii_case("basic")
                    && let Ok(bytes) =
                        base64::engine::general_purpose::STANDARD.decode(credential.trim())
                    && let Ok(decoded) = String::from_utf8(bytes)
                {
                    if let Some((_, password)) = decoded.split_once(':')
                        && !password.is_empty()
                    {
                        auth_secrets.push(password.to_string());
                    }
                    auth_secrets.push(decoded);
                }
            }
        }
        secrets.extend(auth_secrets);
        let encoded: Vec<String> = secrets
            .iter()
            .flat_map(|secret| {
                let json = serde_json::to_string(secret).unwrap_or_default();
                let encoded: String = reqwest::Url::parse_with_params(
                    "https://redaction.invalid/",
                    &[("value", secret)],
                )
                .ok()
                .and_then(|url| {
                    url.query()
                        .map(|query| query.trim_start_matches("value=").to_string())
                })
                .unwrap_or_default();
                [json.trim_matches('"').to_string(), encoded]
            })
            .collect();
        secrets.extend(encoded.into_iter().filter(|value| !value.is_empty()));
        secrets.sort_by_key(|secret| std::cmp::Reverse(secret.len()));
        secrets.dedup();
        Self { secrets }
    }

    pub fn text(&self, value: &str) -> String {
        let mut value = value.to_string();
        for secret in &self.secrets {
            value = value.replace(secret, "[已脱敏]");
        }
        value.chars().take(4096).collect()
    }

    pub fn value(&self, value: &Value) -> Value {
        match value {
            Value::String(text) => Value::String(self.text(text)),
            Value::Array(items) => {
                Value::Array(items.iter().map(|value| self.value(value)).collect())
            }
            Value::Object(fields) => Value::Object(
                fields
                    .iter()
                    .map(|(key, value)| {
                        let normalized = key.to_ascii_lowercase().replace(['-', '_'], "");
                        let sensitive = matches!(
                            normalized.as_str(),
                            "authorization"
                                | "proxyauthorization"
                                | "xapikey"
                                | "apikey"
                                | "password"
                                | "secret"
                                | "token"
                                | "accesstoken"
                                | "refreshtoken"
                                | "cookie"
                                | "setcookie"
                        );
                        (
                            self.text(key),
                            if sensitive {
                                json!("[已脱敏]")
                            } else {
                                self.value(value)
                            },
                        )
                    })
                    .collect(),
            ),
            _ => value.clone(),
        }
    }
}

pub fn proxy_description(proxy: &str) -> String {
    if proxy.trim().is_empty() {
        return "系统 / 环境代理（未单独指定）".into();
    }
    safe_url(proxy).unwrap_or_else(|| "独立代理（地址无效）".into())
}

fn decode_percent(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut output = Vec::new();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%'
            && index + 2 < bytes.len()
            && let Ok(text) = std::str::from_utf8(&bytes[index + 1..index + 3])
            && let Ok(byte) = u8::from_str_radix(text, 16)
        {
            output.push(byte);
            index += 3;
            continue;
        }
        output.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&output).into_owned()
}

pub fn safe_url(value: &str) -> Option<String> {
    let mut url = reqwest::Url::parse(value).ok()?;
    let _ = url.set_username("");
    let _ = url.set_password(None);
    url.set_query(None);
    url.set_fragment(None);
    Some(url.to_string())
}

pub fn network_error(error: &reqwest::Error) -> (&'static str, String) {
    let kind = if error.is_timeout() {
        "timeout"
    } else if error.is_connect() {
        "connection"
    } else if error.is_builder() {
        "request_build"
    } else if error.is_body() || error.is_decode() {
        "response_body"
    } else {
        "network"
    };
    let mut causes = vec![error.to_string()];
    let mut source = std::error::Error::source(error);
    while let Some(cause) = source {
        let text = cause.to_string();
        if !causes.contains(&text) {
            causes.push(text);
        }
        if causes.len() >= 6 {
            break;
        }
        source = cause.source();
    }
    (kind, causes.join(" → "))
}

pub fn response_error(body: &Value, redactor: &Redactor) -> Option<Value> {
    let error = body.get("error")?;
    if let Some(message) = error.as_str() {
        return Some(json!({"message":redactor.text(message)}));
    }
    let mut output = serde_json::Map::new();
    for key in ["type", "code", "message", "param"] {
        if let Some(value) = error
            .get(key)
            .filter(|value| value.is_string() || value.is_number())
        {
            output.insert(key.into(), redactor.value(value));
        }
    }
    (!output.is_empty()).then_some(Value::Object(output))
}

pub fn status_hint(status: u16) -> &'static str {
    match status {
        300..=399 => "接口发生重定向，请填写最终 API 地址，检查是否指向网站或登录页。",
        400 | 422 => "请求参数不被服务接受，请检查模型、推理设置和协议。",
        401 => "认证失败，请检查 API Key 与该服务要求的认证方式。",
        402 => "账户余额或计费状态异常。",
        403 => "无访问权限，请检查模型授权、地域或网关限制。",
        404 => "接口或模型不存在，请检查最终 API 地址和模型 ID。",
        429 => "请求被限流，或账户额度已用尽。",
        500..=599 => "模型服务或中转网关异常。",
        _ => "模型服务拒绝了请求。",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn auth_credentials_remain_redacted_when_provider_omits_the_scheme() {
        let redactor = Redactor::with_values(
            None,
            "",
            ["Bearer bearer-secret", "Basic dXNlcjpiYXNpYy1zZWNyZXQ="].into_iter(),
        );
        let text =
            redactor.text("bearer-secret basic-secret user:basic-secret dXNlcjpiYXNpYy1zZWNyZXQ=");
        assert!(!text.contains("bearer-secret"));
        assert!(!text.contains("basic-secret"));
        assert!(!text.contains("dXNlcjpiYXNpYy1zZWNyZXQ="));
    }

    #[test]
    fn credentials_are_redacted_in_headers_body_errors_and_encoded_echoes() {
        let key = "synthetic/key+value";
        let redactor = Redactor::new(Some(key), "http://proxy-user:proxy%2Fpass@127.0.0.1:7890/");
        let data = json!({"headers":{"x-api-key":key,"Authorization":format!("Bearer {key}")},"max_tokens":1024,
            "message":format!("invalid key {key}, encoded synthetic%2Fkey%2Bvalue, proxy proxy/pass or proxy%2Fpass"),
            "nested":[{"apiKey":"other-key"},{"password":"other-password"}]});
        let safe = redactor.value(&data);
        let text = safe.to_string();
        for secret in [
            key,
            "synthetic%2Fkey%2Bvalue",
            "proxy/pass",
            "proxy%2Fpass",
            "other-key",
            "other-password",
        ] {
            assert!(!text.contains(secret));
        }
        assert_eq!(safe["max_tokens"], 1024);
        assert_eq!(
            proxy_description("http://user:password@127.0.0.1:7890/"),
            "http://127.0.0.1:7890/"
        );
    }
    #[test]
    fn service_errors_only_return_allowlisted_fields() {
        let redactor = Redactor::new(Some("synthetic-key"), "");
        let safe = response_error(&json!({"error":{"type":"invalid_request_error","message":"bad synthetic-key","debug":{"hidden":"not-for-ui"}}}), &redactor).unwrap();
        assert_eq!(safe["type"], "invalid_request_error");
        assert!(!safe.to_string().contains("synthetic-key"));
        assert!(safe.get("debug").is_none());
    }
}
