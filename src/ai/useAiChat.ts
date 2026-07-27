import { useCallback, useEffect, useRef, useState } from "react";
import type { AiHistoryMessage, AiOptions, AiProvider, AiServerContext } from "../models/ai";
import {
  answerAiQuestion,
  approveAiTool,
  cancelAiRun,
  clearAiChatHistory,
  loadAiChatHistory,
  onAiEvent,
  saveAiChatHistory,
  sendAiMessage,
} from "../services/aiService";

export type ToolStatus = "pendingApproval" | "running" | "done" | "rejected" | "error";

export type ChatItem =
  | { id: string; type: "user"; text: string }
  | { id: string; type: "assistant"; text: string; final: boolean }
  | {
      id: string;
      type: "tool";
      callId: string;
      toolName: string;
      args: Record<string, unknown>;
      status: ToolStatus;
      result: string | null;
    }
  | { id: string; type: "error"; text: string };

interface SendArgs {
  provider: AiProvider;
  options: AiOptions;
  message: string;
  currentServer?: AiServerContext | null;
}

export interface AiChat {
  items: ChatItem[];
  isHistoryReady: boolean;
  isRunning: boolean;
  send: (args: SendArgs) => Promise<void>;
  approve: (callId: string, approved: boolean) => void;
  answerQuestion: (callId: string, optionIds: string[]) => void;
  completeSshSessionOpen: (callId: string, result: string, isError: boolean) => void;
  cancel: () => void;
  clear: () => void;
}

