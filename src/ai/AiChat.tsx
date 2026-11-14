import { useEffect, useId, useMemo, useRef, useState } from "react";
import { MAX_AI_QUESTION_ANSWER_LENGTH, type AiQuestionAnswer, type AiServerContext } from "../models/ai";
import { Icon } from "../ui/Icon";
import { IconButton } from "../ui/IconButton";
import { Button } from "../ui/Button";
import { SelectMenu } from "../ui/SelectMenu";
import { Markdown } from "./Markdown";
import type { ChatItem } from "./useAiChat";
import type { AiChat as AiChatController } from "./useAiChat";
import type { AiConfig } from "./useAiConfig";
import type { TerminalSession } from "../models";
import { AiBackgroundSessions } from "./AiBackgroundSessions";
import type { AssistantDockPosition } from "../app/assistantDock";
import { AiToolbarMenu } from "./AiToolbarMenu";

interface AiChatProps {
  config: AiConfig;
  chat: AiChatController;
  onOpenConfig: () => void;
  onTakeOverSession?: (session: TerminalSession) => Promise<void>;
  dockPosition?: AssistantDockPosition;
  onDockPositionChange?: (position: AssistantDockPosition) => void;
  /** Closes the containing right dock when the assistant is shown as a panel. */
  onClose?: () => void;
  /** "panel" = compact sidebar; "window" = wide standalone window. */
  layout?: "panel" | "window";
  /** When true the assistant is locked until an SSH session is open. */
  locked?: boolean;
  currentServer?: AiServerContext | null;
}

