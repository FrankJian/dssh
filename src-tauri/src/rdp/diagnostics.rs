#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WorkerStatus {
    Ready,
    Connected,
    Activity,
    UserClose,
    Visibility { hidden: bool },
    Stage(&'static str),
    Error(u32),
    Fault { site: u32, line: u32 },
}

/// Parse only locally defined status messages; never forward raw native logs.
pub fn parse_status(line: &str) -> Option<WorkerStatus> {
    match line.trim_end() {
        "DSSH_RDP_V1 ready" => Some(WorkerStatus::Ready),
        "DSSH_RDP_V1 activity" => Some(WorkerStatus::Activity),
        "DSSH_RDP_V1 connected" => Some(WorkerStatus::Connected),
        "DSSH_RDP_V1 user-close" => Some(WorkerStatus::UserClose),
        "DSSH_RDP_V1 hidden" => Some(WorkerStatus::Visibility { hidden: true }),
        "DSSH_RDP_V1 visible" => Some(WorkerStatus::Visibility { hidden: false }),
        "DSSH_RDP_V1 stage context" => Some(WorkerStatus::Stage("引擎初始化")),
        "DSSH_RDP_V1 stage platform" => Some(WorkerStatus::Stage("系统运行库初始化")),
        "DSSH_RDP_V1 stage sdl-context" => Some(WorkerStatus::Stage("桌面上下文初始化")),
        "DSSH_RDP_V1 stage arguments" => Some(WorkerStatus::Stage("连接配置")),
        "DSSH_RDP_V1 stage display" => Some(WorkerStatus::Stage("显示初始化")),
        "DSSH_RDP_V1 stage connect" => Some(WorkerStatus::Stage("连接与认证")),
        "DSSH_RDP_V1 crypto-md4-unavailable" => Some(WorkerStatus::Error(0xd5500001)),
        "DSSH_RDP_V1 crypto-rc4-unavailable" => Some(WorkerStatus::Error(0xd5500002)),
        text if text.starts_with("DSSH_RDP_V1 fault ") => {
            let mut fields = text.strip_prefix("DSSH_RDP_V1 fault ")?.split(' ');
            let site = fields.next()?.parse().ok()?;
            let line = fields.next()?.parse().ok()?;
            if fields.next().is_some() {
                return None;
            }
            Some(WorkerStatus::Fault { site, line })
        }
        text => text
            .strip_prefix("DSSH_RDP_V1 error ")?
            .parse()
            .ok()
            .map(WorkerStatus::Error),
    }
}

pub struct WorkerDiagnostics {
    pub connected: bool,
    stage: &'static str,
    error: Option<u32>,
    fault: Option<(u32, u32)>,
    user_closed: bool,
}
impl Default for WorkerDiagnostics {
    fn default() -> Self {
        Self {
            connected: false,
            stage: "启动",
            error: None,
            fault: None,
            user_closed: false,
        }
    }
}
impl WorkerDiagnostics {
    pub fn observe(&mut self, status: WorkerStatus) {
        match status {
            WorkerStatus::Activity => {}
            WorkerStatus::Connected => self.connected = true,
            WorkerStatus::UserClose => self.user_closed = true,
            WorkerStatus::Stage(stage) => self.stage = stage,
            WorkerStatus::Error(code) => self.error = Some(code),
            WorkerStatus::Fault { site, line } => self.fault = Some((site, line)),
            WorkerStatus::Ready | WorkerStatus::Visibility { .. } => {}
        }
    }

    pub fn is_normal_exit(&self, exit: Option<i32>) -> bool {
        if self.fault.is_some() {
            return false;
        }
        let Some(code) = exit else {
            return false;
        };
        if self.user_closed && self.is_clean_requested_exit(exit) {
            return true;
        }
        let benign = matches!(
            self.error,
            None | Some(0 | 0x10002 | 0x1000b | 0x1000c | 0x2000b)
        );
        benign && (code == 145 || (self.connected && matches!(code, 0 | 2 | 11)))
    }

