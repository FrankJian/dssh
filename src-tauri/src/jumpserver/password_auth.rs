//! Password -> OTP challenge -> bearer token, using one private Core session.
//! Cookies and tokens remain in Rust; server-provided challenge URLs are never followed.
use super::api::{Api, error, invalid, read_response, required};
use crate::{error::AppResult, models::jumpserver::JumpServerProfile};
use cookie::Cookie;
use reqwest::header::{COOKIE, HeaderValue, ORIGIN, REFERER, SET_COOKIE};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use zeroize::Zeroizing;

const AUTH_PATH: &str = "/api/v1/authentication/auth/";
const OTP_PATH: &str = "/api/v1/authentication/mfa/challenge/";

pub(super) struct PasswordLogin {
    api: Api,
    cookies: BTreeMap<String, Zeroizing<String>>,
}
impl PasswordLogin {
    #[cfg(test)]
    pub(super) fn test_anonymous(base: reqwest::Url) -> Self {
        Self {
            api: Api::test_anonymous(base),
            cookies: BTreeMap::new(),
        }
    }
    pub fn new(profile: &JumpServerProfile) -> AppResult<Self> {
        Ok(Self {
            api: Api::unauthenticated(profile)?,
            cookies: BTreeMap::new(),
        })
    }
    pub async fn begin(
        &mut self,
        username: &str,
        password: &str,
    ) -> AppResult<Option<Zeroizing<String>>> {
        let (status, value) = self
            .post(AUTH_PATH, json!({"username":username,"password":password}))
            .await?;
        login_result(status, &value)
    }
    pub async fn verify(&mut self, code: &str) -> AppResult<Zeroizing<String>> {
        if !(6..=8).contains(&code.len()) || !code.bytes().all(|b| b.is_ascii_digit()) {
            return Err(error(
                "jumpserver_otp_invalid",
                "请输入 6–8 位数字 OTP 验证码。",
            ));
        }
        let (status, response) = self
            .post(OTP_PATH, json!({"type":"otp","code":code}))
            .await?;
        if status == 400 || status == 401 {
            return Err(error(
                "jumpserver_otp_invalid",
                "OTP 错误、过期或验证会话失效，请检查验证码或重新登录。",
            ));
        }
        if status != 200 || response.get("error").is_some() || response["msg"] != "ok" {
            return Err(error(
                "jumpserver_auth_unsupported",
                "此验证流程需要其他交互，请使用原 SSH 登录或官方 Web。",
            ));
        }
        // Core retains the password-authenticated identity in this cookie session.
        // Do not retain/resend the password or the OTP to acquire the final token.
        let (status, value) = self.post(AUTH_PATH, json!({})).await?;
        login_result(status, &value)?.ok_or_else(|| {
            error(
                "jumpserver_auth_unsupported",
                "验证后仍需额外认证，请重新登录或使用原 SSH 连接。",
            )
        })
    }
    pub fn into_api(self, token: Zeroizing<String>) -> Api {
        self.api.with_bearer(token)
    }

    async fn post(&mut self, path: &str, body: Value) -> AppResult<(u16, Value)> {
        if !matches!(path, AUTH_PATH | OTP_PATH) {
            return Err(invalid());
        }
        let url = self.api.base.join(path).map_err(|_| invalid())?;
        if url.origin() != self.api.base.origin() {
            return Err(invalid());
        }
        let mut request = self
            .api
            .client
            .post(url)
            .header("Accept", "application/json")
            .header(ORIGIN, self.api.base.origin().ascii_serialization())
            .header(REFERER, self.api.base.as_str())
            .json(&body);
        if !self.cookies.is_empty() {
            let cookie = Zeroizing::new(
                self.cookies
                    .iter()
                    .map(|(k, v)| format!("{k}={}", v.as_str()))
                    .collect::<Vec<_>>()
                    .join("; "),
            );
            let mut header = HeaderValue::from_str(&cookie).map_err(|_| invalid())?;
            header.set_sensitive(true);
            request = request.header(COOKIE, header);
        }
        if let Some(csrf) = self
            .cookies
            .get("jms_csrftoken")
            .or_else(|| self.cookies.get("csrftoken"))
        {
            let mut header = HeaderValue::from_str(csrf).map_err(|_| invalid())?;
            header.set_sensitive(true);
            request = request.header("X-CSRFToken", header);
        }
        let response = request.send().await.map_err(|_| {
            error(
                "jumpserver_network",
                "无法访问 Core，请检查 HTTPS 地址、证书和网络。",
            )
        })?;
        let status = response.status().as_u16();
        if (300..400).contains(&status) {
            return Err(error(
                "jumpserver_redirect",
                "登录接口发生重定向，请使用最终 HTTPS Core 地址。",
            ));
        }
        if status == 429 {
            return Err(error(
                "jumpserver_rate_limit",
                "认证尝试过于频繁，请稍后重试。",
            ));
        }
        if status >= 500 {
            return Err(error("jumpserver_server", "JumpServer 认证服务暂不可用。"));
        }
        for header in response.headers().get_all(SET_COOKIE) {
            let raw = header.to_str().map_err(|_| invalid())?;
            self.capture_cookie(raw)?;
        }
        let value = read_response(response).await?;
        Ok((status, value))
    }
    fn capture_cookie(&mut self, raw: &str) -> AppResult<()> {
        if raw.len() > 8192 {
            return Err(invalid());
        }
        let cookie = Cookie::parse(raw).map_err(|_| invalid())?;
        let name = cookie.name();
        let value = cookie.value();
        if name.is_empty()
            || name.len() > 128
            || !name
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
            || value.len() > 4096
            || !value
                .bytes()
                .all(|b| matches!(b,0x21|0x23..=0x2B|0x2D..=0x3A|0x3C..=0x5B|0x5D..=0x7E))
        {
            return Err(invalid());
        }
        // This jar is confined to one origin and the two fixed login endpoints.
        // A cookie's Domain/Path can never widen where authentication is sent.
        if value.is_empty() || cookie.max_age().is_some_and(|age| age.whole_seconds() <= 0) {
            self.cookies.remove(name);
        } else {
            self.cookies
                .insert(name.into(), Zeroizing::new(value.into()));
        }
        if self.cookies.len() > 32
            || self
                .cookies
                .iter()
                .map(|(k, v)| k.len() + v.len() + 2)
                .sum::<usize>()
                > 16384
        {
            return Err(invalid());
        }
        Ok(())
    }
}

