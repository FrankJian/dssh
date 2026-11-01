//! Core v4-style REST adapter. Raw HTTP errors, bodies and client URLs never escape this module.
use crate::{
    error::{AppError, AppResult},
    models::jumpserver::*,
};
use base64::{Engine, engine::general_purpose::STANDARD};
use hmac::{Hmac, Mac};
use reqwest::{
    Client, Method, Url,
    header::{AUTHORIZATION, HeaderValue},
};
use serde_json::{Value, json};
use sha2::Sha256;
use std::time::{Duration, SystemTime};
use zeroize::Zeroizing;

const MAX_RESPONSE: usize = 4 * 1024 * 1024;
pub const PAGE_SIZE: u32 = 50;

pub fn error(code: &str, message: &str) -> AppError {
    AppError::new(code, message)
}
pub fn invalid() -> AppError {
    error(
        "jumpserver_response",
        "JumpServer 响应格式不兼容，请核对 Core / KoKo 版本。",
    )
}
pub fn validate_id(id: &str) -> AppResult<()> {
    if id.is_empty()
        || id.len() > 128
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err(error("jumpserver_invalid", "JumpServer 标识格式无效。"));
    }
    Ok(())
}
pub fn core_url(input: &str) -> AppResult<Url> {
    let url = Url::parse(input.trim())
        .map_err(|_| error("jumpserver_url", "请输入有效的 Core HTTPS 地址。"))?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
    {
        return Err(error(
            "jumpserver_url",
            "Core 地址须为 HTTPS 站点根地址，不含账号、路径或查询参数。",
        ));
    }
    Ok(url)
}

pub struct Api {
    pub(super) client: Client,
    pub(super) base: Url,
    key_id: String,
    secret: Zeroizing<String>,
    org_id: String,
    bearer: Option<Zeroizing<String>>,
}
impl Api {
    pub fn new(profile: &JumpServerProfile, secret: Zeroizing<String>) -> AppResult<Self> {
        validate_id(&profile.key_id)?;
        let mut api = Self::unauthenticated(profile)?;
        api.key_id = profile.key_id.clone();
        api.secret = secret;
        Ok(api)
    }