    pub fn is_clean_requested_exit(&self, exit: Option<i32>) -> bool {
        // SDL3 can return CONN_FAILED (131) when a local abort wakes the
        // event-handle loop before it observes the disconnect flag. Callers
        // must establish explicit close intent before using this predicate.
        self.fault.is_none() && matches!(exit, Some(0..=2 | 11 | 131 | 145))
    }

    pub fn failure_message(&self, exit: Option<i32>) -> String {
        let message = match self.error {
            Some(0x10001) => "RDP 服务端结束了会话，请检查服务端会话策略。",
            Some(0x10003) => "RDP 会话因空闲超时被服务端断开。",
            Some(0x10004) => "RDP 登录会话超时，服务端已断开连接。",
            Some(0x10005) => "RDP 会话被另一个连接替代。",
            Some(0xd5500011) => "RDP 引擎内存分配失败，请检查系统可用内存。",
            Some(0xd5500012) => "RDP 引擎访问本机文件路径失败，请保留阶段与错误码以便排查。",
            Some(0xd5500013) => "RDP 引擎系统调用失败，请保留阶段与错误码以便排查。",
            Some(0xd5500010 | 0xd5500014) => {
                "RDP 引擎出现本机运行库异常，请保留阶段与错误码以便排查。"
            }
            Some(0xd5500001 | 0xd5500002) => {
                "RDP 引擎缺少 NLA 所需的加密算法。请更新包含完整内置算法的安装包。"
            }
            Some(0x00020009 | 0x00020014 | 0x00020015) => {
                "Windows 身份验证失败或账号策略拒绝登录。请检查用户名、域和密码；不会自动重试。"
            }
            Some(0x00020008) => "TLS 或证书校验失败，请核对服务器证书及当前证书验证设置。",
            Some(0x00020004..=0x00020006) => {
                "无法连接到 Windows RDP 服务，请检查主机、端口和网络。"
            }
            _ => match exit.map(|code| code as u32) {
                Some(3) => {
                    "RDP 引擎在本机异常终止，可能是原生断言或运行库异常；此退出码不能判定为密码错误。"
                }
                Some(180..=182) => {
                    "RDP 引擎缺少 NLA 所需的加密算法。请更新包含完整内置算法的安装包。"
                }
                Some(0xc0000135 | 0xc000007b) => {
                    "RDP 客户端运行库缺失或架构不匹配，请重新安装完整安装包。"
                }
                Some(0xc0000005 | 0xc0000409) => "RDP 原生客户端发生异常，请保留此错误码以便排查。",
                Some(128) => "RDP 引擎不支持当前连接参数，请更新安装包。",
                Some(132 | 134 | 154 | 155) => {
                    "Windows 身份验证或登录授权失败，请检查用户名、域、密码和远程登录权限。"
                }
                Some(135) => "Windows 账号已锁定，已停止连接尝试。",
                Some(139..=141) => "无法解析或连接目标主机，请检查主机、端口和网络。",
                Some(143) => "TLS 或证书校验失败，请核对服务器证书及当前证书验证设置。",
                Some(148 | 149 | 152) => "Windows 密码已过期或需要更改，请先通过系统登录更新密码。",
                Some(151) => "Windows 账号已禁用，请联系管理员。",
                _ if self.stage == "显示初始化" => {
                    "RDP 显示初始化失败，请检查图形驱动及安装包运行库。"
                }
                _ => "RDP 客户端已退出，请根据阶段和错误码检查安装包、连接配置与目标系统。",
            },
        };
        let permission_hint = if matches!(self.error, Some(0x00020004..=0x00020006))
            || (self.error.is_none() && matches!(exit, Some(139..=141)))
        {
            crate::error::local_network_permission_hint()
        } else {
            ""
        };
        let exit = exit
            .map(|code| format!("0x{:08X}", code as u32))
            .unwrap_or_else(|| "未知".into());
        let native = self
            .error
            .map(|code| format!("；RDP 代码 0x{code:08X}"))
            .unwrap_or_default();
        let fault = self
            .fault
            .map(|(site, line)| format!("；断言位置 {site:08X}:{line}"))
            .unwrap_or_default();
        format!(
            "{message}{permission_hint}（阶段：{}；退出代码 {exit}{native}{fault}）",
            self.stage
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn network_failures_suggest_macos_permission_without_mislabeling_auth_errors() {
        let mut diagnostics = WorkerDiagnostics::default();
        diagnostics.observe(WorkerStatus::Stage("连接与认证"));
        diagnostics.observe(WorkerStatus::Error(0x20006));
        let message = diagnostics.failure_message(Some(0x8d));
        assert!(message.contains("0x0000008D"));
        assert!(message.contains("0x00020006"));
        assert_eq!(message.contains("本地网络"), cfg!(target_os = "macos"));
        diagnostics.observe(WorkerStatus::Error(0x20009));
        assert!(!diagnostics.failure_message(Some(132)).contains("本地网络"));
        assert!(!diagnostics.is_normal_exit(Some(0x8d)));
    }

    #[test]
    fn activity_is_fixed_metadata_and_does_not_imply_a_connection_or_clean_exit() {
        let mut diagnostics = WorkerDiagnostics::default();
        let status = parse_status("DSSH_RDP_V1 activity").unwrap();
        assert_eq!(status, WorkerStatus::Activity);
        diagnostics.observe(status);
        assert!(!diagnostics.connected);
        assert!(!diagnostics.is_normal_exit(Some(131)));
        assert!(parse_status("DSSH_RDP_V1 activity key=C").is_none());
    }

    #[test]
    fn visibility_acknowledgements_do_not_end_a_connection() {
        let mut diagnostics = WorkerDiagnostics::default();
        for hidden in [true, false, true] {
            let line = if hidden {
                "DSSH_RDP_V1 hidden"
            } else {
                "DSSH_RDP_V1 visible"
            };
            let status = parse_status(line).unwrap();
            assert_eq!(status, WorkerStatus::Visibility { hidden });
            diagnostics.observe(status);
            assert!(!diagnostics.connected);
            assert!(!diagnostics.is_normal_exit(Some(0)));
        }
        diagnostics.observe(WorkerStatus::Connected);
        diagnostics.observe(WorkerStatus::Visibility { hidden: true });
        assert!(diagnostics.connected);
        assert!(!diagnostics.is_normal_exit(Some(0xc0000005u32 as i32)));
    }
    #[test]
    fn sdl_abort_exit_131_requires_explicit_close_intent() {
        // Cover title-bar / toolbar status arriving both before process exit
        // and in the final stdout drain, with or without a connected event.
        for connected in [false, true] {
            let mut diagnostics = WorkerDiagnostics::default();
            if connected {
                diagnostics.observe(WorkerStatus::Connected);
            }
            assert!(!diagnostics.is_normal_exit(Some(0x83)));
            // The workbench's explicit Close control uses this predicate.
            assert!(diagnostics.is_clean_requested_exit(Some(0x83)));
            diagnostics.observe(parse_status("DSSH_RDP_V1 user-close").unwrap());
            assert!(diagnostics.is_normal_exit(Some(0x83)));
            // Teardown may also emit a generic transport error after abort.
            diagnostics.observe(WorkerStatus::Error(0x20006));
            assert!(diagnostics.is_normal_exit(Some(0x83)));
            assert!(!diagnostics.is_normal_exit(Some(3)));
            assert!(!diagnostics.is_normal_exit(Some(0xc0000005u32 as i32)));
            diagnostics.observe(WorkerStatus::Fault { site: 1, line: 2 });
            assert!(!diagnostics.is_normal_exit(Some(0x83)));
            assert!(!diagnostics.is_clean_requested_exit(Some(0x83)));
        }
    }

    #[test]
    fn user_closes_disappear_but_failures_remain() {
        let mut diagnostics = WorkerDiagnostics::default();
        diagnostics.observe(WorkerStatus::Connected);
        assert!(diagnostics.is_normal_exit(Some(0)));
        diagnostics.observe(WorkerStatus::Error(0x20006));
        assert!(!diagnostics.is_normal_exit(Some(0)));
        assert!(!diagnostics.is_normal_exit(Some(131)));
        diagnostics.observe(parse_status("DSSH_RDP_V1 user-close").unwrap());
        assert!(diagnostics.is_normal_exit(Some(145)));
        assert!(!diagnostics.is_normal_exit(Some(3)));
        assert!(!diagnostics.is_clean_requested_exit(Some(3)));
        assert!(!diagnostics.is_clean_requested_exit(Some(0xc0000005u32 as i32)));
        assert!(diagnostics.is_clean_requested_exit(Some(145)));
        assert!(!diagnostics.is_normal_exit(None));
        diagnostics.observe(WorkerStatus::Fault { site: 1, line: 2 });
        assert!(!diagnostics.is_normal_exit(Some(0)));
        assert!(!diagnostics.is_clean_requested_exit(Some(0)));
    }
    #[test]
    fn only_known_diagnostics_cross_the_process_boundary() {
        assert_eq!(
            parse_status("DSSH_RDP_V1 crypto-md4-unavailable"),
            Some(WorkerStatus::Error(0xd5500001))
        );
        assert_eq!(
            parse_status("DSSH_RDP_V1 error 131081"),
            Some(WorkerStatus::Error(0x20009))
        );
        assert!(parse_status("DSSH_RDP_V1 stage arbitrary remote text").is_none());
        assert!(parse_status("DSSH_RDP_V1 error password=test-only").is_none());
    }
    #[test]
    fn late_error_is_retained_after_connected_status() {
        let mut diagnostics = WorkerDiagnostics::default();
        diagnostics.observe(WorkerStatus::Connected);
        diagnostics.observe(WorkerStatus::Error(0xd5500001));
        let message = diagnostics.failure_message(Some(181));
        assert!(message.contains("加密算法"));
        assert!(message.contains("0xD5500001"));
        assert!(!message.contains("用户名"));
    }
    #[test]
    fn startup_and_graphics_errors_are_not_reported_as_wrong_passwords() {
        let mut diagnostics = WorkerDiagnostics::default();
        assert!(
            diagnostics
                .failure_message(Some(0xc0000135u32 as i32))
                .contains("运行库缺失")
        );
        diagnostics.observe(WorkerStatus::Stage("显示初始化"));
        assert!(
            diagnostics
                .failure_message(Some(-1))
                .contains("显示初始化失败")
        );
        assert!(diagnostics.failure_message(Some(-1)).contains("0xFFFFFFFF"));
    }
    #[test]
    fn fatal_diagnostics_are_bounded_numeric_data() {
        let mut diagnostics = WorkerDiagnostics::default();
        diagnostics.observe(parse_status("DSSH_RDP_V1 stage sdl-context").unwrap());
        diagnostics.observe(parse_status("DSSH_RDP_V1 fault 1234 87").unwrap());
        let message = diagnostics.failure_message(Some(3));
        assert!(message.contains("本机异常终止"));
        assert!(message.contains("桌面上下文初始化"));
        assert!(message.contains("000004D2:87"));
        assert!(parse_status("DSSH_RDP_V1 fault secret 87").is_none());
        assert!(parse_status("DSSH_RDP_V1 fault 1234 87 remote-text").is_none());
        assert!(parse_status("DSSH_RDP_V1 fault 4294967296 87").is_none());
        diagnostics.observe(WorkerStatus::Error(0xd5500012));
        assert!(
            diagnostics
                .failure_message(Some(190))
                .contains("本机文件路径")
        );
    }
}
