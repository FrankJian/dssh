import { useCallback, useEffect, useRef, useState } from "react";
import type { AiEvent, AiConversation, AiModelSelection, AiOptions, AiProvider, AiQuestionAnswer, AiServerContext } from "../models/ai";
import {
  answerAiQuestion, approveAiTool, cancelAiRun, createAiConversation, generateAiConversationTitle, listAiConversations,
  onAiEvent, resetAiConversation, saveAiConversation, sendAiMessage,
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
  | { id: string; type: "error"; text: string; details?: Record<string, unknown> };

type Conversation = Omit<AiConversation, "items"> & { items: ChatItem[] };
type Run = {
  id: string;
  conversationId: string;
  currentServer: AiServerContext | null;
  toolItems: Map<string, string>;
  appActions: Set<string>;
  stopping: boolean;
};
type AppAction = { conversationId: string; itemId: string };
type AppActionHandler = (event: Extract<AiEvent, { kind: "appAction" }>, run: Run) => void;

interface SendArgs {
  provider: AiProvider;
  reasoningLevel: string | null;
  options: AiOptions;
  message: string;
  currentServer: AiServerContext | null;
}

function formatError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function normalizeConversation(conversation: AiConversation): Conversation {
  return { ...conversation, items: conversation.items.flatMap(normalizeChatItem) };
}

function updateTool(items: ChatItem[], itemId: string | undefined, patch: Partial<Extract<ChatItem, { type: "tool" }>>): ChatItem[] {
  return items.map((item) => item.type === "tool" && item.id === itemId ? { ...item, ...patch } : item);
}

const ACTIVE_CONVERSATION_KEY = "dssh.ai.activeConversation";

export function useAiChat(windowLabel: string) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const conversationsRef = useRef<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isHistoryReady, setHistoryReady] = useState(false);
  const [eventsReady, setEventsReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<string[]>([]);
  const [running, setRunning] = useState<string[]>([]);
  const [stopping, setStopping] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [conversationErrors, setConversationErrors] = useState<Record<string, string | null>>({});
  const [loadRevision, reload] = useState(0);
  const loadingRef = useRef<Promise<AiConversation[]> | null>(null);
  const creation = useRef<Promise<void> | null>(null);
  const closingRef = useRef(false);
  const resets = useRef(new Map<string, Promise<void>>());
  const runs = useRef(new Map<string, Run>());
  const appActionHandler = useRef<AppActionHandler | null>(null);
  const appActions = useRef(new Map<string, AppAction>());
  const saves = useRef(new Map<string, Promise<void>>());
  const timers = useRef(new Map<string, number>());
  const titleAttempts = useRef(new Map<string, string>());

  const replace = useCallback((next: Conversation[]) => {
    conversationsRef.current = next;
    setConversations(next);
  }, []);

  useEffect(() => {
    if (windowLabel !== "main" || !isHistoryReady) return;
    if (activeId) localStorage.setItem(ACTIVE_CONVERSATION_KEY, activeId);
    else localStorage.removeItem(ACTIVE_CONVERSATION_KEY);
  }, [activeId, isHistoryReady, windowLabel]);

  const setAppActionHandler = useCallback((handler: AppActionHandler | null) => {
    appActionHandler.current = handler;
  }, []);

  const setConversationError = useCallback((id: string, message: string | null) => {
    setConversationErrors((errors) => ({ ...errors, [id]: message }));
  }, []);

  const persist = useCallback((conversation: Conversation) => {
    const id = conversation.id;
    window.clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    const next = (saves.current.get(id) ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => saveAiConversation(conversation));
    saves.current.set(id, next);
    const finish = () => {
      if (saves.current.get(id) === next) saves.current.delete(id);
    };
    void next.then(finish, finish);
    return next;
  }, []);

  const update = useCallback((id: string, change: (current: Conversation) => Conversation) => {
    const current = conversationsRef.current.find((conversation) => conversation.id === id);
    if (!current) return;
    const next = change(current);
    replace(conversationsRef.current.map((conversation) => conversation.id === id ? next : conversation));
    window.clearTimeout(timers.current.get(id));
    timers.current.set(id, window.setTimeout(() => {
      void persist(next).then(
        () => setConversationError(id, null),
        (cause) => setConversationError(id, formatError(cause, "无法保存会话记录。")),
      );
    }, 200));
  }, [persist, replace, setConversationError]);

  useEffect(() => {
    let disposed = false;
    setLoading(true);
    setError(null);
    // StrictMode replays effects, so share this window's initial creation.
    loadingRef.current ??= listAiConversations().then(async (items) => items.length ? items : [await createAiConversation()]);
    void loadingRef.current.then((stored) => {
      if (disposed) return;
      const next = stored.map(normalizeConversation);
      replace(next);
      const previous = windowLabel === "main" ? localStorage.getItem(ACTIVE_CONVERSATION_KEY) : null;
      setActiveId(next.find((item) => item.id === previous)?.id ?? next[0]?.id ?? null);
      setHistoryReady(true);
    }).catch((cause) => {
      if (disposed) return;
      loadingRef.current = null;
      setError(formatError(cause, "无法加载 AI 会话。"));
    }).finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [loadRevision, replace, windowLabel]);

  const updateItems = useCallback((id: string, change: (items: ChatItem[]) => ChatItem[]) => {
    update(id, (current) => ({ ...current, items: change(current.items) }));
  }, [update]);

  const ensureTitle = useCallback((id: string) => {
    const current = conversationsRef.current.find((item) => item.id === id);
    const selection = current?.selection;
    if (!current || current.title || !selection || closingRef.current || resets.current.has(id)) return;

    // Match the latest completed answer with its prompt, skipping failed turns.
    let answer: Extract<ChatItem, { type: "assistant" }> | undefined;
    let message: string | undefined;
    for (let index = current.items.length - 1; index >= 0; index--) {
      const item = current.items[index];
      if (!answer && item.type === "assistant" && item.final) answer = item;
      else if (answer && item.type === "user") {
        message = item.text;
        break;
      }
    }
    if (!answer || !message || titleAttempts.current.get(id) === answer.id) return;
    const answerId = answer.id;
    titleAttempts.current.set(id, answerId);

    void generateAiConversationTitle(id, selection.providerId, selection.model, message, answer.text)
      .then((title) => {
        if (!title || closingRef.current || resets.current.has(id) || titleAttempts.current.get(id) !== answerId) return;
        const latest = conversationsRef.current.find((item) => item.id === id);
        if (!latest || latest.title || !latest.items.some((item) => item.id === answerId)) return;
        update(id, (conversation) => ({ ...conversation, title }));
      })
      .catch(() => { /* Keep the default title and retry after a later completed turn. */ });
  }, [update]);

  useEffect(() => {
    let disposed = false;
    const listening = onAiEvent(windowLabel, (event) => {
      const run = runs.current.get(event.runId);
      if (disposed || !run) return;
      const id = run.conversationId;
      switch (event.kind) {
        case "assistant":
          updateItems(id, (items) => [...items, { id: crypto.randomUUID(), type: "assistant", text: event.text, final: false }]);
          break;
        case "toolCall": {
          const itemId = crypto.randomUUID();
          run.toolItems.set(event.callId, itemId);
          run.appActions.delete(event.callId);
          updateItems(id, (items) => [...items, {
            id: itemId, type: "tool", callId: event.callId, toolName: event.toolName, args: event.args,
            status: event.needsApproval ? "pendingApproval" : "running", result: null,
          }]);
          break;
        }
        case "toolResult":
          if (!run.appActions.has(event.callId)) {
            updateItems(id, (items) => updateTool(items, run.toolItems.get(event.callId), {
              status: event.isError ? "error" : "done", result: event.result,
            }));
          }
          break;
        case "appAction": {
          const itemId = run.toolItems.get(event.callId);
          if (itemId) {
            run.appActions.add(event.callId);
            appActions.current.set(JSON.stringify([event.runId, event.callId]), { conversationId: id, itemId });
            updateItems(id, (items) => updateTool(items, itemId, { status: "running", result: "正在执行应用快捷操作…" }));
            const handler = appActionHandler.current;
            if (handler && !run.stopping && !closingRef.current) {
              handler(event, run);
            } else {
              appActions.current.delete(JSON.stringify([event.runId, event.callId]));
              updateItems(id, (items) => updateTool(items, itemId, { status: "error", result: "应用快捷操作已取消。" }));
            }
          }
          break;
        }
        case "final": {
          const text = event.text;
          if (text?.trim()) {
            updateItems(id, (items) => [...items, { id: crypto.randomUUID(), type: "assistant", text, final: true }]);
            if (!run.stopping) ensureTitle(id);
          }
          break;
        }
        case "error":
          updateItems(id, (items) => [...items, { id: crypto.randomUUID(), type: "error", text: event.message, details: event.details }]);
          break;
        case "done": {
          const pendingActions = new Set([...appActions.current.values()].map((action) => action.itemId));
          const runTools = new Set(run.toolItems.values());
          updateItems(id, (items) => items.map((item) => item.type === "tool" && runTools.has(item.id) &&
            !pendingActions.has(item.id) && (item.status === "running" || item.status === "pendingApproval")
            ? { ...item, status: "error", result: run.stopping ? "已停止等待此工具。" : "工具未返回结果。" }
            : item));
          runs.current.delete(event.runId);
          setStopping((ids) => ids.filter((item) => item !== id));
          setRunning((ids) => ids.filter((item) => item !== id));
          break;
        }
        default:
          break;
      }
    });
    void listening.then(() => {
      if (!disposed) setEventsReady(true);
    }, (cause) => {
      if (!disposed) setError(formatError(cause, "无法接收 AI 会话事件，请重新打开窗口。"));
    });
    return () => {
      disposed = true;
      void listening.then((unlisten) => unlisten(), () => undefined);
    };
  }, [ensureTitle, updateItems, windowLabel]);

  const create = () => {
    if (creation.current || closingRef.current || !isHistoryReady) return;
    setCreating(true);
    setError(null);
    creation.current = createAiConversation()
      .then((stored) => {
        const created = normalizeConversation(stored);
        replace([...conversationsRef.current, created]);
        setActiveId(created.id);
      })
      .catch((cause) => setError(formatError(cause, "无法新建会话。")))
      .finally(() => {
        creation.current = null;
        setCreating(false);
      });
  };

  const send = async ({ provider, reasoningLevel, options, message, currentServer }: SendArgs) => {
    const trimmed = message.trim();
    const conversation = conversationsRef.current.find((item) => item.id === activeId);
    if (!trimmed || !isHistoryReady || !eventsReady || !conversation || closingRef.current ||
      resets.current.has(conversation.id) || [...runs.current.values()].some((run) => run.conversationId === conversation.id)) return;
    const id = conversation.id;
    const history = conversation.items.flatMap((item) =>
      item.type === "user" || (item.type === "assistant" && item.final)
        ? [{ role: item.type, content: item.text }] : []);
    const runId = crypto.randomUUID();
    runs.current.set(runId, { id: runId, conversationId: id, currentServer, toolItems: new Map(), appActions: new Set(), stopping: false });
    setRunning((ids) => [...ids, id]);
    update(id, (current) => ({
      ...current, draft: "", selection: { providerId: provider.id, model: provider.model, reasoningLevel },
      items: [...current.items, { id: crypto.randomUUID(), type: "user", text: trimmed }],
    }));
    try {
      await sendAiMessage({ runId, conversationId: id, providerId: provider.id, model: provider.model, reasoningLevel, options, history, message: trimmed, currentServer });
    } catch (cause) {
      runs.current.delete(runId);
      setRunning((ids) => ids.filter((item) => item !== id));
      updateItems(id, (items) => [...items, { id: crypto.randomUUID(), type: "error", text: formatError(cause, "发送消息失败。") }]);
    }
  };

  function activeRun() {
    if (closingRef.current) return;
    return [...runs.current.values()].find((run) => run.conversationId === activeId && !run.stopping);
  }

  function approve(itemId: string, approved: boolean) {
    const run = activeRun();
    const item = conversationsRef.current.find((conversation) => conversation.id === activeId)?.items.find((entry) => entry.id === itemId);
    if (!run || item?.type !== "tool" || item.status !== "pendingApproval" || run.toolItems.get(item.callId) !== itemId) return;
    updateItems(run.conversationId, (items) => updateTool(items, itemId, { status: approved ? "running" : "rejected" }));
    void approveAiTool(run.id, item.callId, approved).catch((cause) => {
      if (runs.current.has(run.id)) {
        updateItems(run.conversationId, (items) => updateTool(items, itemId, { status: "pendingApproval", result: formatError(cause, "确认提交失败。") }));
      }
    });
  }

  function answerQuestion(itemId: string, answer: AiQuestionAnswer) {
    const run = activeRun();
    const item = conversationsRef.current.find((conversation) => conversation.id === activeId)?.items.find((entry) => entry.id === itemId);
    if (!run || (!answer.optionIds?.length && !answer.customText?.trim()) || item?.type !== "tool" || item.toolName !== "ask_user_question" ||
      item.status !== "running" || item.result !== null || run.toolItems.get(item.callId) !== itemId) return;
    updateItems(run.conversationId, (items) => updateTool(items, itemId, { result: "已提交回答，正在继续…" }));
    void answerAiQuestion(run.id, item.callId, answer).catch((cause) => {
      if (runs.current.has(run.id)) {
        updateItems(run.conversationId, (items) => updateTool(items, itemId, { result: null }));
        setConversationError(run.conversationId, formatError(cause, "提交回答失败。"));
      }
    });
  }

  const completeAppAction = useCallback((runId: string, callId: string, result: string, isError: boolean) => {
    const key = JSON.stringify([runId, callId]);
    const action = appActions.current.get(key);
    if (!action) return;
    appActions.current.delete(key);
    if (resets.current.has(action.conversationId)) return;
    updateItems(action.conversationId, (items) => updateTool(items, action.itemId, { status: isError ? "error" : "done", result }));
  }, [updateItems]);

  function cancel() {
    const run = activeRun();
    if (!run) return;
    run.stopping = true;
    setStopping((ids) => [...ids, run.conversationId]);
    void cancelAiRun(run.id).catch((cause) => {
      run.stopping = false;
      setStopping((ids) => ids.filter((id) => id !== run.conversationId));
      setConversationError(run.conversationId, formatError(cause, "无法停止任务。"));
    });
  }

  const reset = (remove: boolean) => {
    const id = activeId;
    if (!id || closingRef.current || resets.current.has(id) ||
      [...runs.current.values()].some((run) => run.conversationId === id)) return;
    const operation = (async () => {
      const current = conversationsRef.current.find((item) => item.id === id);
      if (!current) return;
      setConversationError(id, null);
      setResetting((ids) => [...ids, id]);
      window.clearTimeout(timers.current.get(id));
      timers.current.delete(id);
      try {
        await saves.current.get(id)?.catch(() => undefined);
        await resetAiConversation(id, remove);
        titleAttempts.current.delete(id);
        for (const [key, action] of appActions.current) {
          if (action.conversationId === id) appActions.current.delete(key);
        }
        if (remove) {
          const index = conversationsRef.current.findIndex((item) => item.id === id);
          const next = conversationsRef.current.filter((item) => item.id !== id);
          replace(next);
          const fallback = next[Math.min(index, next.length - 1)]?.id ?? null;
          setActiveId((selected) => selected === id ? fallback : selected);
        } else {
          const next = { ...current, items: [], draft: "" };
          replace(conversationsRef.current.map((item) => item.id === id ? next : item));
          await persist(next);
        }
      } catch (cause) {
        setConversationError(id, formatError(cause, "无法清理会话。"));
        const latest = conversationsRef.current.find((item) => item.id === id);
        if (latest) void persist(latest).catch(() => undefined);
      } finally {
        resets.current.delete(id);
        setResetting((ids) => ids.filter((item) => item !== id));
      }
    })();
    resets.current.set(id, operation);
  };

  const flush = async () => {
    closingRef.current = true;
    try {
      await Promise.all([creation.current, ...resets.current.values()]);
      for (const conversation of conversationsRef.current) {
        if (timers.current.has(conversation.id)) await persist(conversation);
        else await saves.current.get(conversation.id);
      }
    } finally {
      closingRef.current = false;
    }
  };

  const conversation = conversations.find((item) => item.id === activeId);
  useEffect(() => {
    if (activeId && !running.includes(activeId)) ensureTitle(activeId);
  }, [activeId, running, ensureTitle]);

  const setSelection = (selection: AiModelSelection) => {
    if (activeId && !closingRef.current && !resets.current.has(activeId)) update(activeId, (current) => ({ ...current, selection }));
  };
  const rename = (id: string, name: string) => {
    const title = name.trim();
    if (!title || [...title].length > 64 || /[\u0000-\u001f\u007f-\u009f]/u.test(title) ||
      closingRef.current || resets.current.has(id)) return;
    update(id, (current) => ({ ...current, title }));
  };
  const setDraft = (draft: string) => {
    if (activeId && !closingRef.current && !resets.current.has(activeId)) update(activeId, (current) => ({ ...current, draft }));
  };
  return {
    activeId, conversation, conversations, loading, creating, resetting,
    error: (activeId ? conversationErrors[activeId] : null) ?? error, running, stopping,
    isHistoryReady, eventsReady, create, select: setActiveId, retryLoad: () => reload((n) => n + 1),
    send, approve, answerQuestion, cancel, reset, flush, setSelection, setDraft, rename, setAppActionHandler, completeAppAction,
  };
}

export type AiChat = ReturnType<typeof useAiChat>;

function normalizeChatItem(value: unknown): ChatItem[] {
  if (!isRecord(value) || typeof value.id !== "string") {
    return [];
  }
  if (value.type === "error") {
    return typeof value.text === "string" ? [{ id: value.id, type: "error", text: value.text, details: isRecord(value.details) ? value.details : undefined }] : [];
  }
  if (value.type === "user") {
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