    pub(super) fn unauthenticated(profile: &JumpServerProfile) -> AppResult<Self> {
        validate_id(&profile.org_id)?;
        let mut builder = Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(25));
        // Trust the OS certificate store in addition to the bundled public roots.
        for cert in rustls_native_certs::load_native_certs().certs {
            if let Ok(cert) = reqwest::Certificate::from_der(cert.as_ref()) {
                builder = builder.add_root_certificate(cert);
            }
        }
        Ok(Self {
            client: builder.build().map_err(|_| invalid())?,
            base: core_url(&profile.core_url)?,
            key_id: String::new(),
            secret: Zeroizing::new(String::new()),
            org_id: profile.org_id.clone(),
            bearer: None,
        })
    }

    #[cfg(test)]
    pub(super) fn test_anonymous(base: Url) -> Self {
        Self {
            client: Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .unwrap(),
            base,
            key_id: String::new(),
            secret: Zeroizing::new(String::new()),
            org_id: "org-a".into(),
            bearer: None,
        }
    }

    pub(super) fn with_bearer(mut self, token: Zeroizing<String>) -> Self {
        self.bearer = Some(token);
        self
    }

    pub async fn request(
        &self,
        method: Method,
        path: &str,
        params: &[(&str, String)],
        body: Option<Value>,
    ) -> AppResult<Value> {
        let mut url = self.base.join(path).map_err(|_| invalid())?;
        if url.origin() != self.base.origin() || !url.path().starts_with("/api/v1/") {
            return Err(invalid());
        }
        if !params.is_empty() {
            url.query_pairs_mut()
                .extend_pairs(params.iter().map(|(k, v)| (*k, v)));
        }
        if path.starts_with("/api/v1/perms/users/my/") {
            url.query_pairs_mut().append_pair("org_id", &self.org_id);
        }
        let date = httpdate::fmt_http_date(SystemTime::now());
        let target = match url.query() {
            Some(q) => format!("{}?{q}", url.path()),
            None => url.path().to_string(),
        };
        let authorization = Zeroizing::new(match &self.bearer {
            Some(token) => format!("Bearer {}", token.as_str()),
            None => signature(&self.key_id, &self.secret, method.as_str(), &target, &date)?,
        });
        let mut auth = HeaderValue::from_str(&authorization).map_err(|_| invalid())?;
        auth.set_sensitive(true);
        let mut request = self
            .client
            .request(method, url)
            .header(AUTHORIZATION, auth)
            .header("Accept", "application/json")
            .header("Date", date)
            .header("X-JMS-ORG", &self.org_id);
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request.send().await.map_err(|_| {
            error(
                "jumpserver_network",
                "无法访问 Core，请检查网络、代理和 HTTPS 证书。",
            )
        })?;
        match response.status().as_u16() {
            200..=299 => {}
            401 => {
                return Err(error(
                    "jumpserver_auth_expired",
                    "API 认证失败或已过期，请重新登录；Access Key 模式还需核对系统时间。",
                ));
            }
            403 => {
                return Err(error(
                    "jumpserver_permission_denied",
                    "当前身份无此权限，或需要额外验证；请在官方 Web 检查授权。",
                ));
            }
            400 | 409 => {
                return Err(error(
                    "jumpserver_policy",
                    "连接请求被拒绝，可能需要审批、额外验证或不同连接方法。请在官方 Web 检查。",
                ));
            }
            404 => {
                return Err(error(
                    "jumpserver_not_found",
                    "资产或 API 不存在，可能已被移除或版本不兼容。",
                ));
            }
            429 => {
                return Err(error(
                    "jumpserver_rate_limit",
                    "JumpServer 请求过于频繁，请稍后重试。",
                ));
            }
            300..=399 => {
                return Err(error(
                    "jumpserver_redirect",
                    "Core 返回重定向；请使用最终的 HTTPS 站点地址。",
                ));
            }
            _ => {
                return Err(error(
                    "jumpserver_server",
                    "JumpServer 服务暂不可用，请稍后重试。",
                ));
            }
        }
        read_response(response).await
    }

    pub async fn get(&self, path: &str) -> AppResult<Value> {
        self.request(Method::GET, path, &[], None).await
    }
    pub async fn detail(&self, id: &str) -> AppResult<Value> {
        validate_id(id)?;
        let detail = self
            .get(&format!("/api/v1/perms/users/my/assets/{id}/"))
            .await?;
        if detail["org_id"].as_str() != Some(&self.org_id) || detail["id"].as_str() != Some(id) {
            return Err(error(
                "jumpserver_permission_denied",
                "资产不属于当前组织或身份，请刷新授权目录。",
            ));
        }
        Ok(detail)
    }
    pub async fn assets(
        &self,
        query: &JumpServerQuery,
    ) -> AppResult<JumpServerPage<JumpServerAsset>> {
        if query.search.len() > 256 || query.offset > 1_000_000 {
            return Err(invalid());
        }
        let path = if let Some(node) = &query.node_id {
            validate_id(node)?;
            format!("/api/v1/perms/users/my/nodes/{node}/assets/")
        } else {
            "/api/v1/perms/users/my/assets/".into()
        };
        let value = self
            .request(
                Method::GET,
                &path,
                &[
                    ("limit", PAGE_SIZE.to_string()),
                    ("offset", query.offset.to_string()),
                    ("search", query.search.clone()),
                ],
                None,
            )
            .await?;
        let value = org_page(value, &self.org_id)?;
        page(&value, |v| {
            Ok(JumpServerAsset {
                id: required(v, "id")?,
                name: required(v, "name")?,
                address: required(v, "address")?,
                node_ids: asset_node_ids(v),
                active: v["is_active"].as_bool().unwrap_or(true),
            })
        })
    }
    pub async fn nodes(&self, offset: u32) -> AppResult<JumpServerPage<JumpServerNode>> {
        if offset > 1_000_000 {
            return Err(invalid());
        }
        let value = self
            .request(
                Method::GET,
                "/api/v1/perms/users/my/nodes/",
                &[
                    ("limit", PAGE_SIZE.to_string()),
                    ("offset", offset.to_string()),
                ],
                None,
            )
            .await?;
        let value = org_page(value, &self.org_id)?;
        page(&value, |v| {
            Ok(JumpServerNode {
                id: required(v, "id")?,
                name: v["full_value"]
                    .as_str()
                    .or(v["value"].as_str())
                    .or(v["name"].as_str())
                    .ok_or_else(invalid)?
                    .into(),
                key: v["key"].as_str().unwrap_or("").into(),
            })
        })
    }
    pub async fn grant(&self, asset: &str, alias: &str) -> AppResult<Grant> {
        let token = self.request(Method::POST, "/api/v1/authentication/connection-token/", &[], Some(json!({
            "asset": asset, "account": alias, "protocol": "ssh", "connect_method": "ssh_client", "is_reusable": false
        }))).await?;
        // Missing validity is deliberately not treated as permission to connect.
        if token["is_active"].as_bool() != Some(true) || token["is_expired"].as_bool() == Some(true)
        {
            return Err(error(
                "jumpserver_approval_required",
                "连接尚未获准或已过期，请在官方 Web 完成审批或额外验证后重试。",
            ));
        }
        let token_id = required(&token, "id")?;
        validate_id(&token_id)?;
        let token_value = Zeroizing::new(required(&token, "value")?);
        let result = self
            .get(&format!(
                "/api/v1/authentication/connection-token/{token_id}/client-url/"
            ))
            .await?;
        parse_grant(&result, &token_id, token_value, asset)
    }
}

