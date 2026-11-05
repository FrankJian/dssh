import type { AiConnectionTestResult } from "../models/ai";
import { API_PROTOCOLS } from "./aiConfig";

const STAGES: Record<string, string> = {
  validate_config: "校验配置", build_request: "构造请求", send_request: "建立连接 / 发送请求",
  read_response: "读取响应", http_error: "服务返回 HTTP 错误", parse_response: "解析响应", complete: "测试完成",
};

export function AiConnectionDetails({ result }: { result: AiConnectionTestResult }) {
  const details = result.details;
  return <details className="ai-connection-details">
    <summary>查看连接诊断</summary>
    <dl>
      <dt>API 地址</dt><dd><code>{details.apiUrl ?? "未生成（配置校验失败）"}</code></dd>
      <dt>协议 / 方法</dt><dd>{API_PROTOCOLS.find((protocol) => protocol.value === details.protocol)?.label} · {details.method}</dd>
      <dt>模型</dt><dd>{result.model || "未填写"}</dd>
      <dt>阶段 / 耗时</dt><dd>{STAGES[details.stage] ?? details.stage} · {(result.elapsedMs / 1000).toFixed(2)} 秒</dd>
      <dt>HTTP 状态</dt><dd>{details.httpStatus ?? "未收到 HTTP 响应"}</dd>
      <dt>代理</dt><dd>{details.proxy}</dd>
      <dt>API Key</dt><dd>{details.authenticationConfigured ? "已配置（值已隐藏）" : "未配置"}</dd>
      {details.errorType ? <><dt>错误类型</dt><dd>{details.errorType}</dd></> : null}
    </dl>
    {details.cause ? <><h4>连接错误链</h4><pre>{details.cause}</pre></> : null}
    <h4>请求头（密钥已脱敏）</h4><pre>{JSON.stringify(details.requestHeaders, null, 2)}</pre>
    <h4>请求体</h4><pre>{details.requestBody ? JSON.stringify(details.requestBody, null, 2) : "请求尚未构造完成"}</pre>
    {Object.keys(details.responseHeaders).length ? <><h4>响应头 / 请求 ID</h4><pre>{JSON.stringify(details.responseHeaders, null, 2)}</pre></> : null}
    {details.responseError ? <><h4>服务返回的错误（已脱敏）</h4><pre>{JSON.stringify(details.responseError, null, 2)}</pre></> : null}
  </details>;
}
