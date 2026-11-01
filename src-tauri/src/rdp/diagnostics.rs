#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WorkerStatus {
    Ready,
    Connected,
    Stage(&'static str),
    Error(u32),
}

/// Parse only locally defined status messages; never forward raw native logs.
pub fn parse_status(line: &str) -> Option<WorkerStatus> {
    match line.trim_end() {
        "DSSH_RDP_V1 ready" => Some(WorkerStatus::Ready),
        "DSSH_RDP_V1 connected" => Some(WorkerStatus::Connected),
        "DSSH_RDP_V1 stage context" => Some(WorkerStatus::Stage("引擎初始化")),
        "DSSH_RDP_V1 stage arguments" => Some(WorkerStatus::Stage("连接配置")),
        "DSSH_RDP_V1 stage display" => Some(WorkerStatus::Stage("显示初始化")),
        "DSSH_RDP_V1 stage connect" => Some(WorkerStatus::Stage("连接与认证")),
        "DSSH_RDP_V1 crypto-md4-unavailable" => Some(WorkerStatus::Error(0xd5500001)),
        "DSSH_RDP_V1 crypto-rc4-unavailable" => Some(WorkerStatus::Error(0xd5500002)),
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
}
impl Default for WorkerDiagnostics {
    fn default() -> Self {
        Self {
            connected: false,
            stage: "启动",
            error: None,
        }
    }
}
impl WorkerDiagnostics {
    pub fn observe(&mut self, status: WorkerStatus) {
        match status {
            WorkerStatus::Connected => self.connected = true,
            WorkerStatus::Stage(stage) => self.stage = stage,
            WorkerStatus::Error(code) => self.error = Some(code),
            WorkerStatus::Ready => {}
        }
    }

    pub fn failure_message(&self, exit: Option<i32>) -> String {
        let message = match self.error {
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
        let exit = exit
            .map(|code| format!("0x{:08X}", code as u32))
            .unwrap_or_else(|| "未知".into());
        let native = self
            .error
            .map(|code| format!("；RDP 代码 0x{code:08X}"))
            .unwrap_or_default();
        format!("{message}（阶段：{}；退出代码 {exit}{native}）", self.stage)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
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
}