pub(super) async fn read_response(mut response: reqwest::Response) -> AppResult<Value> {
    if response
        .content_length()
        .is_some_and(|len| len > MAX_RESPONSE as u64)
    {
        return Err(invalid());
    }
    let mut bytes = Zeroizing::new(Vec::new());
    while let Some(chunk) = response.chunk().await.map_err(|_| invalid())? {
        if bytes.len().saturating_add(chunk.len()) > MAX_RESPONSE {
            return Err(invalid());
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| invalid())
}

// Official Access Key example signs (request-target), accept and date, including the query.
fn signature(
    key_id: &str,
    secret: &str,
    method: &str,
    target: &str,
    date: &str,
) -> AppResult<String> {
    validate_id(key_id)?;
    let canonical = format!(
        "(request-target): {} {target}\naccept: application/json\ndate: {date}",
        method.to_ascii_lowercase()
    );
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).map_err(|_| invalid())?;
    mac.update(canonical.as_bytes());
    Ok(format!(
        "Signature keyId=\"{key_id}\",algorithm=\"hmac-sha256\",headers=\"(request-target) accept date\",signature=\"{}\"",
        STANDARD.encode(mac.finalize().into_bytes())
    ))
}

pub fn required(v: &Value, key: &str) -> AppResult<String> {
    v[key]
        .as_str()
        .filter(|s| !s.is_empty() && s.len() <= 4096 && !s.chars().any(char::is_control))
        .map(str::to_string)
        .ok_or_else(invalid)
}
fn page<T>(v: &Value, parse: impl Fn(&Value) -> AppResult<T>) -> AppResult<JumpServerPage<T>> {
    let array = v
        .as_array()
        .or_else(|| v["results"].as_array())
        .ok_or_else(invalid)?;
    let results = array.iter().map(parse).collect::<AppResult<Vec<_>>>()?;
    // Never follow server-supplied pagination URLs with credentials.
    let has_more = !v["next"].is_null() && v.get("next").is_some();
    Ok(JumpServerPage {
        results,
        count: v["count"].as_u64(),
        has_more,
    })
}