fn login_result(status: u16, value: &Value) -> AppResult<Option<Zeroizing<String>>> {
    if value["error"] == "mfa_required" && status == 200 {
        let choices = value["data"]["choices"].as_array().ok_or_else(invalid)?;
        let url = value["data"]["url"].as_str().unwrap_or(OTP_PATH);
        if url != OTP_PATH || !choices.iter().any(|v| v.as_str() == Some("otp")) {
            return Err(error(
                "jumpserver_auth_unsupported",
                "服务端要求的认证方式不属于 OTP，请使用原 SSH 连接或官方 Web。",
            ));
        }
        return Ok(None);
    }
    if value.get("error").is_some() && !value["error"].is_null() {
        return Err(error(
            "jumpserver_login_denied",
            "登录被拒绝或需要审批 / 额外验证，请核对凭据或使用原 SSH 连接。",
        ));
    }
    if status != 200 && status != 201 {
        return Err(error(
            "jumpserver_login_denied",
            "用户名或密码错误，或当前部署不允许 API 登录。",
        ));
    }
    if value.get("keyword").is_some() && value["keyword"] != "Bearer" {
        return Err(invalid());
    }
    Ok(Some(Zeroizing::new(required(value, "token")?)))
}

#[cfg(test)]
pub(super) mod tests {
    use super::*;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };
    type Reply = (u16, Value, Vec<(&'static str, &'static str)>);
    pub(crate) async fn fixture(
        replies: Vec<Reply>,
    ) -> (reqwest::Url, tokio::task::JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url =
            reqwest::Url::parse(&format!("http://{}/", listener.local_addr().unwrap())).unwrap();
        let task = tokio::spawn(async move {
            let mut requests = vec![];
            for (status, body, headers) in replies {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut bytes = vec![];
                let mut chunk = [0u8; 4096];
                loop {
                    let n = socket.read(&mut chunk).await.unwrap();
                    assert!(n > 0);
                    bytes.extend_from_slice(&chunk[..n]);
                    assert!(bytes.len() < 64 * 1024);
                    if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                        let header = String::from_utf8_lossy(&bytes[..end]).to_ascii_lowercase();
                        let len = header
                            .lines()
                            .find_map(|l| l.strip_prefix("content-length: "))
                            .map(|v| v.parse::<usize>().unwrap())
                            .unwrap_or(0);
                        if bytes.len() >= end + 4 + len {
                            break;
                        }
                    }
                }
                requests.push(String::from_utf8(bytes).unwrap());
                let data = body.to_string();
                let extra = headers
                    .iter()
                    .map(|(k, v)| format!("{k}: {v}\r\n"))
                    .collect::<String>();
                socket.write_all(format!("HTTP/1.1 {status} Fixture\r\nContent-Type: application/json\r\n{extra}Content-Length: {}\r\nConnection: close\r\n\r\n{data}",data.len()).as_bytes()).await.unwrap();
            }
            requests
        });
        (url, task)
    }
    #[tokio::test]
    async fn password_otp_cookie_rotation_and_bearer_identity_use_one_session() {
        let (url, server) = fixture(vec![
            (
                200,
                json!({"error":"mfa_required","data":{"choices":["otp"],"url":OTP_PATH}}),
                vec![
                    ("Set-Cookie", "jms_sessionid=phase1; HttpOnly; Path=/"),
                    ("Set-Cookie", "jms_csrftoken=csrf1; Path=/"),
                ],
            ),
            (
                401,
                json!({"error":"mfa_failed","msg":"synthetic-private-detail"}),
                vec![("Set-Cookie", "jms_sessionid=phase2; Path=/")],
            ),
            (
                200,
                json!({"msg":"ok"}),
                vec![
                    ("Set-Cookie", "jms_sessionid=phase3; Path=/"),
                    ("Set-Cookie", "jms_csrftoken=csrf2; Path=/"),
                ],
            ),
            (
                200,
                json!({"token":"synthetic-bearer","keyword":"Bearer"}),
                vec![],
            ),
            (200, json!({"id":"user-a","username":"alice"}), vec![]),
        ])
        .await;
        let mut flow = PasswordLogin::test_anonymous(url);
        assert!(
            flow.begin("alice", "synthetic-password")
                .await
                .unwrap()
                .is_none()
        );
        let error = flow.verify("000000").await.err().unwrap();
        assert_eq!(error.code, "jumpserver_otp_invalid");
        assert!(!error.message.contains("synthetic-private-detail"));
        let token = flow.verify("123456").await.unwrap();
        let api = flow.into_api(token);
        assert_eq!(
            api.get("/api/v1/users/profile/").await.unwrap()["username"],
            "alice"
        );
        let requests = server.await.unwrap();
        let body = |request: &String| -> Value {
            serde_json::from_str(request.split("\r\n\r\n").nth(1).unwrap()).unwrap()
        };
        assert_eq!(body(&requests[0])["password"], "synthetic-password");
        assert_eq!(body(&requests[1]), json!({"type":"otp","code":"000000"}));
        assert!(requests[1].contains("jms_sessionid=phase1"));
        assert!(requests[2].contains("jms_sessionid=phase2"));
        assert!(requests[3].contains("jms_sessionid=phase3"));
        assert!(
            requests[3]
                .to_ascii_lowercase()
                .contains("x-csrftoken: csrf2")
        );
        assert_eq!(body(&requests[3]), json!({}));
        assert!(
            requests[4]
                .to_ascii_lowercase()
                .contains("authorization: bearer synthetic-bearer")
        );
        assert!(!requests[4].to_ascii_lowercase().contains("cookie:"));
        for request in requests.iter().skip(1) {
            assert!(!request.contains("synthetic-password"));
        }
    }
    #[test]
    fn unsupported_challenges_and_error_bodies_never_become_credentials() {
        for value in [
            json!({"error":"mfa_required","data":{"choices":["face"],"url":OTP_PATH}}),
            json!({"error":"mfa_required","data":{"choices":["otp"],"url":"https://untrusted.invalid/collect"}}),
            json!({"error":"login_confirm_wait","token":"synthetic-token-must-not-be-used"}),
            json!({"token":"synthetic-token","keyword":"Token"}),
        ] {
            assert!(login_result(200, &value).is_err());
        }
        assert!(
            login_result(400, &json!({"password":"synthetic-private-detail"}))
                .err()
                .unwrap()
                .message
                .find("synthetic-private-detail")
                .is_none()
        );
        assert!(
            login_result(200, &json!({"token":"synthetic-token"}))
                .unwrap()
                .is_some()
        );
    }
    #[tokio::test]
    async fn password_redirect_is_rejected_without_following_location() {
        let (url, server) = fixture(vec![(
            302,
            json!({}),
            vec![("Location", "https://untrusted.invalid/")],
        )])
        .await;
        let mut flow = PasswordLogin::test_anonymous(url);
        assert_eq!(
            flow.begin("alice", "synthetic-password")
                .await
                .err()
                .unwrap()
                .code,
            "jumpserver_redirect"
        );
        assert_eq!(server.await.unwrap().len(), 1);
    }
    #[test]
    fn cookie_rotation_deletion_and_bounds_are_applied_without_raw_errors() {
        let mut flow =
            PasswordLogin::test_anonymous(reqwest::Url::parse("http://127.0.0.1/").unwrap());
        flow.capture_cookie("jms_sessionid=old; Path=/").unwrap();
        flow.capture_cookie("jms_sessionid=new; Domain=.untrusted.invalid; Path=/")
            .unwrap();
        assert_eq!(flow.cookies["jms_sessionid"].as_str(), "new");
        flow.capture_cookie("jms_sessionid=; Max-Age=0; Path=/")
            .unwrap();
        assert!(flow.cookies.is_empty());
        assert!(flow.capture_cookie("bad=has space").is_err());
        assert!(
            flow.capture_cookie(&format!("test={}", "x".repeat(4097)))
                .is_err()
        );
    }
}