export function AiChat({
  config,
  chat,
  onOpenConfig,
  onTakeOverSession,
  dockPosition = "right",
  onDockPositionChange,
  onClose,
  layout = "window",
  locked = false,
  currentServer = null,
}: AiChatProps) {
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const { options, providers } = config;
  const { answerQuestion, approve, cancel, conversation, isHistoryReady, send, setDraft } = chat;
  const items = conversation?.items;
  const stopping = conversation ? chat.stopping.includes(conversation.id) : false;
  const draft = conversation?.draft ?? "";
  const resetting = conversation ? chat.resetting.includes(conversation.id) : false;
  const isRunning = conversation ? chat.running.includes(conversation.id) : false;
  const selection = conversation?.selection;
  const selectedProvider = providers.find((provider) => provider.id === selection?.providerId);
  const selectedModel = selectedProvider?.models.find((model) => model.id === selection?.model);
  const activeProvider = selectedProvider && selectedModel
    ? { ...selectedProvider, model: selectedModel.id }
    : config.activeProvider;
  const currentModel = activeProvider?.models.find((model) => model.id === activeProvider.model);
  const selectedLevel = selectedModel?.reasoningLevels.some((row) => row.level === selection?.reasoningLevel)
    ? selection?.reasoningLevel : null;
  const reasoningLevel = selectedLevel ?? currentModel?.reasoningEffort ?? currentModel?.reasoningLevels[0]?.level ?? null;
  const isConfigured = config.isReady && Boolean(activeProvider?.baseUrl.trim() && currentModel);
  const sessionOptions = chat.conversations.map((entry, index) => {
    const title = entry.title ?? `会话 ${index + 1}`;
    const status = chat.stopping.includes(entry.id) ? "正在停止" : entry.items.some((item) => item.type === "tool" &&
      (item.status === "pendingApproval" || (item.toolName === "ask_user_question" && item.status === "running" && item.result === null)))
      ? "待确认" : chat.running.includes(entry.id) ? "运行中" : "";
    return { value: entry.id, title, label: status ? `${title} · ${status}` : title };
  });
  const modelOptions = useMemo(() => providers.flatMap((provider) => {
    const models = provider.models;
    return models.map((model) => ({
      label: `${provider.label} / ${model.displayName}${model.displayName !== model.id ? ` (${model.id})` : ""}`,
      value: JSON.stringify([provider.id, model.id]),
    }));
  }), [providers]);

  useEffect(() => {
    const node = listRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [items, conversation?.id]);

  const canSend = Boolean(conversation && chat.eventsReady && isConfigured && isHistoryReady && !locked && !isRunning && !resetting && draft.trim());

  function handleSend() {
    if (!activeProvider || !canSend) {
      return;
    }
    void send({ provider: activeProvider, reasoningLevel, options, message: draft, currentServer });
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      handleSend();
    }
  }

  function handleClear() {
    if (window.confirm("清空当前会话的聊天记录和草稿，并关闭它尚未接管的后台终端？聊天记录无法恢复。")) {
      chat.reset(false);
    }
  }

  const placeholder = locked
    ? "请先打开一个终端后再使用"
    : !isHistoryReady
      ? "正在加载会话…"
      : !conversation
      ? "请先新建会话"
    : isConfigured
      ? "描述你的目标，例如：检查磁盘使用情况"
      : "请先配置模型后端";

  return (
    <section className={`ai-chat ai-chat--${layout}${layout === "panel" ? ` ai-chat--${dockPosition}` : ""}`} aria-label="AI 对话">
      <header className="ai-chat__header">
        <SelectMenu ariaLabel="切换 AI 会话" className="ai-chat__session-select"
          options={sessionOptions.length ? sessionOptions : [{ value: "", label: "AI 助手", disabled: true }]}
          value={chat.activeId ?? ""} disabled={!sessionOptions.length}
          onChange={chat.select} searchable={sessionOptions.length > 5} searchPlaceholder="搜索会话…" />
        <div className="ai-chat__header-actions">
          <IconButton label="新建会话"
            disabled={!isHistoryReady || chat.creating} onClick={chat.create}>
            <Icon name="plus" height="16" width="16" />
          </IconButton>
          <AiToolbarMenu
            position={dockPosition}
            onPositionChange={onDockPositionChange}
            onOpenConfig={onOpenConfig}
            renameDisabled={!conversation || resetting}
            onRename={() => {
              const selected = sessionOptions.find((entry) => entry.value === conversation?.id);
              if (selected) setRenaming({ id: selected.value, title: selected.title });
            }}
            sessionActionsDisabled={!conversation || isRunning || resetting}
            onClear={handleClear}
            onDelete={() => {
              if (window.confirm("删除当前会话及其聊天记录，并关闭它尚未接管的后台终端？")) chat.reset(true);
            }}
          />
          {onClose ? (
            <IconButton label="关闭 AI 助手" onClick={onClose}>
              <Icon name="close" height="16" width="16" />
            </IconButton>
          ) : null}
        </div>
      </header>

      {renaming ? <ConversationRenameDialog
        title={renaming.title}
        onCancel={() => setRenaming(null)}
        onRename={(title) => {
          chat.rename(renaming.id, title);
          setRenaming(null);
        }}
      /> : null}
      {conversation ? <AiBackgroundSessions key={`background-${conversation.id}`} conversationId={conversation.id} onTakeOver={onTakeOverSession} /> : null}

      {currentServer && !locked ? (
        <div className="ai-chat__context" title={`当前终端：${currentServer.label}`}>
          <Icon name={currentServer.kind === "ssh" ? "ssh" : "terminalTool"} height="13" width="13" />
          <span>当前终端：{currentServer.label}</span>
        </div>
      ) : null}

      <div className="ai-chat__body" ref={listRef} key={conversation?.id}>
        {!isHistoryReady ? (
          <div className="ai-chat__empty">
            {chat.loading ? "正在加载会话…" : <Button onClick={chat.retryLoad}>重新加载会话</Button>}
          </div>
        ) : !conversation ? (
          <div className="ai-chat__empty">
            <Button disabled={chat.creating} onClick={chat.create}>新建会话</Button>
          </div>
        ) : !items?.length ? (
          <AiEmptyState isConfigured={isConfigured} locked={locked} onOpenConfig={onOpenConfig} />
        ) : (
          <div className="ai-chat__messages">
            {items.map((item) => (
              <ChatItemView
                item={item}
                key={item.id}
                onAnswerQuestion={answerQuestion}
                onApprove={approve}
              />
            ))}
            {isRunning ? (
              <div className="ai-chat__thinking">
                <span className="ai-chat__dot" />
                <span className="ai-chat__dot" />
                <span className="ai-chat__dot" />
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div className="ai-chat__composer">
        {chat.error || config.error ? <div className="ai-provider__error" role="alert">{chat.error ?? config.error}</div> : null}
        <textarea
          aria-label="向 AI 提问"
          className="ai-chat__input"
          disabled={!conversation || !isConfigured || !isHistoryReady || locked || resetting}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={layout === "panel" ? 2 : 3}
          value={draft}
        />
        <div className="ai-chat__composer-actions">
          {modelOptions.length ? (
            <SelectMenu
              ariaLabel="切换厂商与模型"
              className="ai-chat__model-select"
              disabled={!conversation || isRunning || resetting || !config.isReady}
              searchable
              searchPlaceholder="搜索厂商或模型…"
              value={activeProvider ? JSON.stringify([activeProvider.id, activeProvider.model]) : ""}
              options={[{ label: "选择模型", value: "", disabled: true }, ...modelOptions]}
              onChange={(value) => {
                const [id, model] = JSON.parse(value) as [string, string];
                const selected = providers.find((provider) => provider.id === id)?.models.find((entry) => entry.id === model);
                if (selected) chat.setSelection({ providerId: id, model, reasoningLevel: selected.reasoningEffort ?? selected.reasoningLevels[0]?.level ?? null });
              }}
            />
          ) : (
            <Button className="ai-chat__configure" onClick={onOpenConfig} title="打开模型配置">
              <Icon name="settings" height="16" width="16" />配置模型
            </Button>
          )}
          {activeProvider && currentModel?.reasoningLevels.length ? (
            <SelectMenu ariaLabel="选择推理档位" className="ai-chat__reasoning-select" disabled={!conversation || isRunning || resetting}
              value={reasoningLevel ?? ""}
              options={currentModel.reasoningLevels.map((row) => ({ value: row.level, label: row.level }))}
              onChange={(level) => chat.setSelection({ providerId: activeProvider.id, model: currentModel.id, reasoningLevel: level })} />
          ) : null}
          {isRunning ? (
            <button className="ai-chat__send is-stop" onClick={cancel} disabled={stopping} type="button">
              <Icon name="stop" height="16" width="16" />
              {stopping ? "正在停止…" : "停止"}
            </button>
          ) : (
            <button className="ai-chat__send" disabled={!canSend} onClick={handleSend} type="button">
              <Icon name="send" height="16" width="16" />
              发送
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function ConversationRenameDialog({ title, onCancel, onRename }: {
  title: string;
  onCancel: () => void;
  onRename: (title: string) => void;
}) {
  const [name, setName] = useState(title);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const headingId = useId();
  const valid = name.trim().length > 0 && !/[\u0000-\u001f\u007f-\u009f]/u.test(name.trim());

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    input.current?.select();
    return () => element?.close();
  }, []);

  return (
    <dialog className="ai-rename-dialog" ref={dialog} aria-labelledby={headingId}
      onCancel={(event) => { event.preventDefault(); onCancel(); }}>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (valid) onRename(name);
      }}>
        <h2 id={headingId}>重命名会话</h2>
        <label className="field">
          会话名称
          <input ref={input} value={name} maxLength={64}
            onChange={(event) => setName(event.currentTarget.value)} />
        </label>
        <div className="ai-rename-dialog__actions">
          <Button onClick={onCancel}>取消</Button>
          <Button type="submit" variant="primary" disabled={!valid}>保存</Button>
        </div>
      </form>
    </dialog>
  );
}

function AiEmptyState({
  isConfigured,
  locked,
  onOpenConfig,
}: {
  isConfigured: boolean;
  locked: boolean;
  onOpenConfig: () => void;
}) {
  if (locked) {
    return (
      <div className="ai-chat__empty">
        <Icon name="terminalTool" height="28" width="28" />
        <p className="ai-chat__empty-title">需要先打开一个终端</p>
        <p className="ai-chat__empty-hint">
          AI 助手需要在已打开的终端上工作，请先连接一台 SSH 服务器或打开本地终端。
        </p>
      </div>
    );
  }

  return (
    <div className="ai-chat__empty">
      <Icon name="terminalTool" height="22" width="22" />
      {isConfigured ? (
        <>
          <p className="ai-chat__empty-title">描述要完成的任务</p>
          <p className="ai-chat__empty-hint">
            可以从连接、终端输出或主机状态开始排查。远程操作会先请你确认。
          </p>
        </>
      ) : (
        <>
          <p className="ai-chat__empty-title">尚未配置模型后端</p>
          <p className="ai-chat__empty-hint">请先配置 API 地址、密钥与模型，即可开始使用 AI 助手。</p>
          <button className="ai-chat__send" onClick={onOpenConfig} type="button">
            <Icon name="settings" height="16" width="16" />
            前往配置
          </button>
        </>
      )}
    </div>
  );
}

function ChatItemView({
  item,
  onAnswerQuestion,
  onApprove,
}: {
  item: ChatItem;
  onAnswerQuestion: (callId: string, answer: AiQuestionAnswer) => void;
  onApprove: (callId: string, approved: boolean) => void;
}) {
  if (item.type === "user") {
    return (
      <div className="ai-msg ai-msg--user">
        <div className="ai-msg__bubble">{item.text}</div>
      </div>
    );
  }

  if (item.type === "assistant") {
    return (
      <div className="ai-msg ai-msg--assistant">
        <div className="ai-msg__bubble">
          <Markdown content={item.text} />
        </div>
      </div>
    );
  }

  if (item.type === "error") {
    return <div className="ai-msg ai-msg--error">
      <div>{item.text}</div>
      {item.details ? <details className="ai-request-error">
        <summary>查看错误详情（已脱敏）</summary>
        <pre>{JSON.stringify(item.details, null, 2)}</pre>
      </details> : null}
    </div>;
  }

  return <ToolCardView item={item} onAnswerQuestion={onAnswerQuestion} onApprove={onApprove} />;
}

function ToolCardView({
  item,
  onAnswerQuestion,
  onApprove,
}: {
  item: Extract<ChatItem, { type: "tool" }>;
  onAnswerQuestion: (callId: string, answer: AiQuestionAnswer) => void;
  onApprove: (callId: string, approved: boolean) => void;
}) {
  const label = TOOL_LABELS[item.toolName] ?? item.toolName;
  const browserTool = item.toolName.startsWith("browser_");
  const command = useMemo(() => extractCommand(item.args), [item.args]);
  const sshConnection = useMemo(() => extractSshConnection(item.args), [item.args]);
  const terminalInput = item.toolName === "write_terminal" && typeof item.args.input === "string"
    ? { input: item.args.input, terminal: typeof item.args.terminal === "string" ? item.args.terminal : "当前终端", sessionId: typeof item.args.session_id === "string" ? item.args.session_id : "" }
    : null;
  const userQuestion = useMemo(() => extractUserQuestion(item.args), [item.args]);
  // Commands and their output are collapsed by default so the conversation
  // stays focused on the prompt and the final answer. Pending approvals stay
  // open because the user has to act on them.
  const needsApproval = item.status === "pendingApproval";
  const [open, setOpen] = useState(false);
  const questionInProgress = Boolean(userQuestion) && item.status === "running";
  const expanded = needsApproval || questionInProgress || open;
  const hasDetails = Boolean(command) || Boolean(item.result) || needsApproval || Boolean(userQuestion);

  return (
    <div className={`ai-tool ai-tool--${item.status}${expanded ? " is-open" : ""}`}>
      <button
        aria-expanded={expanded}
        className="ai-tool__head"
        disabled={needsApproval || !hasDetails}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <Icon name={browserTool ? "globe" : item.toolName === "open_ssh_session" ? "ssh" : "terminalTool"} height="15" width="15" />
        <span className="ai-tool__name">{label}</span>
        {terminalInput ? <span className="ai-tool__preview">{terminalInput.terminal} · {terminalInput.input} ↵</span> : sshConnection ? (
          <span className="ai-tool__preview">{sshConnection.username}@{sshConnection.host}:{sshConnection.port}</span>
        ) : userQuestion ? <span className="ai-tool__preview">{userQuestion.question}</span>
          : command ? <span className="ai-tool__preview">{command}</span> : null}
        <span className={`ai-tool__status ai-tool__status--${item.status}`}>
          {STATUS_LABELS[item.status]}
        </span>
        {!needsApproval && hasDetails ? (
          <Icon
            className="ai-tool__chevron"
            name={expanded ? "chevron-down" : "chevron-right"}
            height="14"
            width="14"
          />
        ) : null}
      </button>
      {expanded ? (
        <>
          {browserTool ? <pre className="ai-tool__command">{JSON.stringify(item.args, null, 2)}</pre> : null}
          {terminalInput ? <pre className="ai-tool__command">{terminalInput.input}{"\n↵ 回车"}</pre> : !userQuestion && command ? <pre className="ai-tool__command">{command}</pre> : null}
          {userQuestion ? (
            <UserQuestionChoices
              answered={!questionInProgress || item.result !== null}
              callId={item.id}
              question={userQuestion}
              onAnswer={onAnswerQuestion}
            />
          ) : null}
          {needsApproval ? (
            <div className="ai-tool__approval">
              <span className="ai-tool__approval-hint">
                {browserTool
                  ? item.toolName === "browser_read" ? "是否允许将此页面的可见正文和元素发送给当前 AI 模型？" : "是否允许执行以上浏览器操作？点击可能提交表单或产生外部副作用。"
                  : terminalInput
                  ? `是否允许向终端“${terminalInput.terminal}”（${terminalInput.sessionId}）输入以上内容并按回车？`
                  : sshConnection
                  ? `是否允许在后台建立 SSH 连接“${sshConnection.name}”（${sshConnection.username}@${sshConnection.host}:${sshConnection.port}）？`
                  : "是否允许执行该命令？"}
              </span>
              <div className="ai-tool__approval-buttons">
                <button
                  className="ai-tool__btn ai-tool__btn--approve"
                  onClick={() => onApprove(item.id, true)}
                  type="button"
                >
                  <Icon name="check" height="15" width="15" />
                  允许
                </button>
                <button
                  className="ai-tool__btn ai-tool__btn--reject"
                  onClick={() => onApprove(item.id, false)}
                  type="button"
                >
                  <Icon name="close" height="15" width="15" />
                  拒绝
                </button>
              </div>
            </div>
          ) : null}
          {item.result ? <pre className="ai-tool__result">{item.result}</pre> : null}
        </>
      ) : null}
    </div>
  );
}

interface UserQuestion {
  question: string;
  options: Array<{ id: string; label: string; description: string | null }>;
  allowMultiple: boolean;
}

function UserQuestionChoices({
  answered,
  callId,
  question,
  onAnswer,
}: {
  answered: boolean;
  callId: string;
  question: UserQuestion;
  onAnswer: (callId: string, answer: AiQuestionAnswer) => void;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [customText, setCustomText] = useState("");
  const answer = customText.trim();

  function select(optionId: string) {
    if (answered) {
      return;
    }
    if (!question.allowMultiple) {
      onAnswer(callId, { optionIds: [optionId] });
      return;
    }
    setSelectedIds((current) =>
      current.includes(optionId)
        ? current.filter((id) => id !== optionId)
        : [...current, optionId],
    );
  }

  return (
    <div className="ai-question">
      <p className="ai-question__prompt">{question.question}</p>
      <div className="ai-question__options" role={question.allowMultiple ? "group" : "radiogroup"}>
        {question.options.map((option) => {
          const selected = selectedIds.includes(option.id);
          return (
            <button
              aria-checked={question.allowMultiple ? undefined : selected}
              className={`ai-question__option${selected ? " is-selected" : ""}`}
              disabled={answered}
              key={option.id}
              onClick={() => select(option.id)}
              role={question.allowMultiple ? undefined : "radio"}
              type="button"
            >
              <span className="ai-question__option-label">{option.label}</span>
              {option.description ? <span className="ai-question__option-description">{option.description}</span> : null}
            </button>
          );
        })}
      </div>
      {question.allowMultiple && !answered ? (
        <button
          className="ai-tool__btn ai-tool__btn--approve"
          disabled={selectedIds.length === 0}
          onClick={() => onAnswer(callId, { optionIds: selectedIds })}
          type="button"
        >
          确认选择
        </button>
      ) : null}
      {!answered ? (
        <form className="ai-question__custom" onSubmit={(event) => {
          event.preventDefault();
          if (answer) onAnswer(callId, { customText: answer });
        }}>
          <label className="field">
            自定义回答
            <textarea
              value={customText}
              onChange={(event) => setCustomText(event.currentTarget.value)}
              maxLength={MAX_AI_QUESTION_ANSWER_LENGTH}
              placeholder="输入你的答案…"
              rows={2}
            />
          </label>
          <Button type="submit" disabled={!answer}>提交回答</Button>
        </form>
      ) : null}
    </div>
  );
}

const TOOL_LABELS: Record<string, string> = {
  browser_list_pages: "列出浏览器页面",
  browser_open: "打开浏览器页面",
  browser_read: "读取浏览器页面",
  browser_navigate: "浏览器跳转",
  browser_interact: "操作浏览器页面",
  list_servers: "列出服务器",
  run_command: "执行命令",
  open_ssh_session: "后台 SSH 连接",
  control_app: "应用快捷操作",
  ask_user_question: "需要你的回答",
  read_terminal: "读取终端输出",
  list_terminal_sessions: "列出活动终端",
  write_terminal: "输入到交互终端",
};

const STATUS_LABELS: Record<string, string> = {
  pendingApproval: "等待确认",
  running: "执行中",
  done: "完成",
  rejected: "已拒绝",
  error: "出错",
};

function extractCommand(args: Record<string, unknown>): string | null {
  const command = args.command;
  if (typeof command === "string" && command.trim()) {
    const serverId = typeof args.server_id === "string" ? args.server_id : null;
    return serverId ? `[${serverId}] ${command}` : command;
  }
  const keys = Object.keys(args);
  if (keys.length === 0) {
    return null;
  }
  return JSON.stringify(args, null, 2);
}

function extractSshConnection(args: Record<string, unknown>) {
  const server = args.server;
  if (
    !isRecord(server) ||
    typeof server.name !== "string" ||
    typeof server.host !== "string" ||
    typeof server.port !== "number" ||
    typeof server.username !== "string"
  ) {
    return null;
  }
  return {
    name: server.name,
    host: server.host,
    port: server.port,
    username: server.username,
  };
}

function extractUserQuestion(args: Record<string, unknown>): UserQuestion | null {
  if (typeof args.question !== "string" || !Array.isArray(args.options)) {
    return null;
  }
  const question = args.question.trim();
  if (!question || args.options.length < 2 || args.options.length > 6) {
    return null;
  }
  const options = args.options.flatMap((option) => {
    if (!isRecord(option) || typeof option.id !== "string" || typeof option.label !== "string") {
      return [];
    }
    const id = option.id.trim();
    const label = option.label.trim();
    if (!id || !label) {
      return [];
    }
    return [{
      id,
      label,
      description: typeof option.description === "string" && option.description.trim()
        ? option.description.trim()
        : null,
    }];
  });
  return options.length === args.options.length
    ? { question, options, allowMultiple: args.allow_multiple === true }
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
