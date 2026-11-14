/** Explicit API wire protocol, independent of the model name. */
export type AiProviderKind = "openai-completions" | "openai-responses" | "anthropic-messages";

export interface AiReasoningLevel {
  level: string;
  apiValue: string;
}

export interface AiModelConfig {
  id: string;
  displayName: string;
  /** Context capacity in tokens, used to bound the history budget. */
  contextWindow: number;
  maxOutputTokens: number;
  inputTypes: ("text" | "image")[];
  reasoningEffort: string | null;
  reasoningLevels: AiReasoningLevel[];
}

export interface AiRequestHeader {
  id: string;
  name: string;
  /** Write-only; omitted to keep the saved value. */
  value?: string;
  hasValue: boolean;
}

export interface AiProvider {
  presetId?: string | null;
  id: string;
  label: string;
  baseUrl: string;
  /** Write-only. Never returned by Rust or persisted in localStorage. */
  apiKey?: string;
  hasApiKey: boolean;
  extraHeaders: AiRequestHeader[];
  model: string;
  proxyUrl: string;
  /** User-managed model catalog, including manually entered IDs. */
  models: AiModelConfig[];
  kind: AiProviderKind;
}

export interface AiConnectionTestResult {
  success: boolean;
  message: string;
  model: string;
  elapsedMs: number;
  details: {
    protocol: AiProviderKind;
    stage: string;
    method: string;
    apiUrl: string | null;
    proxy: string;
    authenticationConfigured: boolean;
    requestHeaders: Record<string, string>;
    requestBody: Record<string, unknown> | null;
    httpStatus: number | null;
    responseHeaders: Record<string, string>;
    responseError: Record<string, unknown> | null;
    errorType: string | null;
    cause: string | null;
  };
}

export interface AiModelSelection {
  providerId: string;
  model: string;
  reasoningLevel: string | null;
}

export interface AiConversation {
  id: string;
  title: string | null;
  items: unknown[];
  draft: string;
  selection: AiModelSelection | null;
}

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

}

/** A turn in the visible transcript, threaded across runs for context. */
export interface AiHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export type AiQuestionAnswer =
  | { optionIds: string[]; customText?: never }
  | { customText: string; optionIds?: never };

export const MAX_AI_QUESTION_ANSWER_LENGTH = 2000;

export interface AiSendMessageRequest {
  runId: string;
  conversationId: string;
  providerId: string;
  model: string;
  reasoningLevel?: string | null;
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
      kind: "appAction";
      runId: string;
      callId: string;
      action: string;
      args: Record<string, unknown>;
    }
  | { kind: "final"; runId: string; text: string | null }
  | { kind: "error"; runId: string; message: string; details?: Record<string, unknown> }
  | { kind: "done"; runId: string };