export function useAiChat(): AiChat {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [isHistoryReady, setIsHistoryReady] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const runIdRef = useRef<string | null>(null);
  const seqRef = useRef(0);
  const pendingSshSessionCallsRef = useRef(new Set<string>());
  const sshSessionOutcomesRef = useRef(new Map<string, { result: string; isError: boolean }>());

  const nextId = useCallback((prefix: string) => {
    seqRef.current += 1;
    return `${prefix}-${Date.now()}-${seqRef.current}`;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadAiChatHistory()
      .then((storedItems) => {
        if (!cancelled) {
          setItems(storedItems.flatMap(normalizeChatItem));
        }
      })
      .catch((error) => {
        console.error("Failed to load AI chat history.", error);
      })
      .finally(() => {
        if (!cancelled) {
          setIsHistoryReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isHistoryReady) {
      return;
    }
    const timer = window.setTimeout(() => {
      void saveAiChatHistory(items).catch((error) => {
        console.error("Failed to save AI chat history.", error);
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [isHistoryReady, items]);

  useEffect(() => {
    const unlistenPromise = onAiEvent((event) => {
      if (runIdRef.current === null || event.runId !== runIdRef.current) {
        return;
      }
      switch (event.kind) {
        case "assistant":
          setItems((prev) => [
            ...prev,
            { id: nextId("assistant"), type: "assistant", text: event.text, final: false },
          ]);
          break;
        case "toolCall":
          setItems((prev) => [
            ...prev,
            {
              id: nextId("tool"),
              type: "tool",
              callId: event.callId,
              toolName: event.toolName,
              args: event.args,
              status: event.needsApproval ? "pendingApproval" : "running",
              result: null,
            },
          ]);
          break;
        case "toolResult":
          if (
            event.toolName === "open_ssh_session" &&
            pendingSshSessionCallsRef.current.has(event.callId)
          ) {
            const outcome = sshSessionOutcomesRef.current.get(event.callId);
            if (outcome) {
              pendingSshSessionCallsRef.current.delete(event.callId);
              sshSessionOutcomesRef.current.delete(event.callId);
              setItems((prev) =>
                prev.map((item) =>
                  item.type === "tool" && item.callId === event.callId
                    ? { ...item, status: outcome.isError ? "error" : "done", result: outcome.result }
                    : item,
                ),
              );
            }
            break;
          }
          setItems((prev) =>
            prev.map((item) =>
              item.type === "tool" && item.callId === event.callId
                ? {
                    ...item,
                    status: event.isError ? "error" : "done",
                    result: event.result,
                  }
                : item,
            ),
          );
          break;
        case "openSshSession":
          pendingSshSessionCallsRef.current.add(event.callId);
          setItems((prev) =>
            prev.map((item) =>
              item.type === "tool" && item.callId === event.callId
                ? { ...item, status: "running", result: "正在打开 SSH 终端…" }
                : item,
            ),
          );
          break;
        case "final":
          if (event.text && event.text.trim()) {
            setItems((prev) => [
              ...prev,
              { id: nextId("assistant"), type: "assistant", text: event.text ?? "", final: true },
            ]);
          }
          break;
        case "error":
          setItems((prev) => [...prev, { id: nextId("error"), type: "error", text: event.message }]);
          break;
        case "done":
          runIdRef.current = null;
          setIsRunning(false);
          break;
        default:
          break;
      }
    });

    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [nextId]);

  const send = useCallback(
    async ({ provider, options, message, currentServer }: SendArgs) => {
      const trimmed = message.trim();
      if (!trimmed || isRunning || !isHistoryReady) {
        return;
      }

      const history: AiHistoryMessage[] = items
        .filter(
          (item): item is Extract<ChatItem, { type: "user" | "assistant" }> =>
            item.type === "user" || (item.type === "assistant" && item.final),
        )
        .map((item) => ({
          role: item.type === "user" ? "user" : "assistant",
          content: item.text,
        }));

      const runId = `run-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      runIdRef.current = runId;
      setIsRunning(true);
      setItems((prev) => [...prev, { id: nextId("user"), type: "user", text: trimmed }]);

      try {
        await sendAiMessage({
          runId,
          provider: {
            baseUrl: provider.baseUrl,
            apiKey: provider.apiKey,
            model: provider.model,
            proxyUrl: provider.proxyUrl,
            kind: provider.kind,
          },
          options,
          history,
          message: trimmed,
          currentServer: currentServer ?? null,
        });
      } catch (error) {
        runIdRef.current = null;
        setIsRunning(false);
        setItems((prev) => [
          ...prev,
          {
            id: nextId("error"),
            type: "error",
            text: error instanceof Error ? error.message : "发送消息失败。",
          },
        ]);
      }
    },
    [isHistoryReady, isRunning, items, nextId],
  );

  const approve = useCallback((callId: string, approved: boolean) => {
    const runId = runIdRef.current;
    if (!runId) {
      return;
    }
    setItems((prev) =>
      prev.map((item) =>
        item.type === "tool" && item.callId === callId && item.status === "pendingApproval"
          ? { ...item, status: approved ? "running" : "rejected" }
          : item,
      ),
    );
    void approveAiTool(runId, callId, approved);
  }, []);

  const answerQuestion = useCallback((callId: string, optionIds: string[]) => {
    const runId = runIdRef.current;
    if (!runId || optionIds.length === 0) {
      return;
    }
    setItems((prev) =>
      prev.map((item) =>
        item.type === "tool" && item.callId === callId && item.toolName === "ask_user_question"
          ? { ...item, result: "已提交选择，正在继续…" }
          : item,
      ),
    );
    void answerAiQuestion(runId, callId, optionIds).catch((error) => {
      setItems((prev) =>
        prev.map((item) =>
          item.type === "tool" && item.callId === callId
            ? {
                ...item,
                status: "error",
                result: error instanceof Error ? error.message : "提交选择失败。",
              }
            : item,
        ),
      );
    });
  }, []);

  const completeSshSessionOpen = useCallback(
    (callId: string, result: string, isError: boolean) => {
      sshSessionOutcomesRef.current.set(callId, { result, isError });
      setItems((prev) =>
        prev.map((item) =>
          item.type === "tool" && item.callId === callId
            ? { ...item, status: isError ? "error" : "done", result }
            : item,
        ),
      );
    },
    [],
  );

  const cancel = useCallback(() => {
    const runId = runIdRef.current;
    if (!runId) {
      return;
    }
    void cancelAiRun(runId);
    runIdRef.current = null;
    setIsRunning(false);
  }, []);

  const clear = useCallback(() => {
    if (isRunning) {
      return;
    }
    setItems([]);
    void clearAiChatHistory().catch((error) => {
      console.error("Failed to clear AI chat history.", error);
    });
  }, [isRunning]);

  return {
    items,
    isHistoryReady,
    isRunning,
    send,
    approve,
    answerQuestion,
    completeSshSessionOpen,
    cancel,
    clear,
  };
}

function normalizeChatItem(value: unknown): ChatItem[] {
  if (!isRecord(value) || typeof value.id !== "string") {
    return [];
  }
  if (value.type === "user" || value.type === "error") {
    return typeof value.text === "string" ? [{ id: value.id, type: value.type, text: value.text }] : [];
  }
  if (value.type === "assistant") {
    return typeof value.text === "string" && typeof value.final === "boolean"
      ? [{ id: value.id, type: "assistant", text: value.text, final: value.final }]
      : [];
  }
  if (
    value.type === "tool" &&
    typeof value.callId === "string" &&
    typeof value.toolName === "string" &&
    isRecord(value.args) &&
    typeof value.status === "string" &&
    (typeof value.result === "string" || value.result === null)
  ) {
    const interrupted = value.status === "pendingApproval" || value.status === "running";
    return [{
      id: value.id,
      type: "tool",
      callId: value.callId,
      toolName: value.toolName,
      args: value.args,
      status: interrupted ? "error" : normalizeToolStatus(value.status),
      result: interrupted ? "应用关闭前未完成，此操作未执行。" : value.result,
    }];
  }
  return [];
}

function normalizeToolStatus(value: string): ToolStatus {
  return ["done", "rejected", "error"].includes(value) ? value as ToolStatus : "error";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
