import { listen } from "@tauri-apps/api/event";
import type {
  AiEvent,
  AiProviderKind,
  AiSendMessageRequest,
  CopilotAuthEvent,
  CopilotDeviceInfo,
} from "../models/ai";
import { invokeCommand } from "./tauri";

export interface ListModelsRequest {
  baseUrl: string;
  apiKey: string;
  proxyUrl: string;
  kind?: AiProviderKind;
}

export function listAiModels(request: ListModelsRequest) {
  return invokeCommand<string[]>("ai_list_models", {
    request: { kind: "openai", ...request },
  });
}

export function startCopilotLogin(proxyUrl?: string) {
  return invokeCommand<CopilotDeviceInfo>("ai_copilot_start_login", { proxyUrl });
}

export function cancelCopilotLogin() {
  return invokeCommand<void>("ai_copilot_cancel_login");
}

export function getCopilotStatus() {
  return invokeCommand<boolean>("ai_copilot_status");
}

export function logoutCopilot() {
  return invokeCommand<void>("ai_copilot_logout");
}

export function onCopilotAuthEvent(handler: (event: CopilotAuthEvent) => void) {
  return listen<CopilotAuthEvent>("copilot-auth", (event) => handler(event.payload));
}

export function sendAiMessage(request: AiSendMessageRequest) {
  return invokeCommand<void>("ai_send_message", { request });
}

export function approveAiTool(runId: string, callId: string, approved: boolean) {
  return invokeCommand<void>("ai_approve_tool", {
    request: { runId, callId, approved },
  });
}

export function answerAiQuestion(runId: string, callId: string, optionIds: string[]) {
  return invokeCommand<void>("ai_answer_question", {
    request: { runId, callId, optionIds },
  });
}

export function cancelAiRun(runId: string) {
  return invokeCommand<void>("ai_cancel_run", { runId });
}

export function loadAiChatHistory() {
  return invokeCommand<unknown[]>("ai_load_chat_history");
}

export function saveAiChatHistory(items: unknown[]) {
  return invokeCommand<void>("ai_save_chat_history", { items });
}

export function clearAiChatHistory() {
  return invokeCommand<void>("ai_clear_chat_history");
}

export function onAiEvent(handler: (event: AiEvent) => void) {
  return listen<AiEvent>("ai-event", (event) => handler(event.payload));
}
