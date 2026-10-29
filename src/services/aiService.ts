import { listen } from "@tauri-apps/api/event";
import type {
  AiEvent,
  AiProvider,
  AiSendMessageRequest,
} from "../models/ai";
import { invokeCommand } from "./tauri";

export function listAiModels(providerId: string) {
  return invokeCommand<string[]>("ai_list_models", { request: { providerId } });
}

export function loadAiProviders() {
  return invokeCommand<AiProvider[]>("ai_load_providers");
}

export function saveAiProvider(provider: AiProvider) {
  return invokeCommand<AiProvider>("ai_save_provider", { provider });
}

export function testAiConnection(provider: AiProvider) {
  return invokeCommand<{ model: string; elapsedMs: number }>("ai_test_connection", { provider });
}

export function deleteAiProvider(id: string) {
  return invokeCommand<void>("ai_delete_provider", { id });
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
