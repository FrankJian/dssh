import type { TerminalSession } from "../models";
import { Icon } from "../ui/Icon";

interface TerminalTabStripProps {
  activeSessionId: string | null;
  onCloseSession: (sessionId: string) => void;
  onSelectSession: (sessionId: string) => void;
  sessions: TerminalSession[];
}

export function TerminalTabStrip({
  activeSessionId,
  onCloseSession,
  onSelectSession,
  sessions,
}: TerminalTabStripProps) {
  return (
    <div className="tab-strip" role="tablist" aria-label="终端会话">
      {sessions.map((tab, index) => {
        const isActive = tab.id === activeSessionId;
        return (
          <div
            aria-selected={isActive}
            className={`tab ${isActive ? "is-active" : ""}`.trim()}
            key={tab.id}
            onClick={() => onSelectSession(tab.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelectSession(tab.id);
              }
            }}
            role="tab"
            tabIndex={0}
          >
            <span className="tab__index">{index + 1}</span>
            <span className="tab__title">{tab.title}</span>
            <span
              aria-label="关闭"
              className="tab__action tab__close"
              onClick={(event) => {
                event.stopPropagation();
                onCloseSession(tab.id);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  onCloseSession(tab.id);
                }
              }}
              role="button"
              tabIndex={0}
              title="关闭"
            >
              <Icon name="close" height="13" width="13" />
            </span>
          </div>
        );
      })}
    </div>
  );
}
