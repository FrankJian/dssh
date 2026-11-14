import { listen } from "@tauri-apps/api/event";
import type {
  AiEvent,
  AiQuestionAnswer,
  AiConversation,
  AiConnectionTestResult,
  AiProvider,
  AiSendMessageRequest,
} from "../models/ai";
import { invokeCommand } from "./tauri";
import type { TerminalSession } from "../models";

export function listAiBackgroundSessions(conversationId: string) {
  return invokeCommand<TerminalSession[]>("ai_background_sessions", { conversationId });
}

export function takeOverAiSession(conversationId: string, sessionId: string) {
  return invokeCommand<TerminalSession>("ai_take_over_session", { conversationId, sessionId });
}

export function closeAiBackgroundSession(conversationId: string, sessionId: string) {
  return invokeCommand<void>("ai_close_background_session", { conversationId, sessionId });
}

export function listAiModels(providerId: string) {
  return invokeCommand<string[]>("ai_list_models", { request: { providerId } });
}

export function loadAiProviders() {
  return invokeCommand<AiProvider[]>("ai_load_providers");
}

export function saveAiProvider(provider: AiProvider) {
  return invokeCommand<AiProvider>("ai_save_provider", { provider });
}

export async function testAiConnection(provider: AiProvider) {
  const result = await invokeCommand<AiConnectionTestResult>("ai_test_connection", { provider });
  if (!result?.details || typeof result.success !== "boolean") {
    throw new Error("连接诊断已更新，请重启应用加载新后端后再测试。");
  }
  return result;
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

export function answerAiQuestion(runId: string, callId: string, answer: AiQuestionAnswer) {
  return invokeCommand<void>("ai_answer_question", {
    request: { runId, callId, ...answer },
  });
}

export function cancelAiRun(runId: string) {
  return invokeCommand<void>("ai_cancel_run", { runId });
}

export function listAiConversations() {
  return invokeCommand<AiConversation[]>("ai_list_conversations");
}

export function createAiConversation() {
  return invokeCommand<AiConversation>("ai_create_conversation");
}

export function saveAiConversation(conversation: AiConversation) {
  return invokeCommand<void>("ai_save_conversation", { conversation });
}

export function generateAiConversationTitle(conversationId: string, providerId: string, model: string, message: string, answer: string) {
  return invokeCommand<string | null>("ai_generate_conversation_title", { conversationId, providerId, model, message, answer });
}

export function resetAiConversation(conversationId: string, remove: boolean) {
  return invokeCommand<void>("ai_reset_conversation", { conversationId, delete: remove });
}

export function onAiEvent(windowLabel: string, handler: (event: AiEvent) => void) {
  return listen<AiEvent>("ai-event", (event) => handler(event.payload), { target: windowLabel });
}
