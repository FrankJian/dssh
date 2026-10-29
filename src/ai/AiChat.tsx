import { useEffect, useMemo, useRef, useState } from "react";
import type { AiServerContext } from "../models/ai";
import { Icon } from "../ui/Icon";
import { IconButton } from "../ui/IconButton";
import { Button } from "../ui/Button";
import { SelectMenu } from "../ui/SelectMenu";
import { Markdown } from "./Markdown";
import type { ChatItem } from "./useAiChat";
import type { AiChat as AiChatController } from "./useAiChat";
import type { AiConfig } from "./useAiConfig";

interface AiChatProps {
  config: AiConfig;
  chat: AiChatController;
  onOpenConfig: () => void;
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
  onClose,
  layout = "window",
  locked = false,
  currentServer = null,
}: AiChatProps) {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);
  const { activeProvider, isConfigured, options, providers } = config;
  const { answerQuestion, approve, cancel, clear, isHistoryReady, isRunning, items, send } = chat;
  const currentModel = activeProvider?.models.find((model) => model.id === activeProvider.model);
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
  }, [items]);

  const canSend = isConfigured && isHistoryReady && !locked && !isRunning && draft.trim().length > 0;

  function handleSend() {
    if (!activeProvider || !canSend) {
      return;
    }
    void send({ provider: activeProvider, options, message: draft, currentServer });
    setDraft("");
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      handleSend();
    }
  }

  function handleClear() {
    if (window.confirm("确定要永久清空全部 AI 聊天记录吗？此操作无法恢复。")) {
      clear();
    }
  }

  const placeholder = locked
    ? "请先打开一个终端后再使用"
    : !isHistoryReady
      ? "正在加载聊天记录..."
    : isConfigured
      ? "描述你的目标，例如：检查磁盘使用情况"
      : "请先配置模型后端";

  return (
    <section className={`ai-chat ai-chat--${layout}`} aria-label="AI 对话">
      <header className="ai-chat__header">
        <div className="ai-chat__title">
          <Icon name="bot" height="16" width="16" />
          <span>AI 助手</span>
        </div>
        <div className="ai-chat__header-actions">
          <IconButton
            label="清空全部聊天记录"
            disabled={!isHistoryReady || isRunning || items.length === 0}
            onClick={handleClear}
          >
            <Icon name="trash" height="16" width="16" />
          </IconButton>
          <IconButton label="模型配置" onClick={onOpenConfig}>
            <Icon name="settings" height="16" width="16" />
          </IconButton>
          {onClose ? (
            <IconButton label="关闭 AI 助手" onClick={onClose}>
              <Icon name="close" height="16" width="16" />
            </IconButton>
          ) : null}
        </div>
      </header>

      {currentServer && !locked ? (
        <div className="ai-chat__context" title={`当前终端：${currentServer.label}`}>
          <Icon name={currentServer.kind === "ssh" ? "ssh" : "terminalTool"} height="13" width="13" />
          <span>当前终端：{currentServer.label}</span>
        </div>
      ) : null}

      <div className="ai-chat__body" ref={listRef}>
        {items.length === 0 ? (
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
        {config.error ? <div className="ai-provider__error" role="alert">{config.error}</div> : null}
        <textarea
          aria-label="向 AI 提问"
          className="ai-chat__input"
          disabled={!isConfigured || !isHistoryReady || locked}
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
              disabled={isRunning || !config.isReady}
              searchable
              searchPlaceholder="搜索厂商或模型…"
              value={activeProvider ? JSON.stringify([activeProvider.id, activeProvider.model]) : ""}
              options={[{ label: "选择模型", value: "", disabled: true }, ...modelOptions]}
              onChange={(value) => {
                const [id, model] = JSON.parse(value) as [string, string];
                config.selectModel(id, model);
              }}
            />
          ) : (
            <Button className="ai-chat__configure" onClick={onOpenConfig} title="打开模型配置">
              <Icon name="settings" height="16" width="16" />配置模型
            </Button>
          )}
          {activeProvider && currentModel?.reasoningLevels.length ? (
            <SelectMenu ariaLabel="选择推理档位" className="ai-chat__reasoning-select" disabled={isRunning}
              value={currentModel.reasoningEffort ?? currentModel.reasoningLevels[0].level}
              options={currentModel.reasoningLevels.map((row) => ({ value: row.level, label: row.level }))}
              onChange={(level) => config.selectReasoningLevel(activeProvider.id, currentModel.id, level)} />
          ) : null}
          {isRunning ? (
            <button className="ai-chat__send is-stop" onClick={cancel} type="button">
              <Icon name="stop" height="16" width="16" />
              停止
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
      <Icon name="bot" height="28" width="28" />
      {isConfigured ? (
        <>
          <p className="ai-chat__empty-title">开始与 AI 助手对话</p>
          <p className="ai-chat__empty-hint">
            我可以操作应用界面、查找已保存的服务器、请求打开 SSH 连接，或在当前终端上帮助你排查问题。
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
  onAnswerQuestion: (callId: string, optionIds: string[]) => void;
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
    return <div className="ai-msg ai-msg--error">{item.text}</div>;
  }

  return <ToolCardView item={item} onAnswerQuestion={onAnswerQuestion} onApprove={onApprove} />;
}

function ToolCardView({
  item,
  onAnswerQuestion,
  onApprove,
}: {
  item: Extract<ChatItem, { type: "tool" }>;
  onAnswerQuestion: (callId: string, optionIds: string[]) => void;
  onApprove: (callId: string, approved: boolean) => void;
}) {
  const label = TOOL_LABELS[item.toolName] ?? item.toolName;
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
  const awaitingAnswer = item.toolName === "ask_user_question" && item.result === null;
  const expanded = needsApproval || awaitingAnswer || open;
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
        <Icon name={item.toolName === "open_ssh_session" ? "ssh" : "terminalTool"} height="15" width="15" />
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
          {terminalInput ? <pre className="ai-tool__command">{terminalInput.input}{"\n↵ 回车"}</pre> : !userQuestion && command ? <pre className="ai-tool__command">{command}</pre> : null}
          {userQuestion ? (
            <UserQuestionChoices
              answered={item.result !== null}
              callId={item.callId}
              question={userQuestion}
              onAnswer={onAnswerQuestion}
            />
          ) : null}
          {needsApproval ? (
            <div className="ai-tool__approval">
              <span className="ai-tool__approval-hint">
                {terminalInput
                  ? `是否允许向终端“${terminalInput.terminal}”（${terminalInput.sessionId}）输入以上内容并按回车？`
                  : sshConnection
                  ? `是否允许打开 SSH 连接“${sshConnection.name}”（${sshConnection.username}@${sshConnection.host}:${sshConnection.port}）？`
                  : "是否允许执行该命令？"}
              </span>
              <div className="ai-tool__approval-buttons">
                <button
                  className="ai-tool__btn ai-tool__btn--approve"
                  onClick={() => onApprove(item.callId, true)}
                  type="button"
                >
                  <Icon name="check" height="15" width="15" />
                  允许
                </button>
                <button
                  className="ai-tool__btn ai-tool__btn--reject"
                  onClick={() => onApprove(item.callId, false)}
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
  onAnswer: (callId: string, optionIds: string[]) => void;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  function select(optionId: string) {
    if (answered) {
      return;
    }
    if (!question.allowMultiple) {
      onAnswer(callId, [optionId]);
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
          onClick={() => onAnswer(callId, selectedIds)}
          type="button"
        >
          确认选择
        </button>
      ) : null}
    </div>
  );
}

const TOOL_LABELS: Record<string, string> = {
  list_servers: "列出服务器",
  run_command: "执行命令",
  open_ssh_session: "打开 SSH 连接",
  control_app: "应用快捷操作",
  ask_user_question: "需要你的选择",
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