// Core serializers may return related nodes as IDs or small objects. Return
// identifiers only; never pass raw asset metadata through the frontend DTO.
fn asset_node_ids(value: &Value) -> Vec<String> {
    let mut ids = Vec::new();
    for node in value["nodes"].as_array().into_iter().flatten() {
        if let Some(id) = node.as_str().or_else(|| node["id"].as_str())
            && validate_id(id).is_ok()
            && !ids.iter().any(|existing| existing == id)
        {
            ids.push(id.to_string());
        }
    }
    ids
}

fn org_page(mut value: Value, org: &str) -> AppResult<Value> {
    let entries = if value.is_array() {
        value.as_array_mut()
    } else {
        value["results"].as_array_mut()
    }
    .ok_or_else(invalid)?;
    if entries
        .iter()
        .any(|entry| entry["org_id"].as_str().is_none())
    {
        return Err(invalid());
    }
    let old_len = entries.len();
    entries.retain(|entry| entry["org_id"].as_str() == Some(org));
    if entries.len() != old_len && !value.is_array() {
        value["count"] = Value::Null;
    }
    Ok(value)
}

pub fn accounts(v: &Value) -> AppResult<Vec<JumpServerAccount>> {
    let protocols = v["permed_protocols"].as_array().ok_or_else(invalid)?;
    if !protocols
        .iter()
        .any(|p| p["name"].as_str().or(p.as_str()) == Some("ssh"))
    {
        return Err(error(
            "jumpserver_method_unavailable",
            "此资产没有授权 SSH 协议。",
        ));
    }
    v["permed_accounts"]
        .as_array()
        .ok_or_else(invalid)?
        .iter()
        .map(|a| {
            let alias = required(a, "alias")?;
            Ok(JumpServerAccount {
                supported: !alias.starts_with('@') && a["has_secret"].as_bool() == Some(true),
                alias,
                name: required(a, "name")?,
                username: a["username"].as_str().unwrap_or("").into(),
            })
        })
        .collect()
}

