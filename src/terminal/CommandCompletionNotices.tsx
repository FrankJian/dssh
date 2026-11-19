import { useEffect, useImperativeHandle, useState, type Ref } from "react";
import { Icon } from "../ui/Icon";

interface CompletionTarget {
  tabId: string;
  sessionId: string;
  title: string;
}

interface CompletionNotice extends CompletionTarget {
  expiresAt: number;
}

export interface CommandCompletionNoticeHandle {
  show: (target: CompletionTarget) => void;
}

const NOTICE_DURATION_MS = 8000;
const MAX_VISIBLE_NOTICES = 3;

export function CommandCompletionNotices({
  ref,
  onOpen,
}: {
  ref: Ref<CommandCompletionNoticeHandle>;
  onOpen: (target: CompletionTarget) => void;
}) {
  const [notices, setNotices] = useState<CompletionNotice[]>([]);
  const [hoveredTabId, setHoveredTabId] = useState<string | null>(null);
  const [focusedTabId, setFocusedTabId] = useState<string | null>(null);

  useImperativeHandle(ref, () => ({
    show(target) {
      const notice = { ...target, expiresAt: Date.now() + NOTICE_DURATION_MS };
      setNotices((current) => [
        notice,
        ...current.filter((item) => item.tabId !== notice.tabId),
      ].slice(0, MAX_VISIBLE_NOTICES));
    },
  }), []);

  // A single timer services the stack, regardless of how many commands finish.
  const nextExpiry = notices[notices.length - 1]?.expiresAt;
  const paused = notices.some((notice) => notice.tabId === hoveredTabId || notice.tabId === focusedTabId);
  useEffect(() => {
    if (paused || nextExpiry === undefined) return;
    const timeout = window.setTimeout(() => {
      const now = Date.now();
      setNotices((current) => current.filter((notice) => notice.expiresAt > now));
    }, Math.max(1, nextExpiry - Date.now()));
    return () => window.clearTimeout(timeout);
  }, [paused, nextExpiry]);

  function dismiss(tabId: string) {
    setNotices((current) => current.filter((notice) => notice.tabId !== tabId));
    setHoveredTabId((current) => current === tabId ? null : current);
    setFocusedTabId((current) => current === tabId ? null : current);
  }

  return (
    <div aria-live="polite" className="command-completion-notices">
      {notices.map((notice) => (
        <div
          className="command-completion-notice"
          key={notice.tabId}
          onMouseEnter={() => setHoveredTabId(notice.tabId)}
          onMouseLeave={() => setHoveredTabId(null)}
          onFocus={() => setFocusedTabId(notice.tabId)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setFocusedTabId(null);
          }}
        >
          <button
            aria-label={`任务完成，打开标签 ${notice.title}`}
            className="command-completion-notice__open"
            onClick={() => {
              dismiss(notice.tabId);
              onOpen(notice);
            }}
            type="button"
          >
            <span className="command-completion-notice__icon"><Icon name="check" height="16" width="16" /></span>
            <span className="command-completion-notice__text">
              <strong>任务完成</strong>
              <span title={notice.title}>{notice.title}</span>
            </span>
            <Icon className="command-completion-notice__arrow" name="arrowRight" height="14" width="14" />
          </button>
          <button
            aria-label={`关闭 ${notice.title} 的任务完成通知`}
            className="toast__close"
            onClick={() => dismiss(notice.tabId)}
            type="button"
          >
            <Icon name="close" height="13" width="13" />
          </button>
        </div>
      ))}
    </div>
  );
}
