/** Provider kind: a generic OpenAI-compatible endpoint, or GitHub Copilot. */
export type AiProviderKind = "openai" | "copilot";

export interface AiProvider {
  id: string;
  label: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Optional proxy URL (http/https/socks5) used to reach the API. */
  proxyUrl: string;
  /**
   * Models returned by the last successful "获取模型" call in settings. Used to
   * offer in-chat model switching. Empty when the list was never fetched (e.g.
   * the user typed a single model manually).
   */
  models: string[];
  /**
   * Provider kind. `"copilot"` providers authenticate via GitHub device flow
   * (handled by the backend) instead of a static API key.
   */
  kind: AiProviderKind;
}

/** Device-flow prompt returned by the backend when Copilot login begins. */
export interface CopilotDeviceInfo {
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

/** Copilot device-flow completion event (mirrors the Rust `CopilotAuthEvent`). */
export type CopilotAuthEvent =
  | { kind: "success" }
  | { kind: "error"; message: string };

export interface AiServerContext {
  id: string;
  label: string;
  /** Active interactive terminal session id, for reading on-screen output. */
  sessionId: string | null;
  /** Whether the active terminal is a remote SSH session or a local shell. */
  kind: "ssh" | "local";
}

export interface AiOptions {
  requireApproval: boolean;
  temperature: number | null;
  maxSteps: number;
  /**
   * 历史压缩触发阈值（historyMaxChars）：对话历史累计字符数超过该值后，
   * 更早的内容会被压缩成摘要以控制上下文长度。
   */
  historyMaxChars: number;
  /**
   * 保留原文的近期长度（historyRecentChars）：最近多少字符的对话保持原文不压缩。
   * 应小于 historyMaxChars。
   */
  historyRecentChars: number;
  /**
   * 摘要分块大小（historyChunkChars）：压缩更早对话时每块的字符数，块越小摘要越细、成本越高。
   */
  historyChunkChars: number;
}

/** A turn in the visible transcript, threaded across runs for context. */
export interface AiHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AiProviderPayload {
  baseUrl: string;
  apiKey: string;
  model: string;
  proxyUrl: string;
  kind: AiProviderKind;
}

export interface AiSendMessageRequest {
  runId: string;
  provider: AiProviderPayload;
  options: AiOptions;
  history: AiHistoryMessage[];
  message: string;
  currentServer: AiServerContext | null;
}

/** Streamed agent events (discriminated by `kind`). Mirrors the Rust `AiEvent`. */
export type AiEvent =
  | { kind: "assistant"; runId: string; text: string }
  | {
      kind: "toolCall";
      runId: string;
      callId: string;
      toolName: string;
      args: Record<string, unknown>;
      needsApproval: boolean;
    }
  | {
      kind: "toolResult";
      runId: string;
      callId: string;
      toolName: string;
      result: string;
      isError: boolean;
    }
  | {
      kind: "openSshSession";
      runId: string;
      callId: string;
      profileId: string;
    }
  | {
      kind: "appAction";
      runId: string;
      callId: string;
      action: string;
      args: Record<string, unknown>;
    }
  | { kind: "final"; runId: string; text: string | null }
  | { kind: "error"; runId: string; message: string }
  | { kind: "done"; runId: string };