pub struct Grant {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Zeroizing<String>,
}
fn parse_grant(
    value: &Value,
    token_id: &str,
    password: Zeroizing<String>,
    asset: &str,
) -> AppResult<Grant> {
    let url = value["url"]
        .as_str()
        .and_then(|s| s.strip_prefix("jms://"))
        .ok_or_else(invalid)?;
    if url.len() > 128 * 1024 {
        return Err(invalid());
    }
    let decoded = Zeroizing::new(STANDARD.decode(url).map_err(|_| invalid())?);
    let data: Value = serde_json::from_slice(&decoded).map_err(|_| invalid())?;
    if data["protocol"] != "ssh"
        || data["asset"]["id"] != asset
        || data["token"]["id"] != token_id
        || data["token"]["value"].as_str() != Some(password.as_str())
    {
        return Err(invalid());
    }
    let host = required(&data["endpoint"], "host")?;
    // Permit DNS, IPv4 and raw IPv6, never URLs, whitespace or shell fragments.
    if !host
        .bytes()
        .all(|c| c.is_ascii_alphanumeric() || b".-:_".contains(&c))
    {
        return Err(invalid());
    }
    let port = data["endpoint"]["port"]
        .as_u64()
        .and_then(|p| u16::try_from(p).ok())
        .filter(|p| *p != 0)
        .ok_or_else(invalid)?;
    Ok(Grant {
        host,
        port,
        username: format!("JMS-{token_id}"),
        password,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn url_rejects_credentials_paths_queries_and_insecure_transport() {
        for s in [
            "http://host",
            "https://u:p@host",
            "https://host/path",
            "https://host/?q=1",
            "https://host/#fragment",
            "file:///tmp/a",
        ] {
            assert!(core_url(s).is_err());
        }
        assert_eq!(
            core_url("https://host:8443").unwrap().as_str(),
            "https://host:8443/"
        );
    }
    #[test]
    fn signature_matches_independent_hmac_vector_and_signs_query() {
        let header = signature(
            "test-key",
            "test-secret",
            "GET",
            "/api/v1/assets/?search=a%26b",
            "Sun, 01 Nov 2026 00:00:00 GMT",
        )
        .unwrap();
        assert!(header.contains("headers=\"(request-target) accept date\""));
        assert!(header.ends_with("signature=\"99UqgAU2Sk5lnDBi8fjtLdA9WFb6ldldrcEaWXgkRVw=\""));
        assert_ne!(
            header,
            signature(
                "test-key",
                "test-secret",
                "GET",
                "/api/v1/assets/?search=a",
                "Sun, 01 Nov 2026 00:00:00 GMT"
            )
            .unwrap()
        );
        assert!(signature("bad\"id", "synthetic", "GET", "/", "date").is_err());
    }
    #[test]
    fn grant_checks_binding_and_preserves_non_default_endpoint() {
        let mut data = json!({"protocol":"ssh", "asset":{"id":"asset-a"}, "token":{"id":"test-token","value":"synthetic-password"}, "endpoint":{"host":"koko.example","port":32222}});
        let wrap = |d: &Value| json!({"url":format!("jms://{}",STANDARD.encode(d.to_string()))});
        let grant = parse_grant(
            &wrap(&data),
            "test-token",
            Zeroizing::new("synthetic-password".into()),
            "asset-a",
        )
        .unwrap();
        assert_eq!(grant.port, 32222);
        assert_eq!(grant.username, "JMS-test-token");
        assert!(
            parse_grant(
                &wrap(&data),
                "test-token",
                Zeroizing::new("synthetic-password".into()),
                "asset-b"
            )
            .is_err()
        );
        data["endpoint"]["port"] = json!(0);
        assert!(
            parse_grant(
                &wrap(&data),
                "test-token",
                Zeroizing::new("synthetic-password".into()),
                "asset-a"
            )
            .is_err()
        );
    }
    #[test]
    fn authorized_alias_is_not_replaced_with_display_username() {
        let v = json!({"permed_protocols":[{"name":"ssh"}],"permed_accounts":[{"alias":"uuid-a","name":"Admin","username":"root","has_secret":true},{"alias":"@INPUT","name":"Manual","has_secret":false}]});
        let a = accounts(&v).unwrap();
        assert_eq!(a[0].alias, "uuid-a");
        assert!(a[0].supported);
        assert!(!a[1].supported);
        assert!(accounts(&json!({"permed_protocols":[],"permed_accounts":[]})).is_err());
    }
    #[test]
    fn page_does_not_follow_untrusted_next_links() {
        let p = page(
            &json!({"count":51,"next":"https://untrusted.invalid/steal","results":[{"id":"a"}]}),
            |v| required(v, "id"),
        )
        .unwrap();
        assert!(p.has_more);
        assert_eq!(p.count, Some(51));
        assert_eq!(p.results, vec!["a"]);
        assert!(page(&json!({"secret":"unexpected"}), |v| required(v, "id")).is_err());
    }
    #[test]
    fn organization_filter_never_leaks_other_tenants_or_claims_their_total() {
        let value=org_page(json!({"count":2,"next":null,"results":[{"id":"a","org_id":"org-a"},{"id":"b","org_id":"org-b"}]}),"org-a").unwrap();
        assert_eq!(value["results"].as_array().unwrap().len(), 1);
        assert_eq!(value["results"][0]["id"], "a");
        assert!(value["count"].is_null());
        assert!(org_page(json!({"results":[{"id":"missing-org"}]}), "org-a").is_err());
    }

    // Exercise actual HTTP serialization, pagination and token exchange against a
    // loopback fixture, with synthetic credentials only. Production enforces HTTPS.
    #[tokio::test]
    async fn core_requests_sign_queries_bind_grants_and_redact_errors() {
        use tokio::{
            io::{AsyncReadExt, AsyncWriteExt},
            net::TcpListener,
        };
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = Url::parse(&format!("http://{}/", listener.local_addr().unwrap())).unwrap();
        let description = json!({"protocol":"ssh","asset":{"id":"asset-a"},"token":{"id":"token-a","value":"synthetic-password"},"endpoint":{"host":"koko.example","port":32222}});
        let responses = vec![
            (
                200,
                json!({"count":1,"next":null,"results":[{"id":"asset-a","name":"App","address":"10.0.0.1","org_id":"org-a","is_active":true}]}),
            ),
            (
                200,
                json!({"id":"token-a","value":"synthetic-password","is_active":true,"is_expired":false}),
            ),
            (
                200,
                json!({"url":format!("jms://{}",STANDARD.encode(description.to_string()))}),
            ),
            (403, json!({"detail":"synthetic-password must not escape"})),
        ];
        let server = tokio::spawn(async move {
            let mut captured = vec![];
            for (status, body) in responses {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut bytes = vec![];
                let mut buffer = [0u8; 4096];
                loop {
                    let n = stream.read(&mut buffer).await.unwrap();
                    assert!(n > 0);
                    bytes.extend_from_slice(&buffer[..n]);
                    if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                        let header = String::from_utf8_lossy(&bytes[..end]).to_ascii_lowercase();
                        let length = header
                            .lines()
                            .find_map(|l| l.strip_prefix("content-length: "))
                            .map(|v| v.parse::<usize>().unwrap())
                            .unwrap_or(0);
                        if bytes.len() >= end + 4 + length {
                            break;
                        }
                    }
                }
                captured.push(String::from_utf8(bytes).unwrap());
                let body = body.to_string();
                stream.write_all(format!("HTTP/1.1 {status} Fixture\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).as_bytes()).await.unwrap();
            }
            captured
        });
        let api = Api {
            client: Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .unwrap(),
            base,
            key_id: "test-key".into(),
            secret: Zeroizing::new("test-secret".into()),
            org_id: "org-a".into(),
            bearer: None,
        };
        let page = api
            .assets(&JumpServerQuery {
                profile_id: "platform".into(),
                generation: "generation".into(),
                search: "app & prod".into(),
                offset: 50,
                node_id: None,
            })
            .await
            .unwrap();
        assert_eq!(page.results[0].name, "App");
        let grant = api.grant("asset-a", "account-alias").await.unwrap();
        assert_eq!(grant.port, 32222);
        let err = api.get("/api/v1/denied/").await.err().unwrap();
        assert_eq!(err.code, "jumpserver_permission_denied");
        assert!(!err.message.contains("synthetic-password"));
        let requests = server.await.unwrap();
        assert!(requests[0].starts_with("GET /api/v1/perms/users/my/assets/?limit=50&offset=50&search=app+%26+prod&org_id=org-a HTTP/1.1"));
        assert!(
            requests[0]
                .to_ascii_lowercase()
                .contains("x-jms-org: org-a")
        );
        assert!(requests[0].contains("Signature keyId=\"test-key\""));
        let body = requests[1].split("\r\n\r\n").nth(1).unwrap();
        let body: Value = serde_json::from_str(body).unwrap();
        assert_eq!(body["account"], "account-alias");
        assert_eq!(body["connect_method"], "ssh_client");
        assert_eq!(body["is_reusable"], false);
        assert!(
            requests[2]
                .starts_with("GET /api/v1/authentication/connection-token/token-a/client-url/")
        );
    }
    #[test]
    fn asset_directory_relations_expose_only_valid_unique_ids() {
        assert_eq!(
            asset_node_ids(
                &json!({"nodes":["node-a",{"id":"node-b","secret":"not-forwarded"},"node-a",{"id":"../bad"},null]})
            ),
            vec!["node-a", "node-b"]
        );
        assert!(asset_node_ids(&json!({})).is_empty());
    }
}
