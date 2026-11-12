import { ConnectionAddress } from "./ConnectionAddress";
import { profileIconName, sftpConnectionIconName } from "./profileIcons";
import { isJumpServerSource } from "../models/jumpserver";
import { useMemo, useState, type ReactNode } from "react";
import type { SshProfile, TerminalSession } from "../models";
import type { SessionStatus } from "../models/terminal";
import { Icon } from "../ui/Icon";
import { SectionHeader } from "../ui/SectionHeader";
import { paneSessionIds, type PaneLayout } from "../terminal/usePaneLayout";
import type { SftpTab } from "../app/useWorkspace";
import { isOpenSshTerminal } from "../app/sftpTerminal";

/** Terminal sessions and open SFTP tabs sharing a target. */
export interface SessionNode {
  /** profileId for ssh nodes, "local" for the local-terminals group. */
  key: string;
  kind: "ssh" | "local";
  title: string;
  subtitle: string;
  profile: SshProfile | null;
  sessions: TerminalSession[];
  sftpTabs: SftpTab[];
  status: SessionStatus | null;
}

const LOCAL_KEY = "local";
const STATUS_LABELS: Record<SessionStatus, string> = {
  connecting: "正在连接", connected: "已连接", reconnecting: "正在重连",
  disconnecting: "正在断开", disconnected: "已断开", exited: "已退出", failed: "连接失败",
};

function aggregateStatus(sessions: TerminalSession[]): SessionStatus {
  if (sessions.some((s) => s.status === "connected")) return "connected";
  if (sessions.some((s) => s.status === "connecting")) return "connecting";
  return sessions[0]?.status ?? "disconnected";
}

function buildNodes(sessions: TerminalSession[], profiles: SshProfile[], sftpTabs: SftpTab[]): SessionNode[] {
  const byKey = new Map<string, { sessions: TerminalSession[]; sftpTabs: SftpTab[] }>();
  function groupFor(key: string) {
    let group = byKey.get(key);
    if (!group) {
      group = { sessions: [], sftpTabs: [] };
      byKey.set(key, group);
    }
    return group;
  }
  for (const session of sessions) {
    groupFor(session.kind === "ssh" ? session.profileId : LOCAL_KEY).sessions.push(session);
  }
  for (const tab of sftpTabs) {
    groupFor(tab.profileId).sftpTabs.push(tab);
  }

  return Array.from(byKey, ([key, group]) => {
    if (key === LOCAL_KEY) {
      return {
        key,
        kind: "local",
        title: "本地终端",
        subtitle: "",
        profile: null,
        ...group,
        status: aggregateStatus(group.sessions),
      };
    }
    const profile = profiles.find((p) => p.id === key) ?? null;
    return {
      key,
      kind: "ssh",
      title: profile?.name ?? group.sessions[0]?.title ?? group.sftpTabs[0]?.title ?? "SSH",
      subtitle: profile ? `${profile.username}@${profile.host}:${profile.port}` : isJumpServerSource(key) ? "经 KoKo · SSH 终端" : "",
      profile,
      ...group,
      status: group.sessions.length ? aggregateStatus(group.sessions) : null,
    };
  });
}

interface SessionTreeProps {
  remoteDesktops?: ReactNode;
  sessions: TerminalSession[];
  sftpTabs: SftpTab[];
  terminalNames: Record<string, string>;
  paneNames: Record<string, string>;
  paneLayouts: PaneLayout[];
  activeSessionId: string | null;
  activeSftpId: string | null;
  profiles: SshProfile[];
  onFocusTerminal: (sessionId: string) => void;
  onNewTerminal: (node: SessionNode) => void;
  onOpenSftp: (profile: SshProfile) => void;
  onOpenSshTerminal: (profile: SshProfile) => void;
  onFocusSftp: (tabId: string) => void;
  onCloseSftp: (tabId: string) => void;
  onOpenForward: (node: SessionNode) => void;
  onOpenFileList: (node: SessionNode) => void;
  onCloseSession: (sessionId: string) => void;
  onCloseTerminalWindow: (sessionId: string) => void;
  onRenameTerminal: (sessionId: string, name: string) => void;
  onRenamePane: (sessionId: string, name: string) => void;
  onDisconnectNode: (node: SessionNode) => void;
  onOpenConnections: () => void;
}

/** Live sessions only; the saved-connection library is opened via the footer. */
export function SessionTree({
  remoteDesktops,
  sessions,
  sftpTabs,
  terminalNames,
  paneNames,
  paneLayouts,
  activeSessionId,
  activeSftpId,
  profiles,
  onFocusTerminal,
  onNewTerminal,
  onOpenSftp,
  onOpenSshTerminal,
  onFocusSftp,
  onCloseSftp,
  onOpenForward,
  onOpenFileList,
  onCloseSession,
  onCloseTerminalWindow,
  onRenameTerminal,
  onRenamePane,
  onDisconnectNode,
  onOpenConnections,
}: SessionTreeProps) {
  const nodes = buildNodes(sessions, profiles, sftpTabs);
  const [expandedNodes, setExpandedNodes] = useState(new Map<string, boolean>());
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renamingPaneId, setRenamingPaneId] = useState<string | null>(null);
  const [paneRenameValue, setPaneRenameValue] = useState("");
  const paneLayoutBySession = useMemo(() => {
    const result = new Map<string, PaneLayout>();
    for (const layout of paneLayouts) {
      for (const sessionId of paneSessionIds(layout)) result.set(sessionId, layout);
    }
    return result;
  }, [paneLayouts]);

  function toggleNode(key: string, expand: boolean) {
    setExpandedNodes((current) => new Map(current).set(key, expand));
  }

  function beginRename(session: TerminalSession, index: number) {
    setRenamingSessionId(session.id);
    setRenameValue(terminalNames[session.id] ?? `终端 ${index + 1}`);
  }

  function finishRename(sessionId: string, originalName: string) {
    const name = renameValue.trim();
    if (name !== originalName) onRenameTerminal(sessionId, name);
    setRenamingSessionId(null);
  }

  function beginPaneRename(sessionId: string, index: number) {
    setRenamingPaneId(sessionId);
    setPaneRenameValue(paneNames[sessionId] ?? `Pane ${index + 1}`);
  }

  function finishPaneRename(sessionId: string, originalName: string) {
    const name = paneRenameValue.trim();
    if (name !== originalName) onRenamePane(sessionId, name);
    setRenamingPaneId(null);
  }

  return (
    <aside className="sidebar session-sidebar is-glass-chrome" aria-label="会话">
      <div className="sidebar__top">
        <SectionHeader title="会话" />
      </div>
      <div className="session-sidebar__sessions">
      {remoteDesktops}

      {nodes.length > 0 ? (
        <div className="session-tree" role="tree" aria-label="活动会话">
          <div className="session-tree__section-head"><span className="session-tree__eyebrow">活动会话</span><span className="session-tree__section-count">{nodes.length}</span></div>
          {nodes.map((node) => {
            const hasSftp = node.sftpTabs.length > 0;
            const hasTerminals = node.sessions.length > 0;
            const sshShortcutProfile = hasSftp && !node.sessions.some(isOpenSshTerminal) ? node.profile : null;
            const collapsed = !(expandedNodes.get(node.key) ?? hasSftp);
            const terminalWindows = node.sessions.filter((session) => {
              const layout = paneLayoutBySession.get(session.id);
              return !layout || layout.tabSessionId === session.id;
            });
            return (
              <div className="session-node session-node--terminal" key={node.key}
                data-active={activeSftpId
                  ? node.sftpTabs.some(tab => tab.id === activeSftpId)
                  : node.sessions.some(session => session.id === activeSessionId)}>
                <div className="session-node__row">
                  <button
                    className="session-node__disclosure"
                    aria-expanded={!collapsed}
                    onClick={() => toggleNode(node.key, collapsed)}
                    type="button"
                  >
                    <span className="session-node__host-icon">
                      <Icon
                        className={hasSftp && !hasTerminals ? "sftp-connection-icon" : undefined}
                        name={node.kind === "local" ? "terminalTool" : hasTerminals ? profileIconName(node.profile?.icon) : sftpConnectionIconName(node.profile?.icon)}
                        height="18"
                        width="18"
                      />
                      {node.status ? <span className="session-node__status" data-status={node.status} role="img" aria-label={STATUS_LABELS[node.status]} title={STATUS_LABELS[node.status]} /> : null}
                    </span>
                    <span className="session-node__label">
                      <span className="session-node__heading">
                        <span className="session-node__title" title={node.title}>{node.title}</span>
                        {hasTerminals ? <span className="session-node__count" title={`${terminalWindows.length} 个终端窗口`} aria-label={`${terminalWindows.length} 个终端窗口`}>{terminalWindows.length}</span> : null}
                        {hasSftp ? <span className="session-node__count" title={`${node.sftpTabs.length} 个 SFTP 标签`}>SFTP</span> : null}
                      </span>
                      {node.subtitle ? (
                        <ConnectionAddress address={node.subtitle} focusable={false} />
                      ) : null}
                    </span>
                    <span className="session-node__chevron" data-collapsed={collapsed}>
                      <Icon name="chevron-right" height="12" width="12" />
                    </span>
                  </button>
                </div>

                {collapsed ? null : (
                  <div className="session-node__children">
                    {hasTerminals || sshShortcutProfile ? <div className="session-node__tools" role="group" aria-label={`${node.title} 的快捷操作`}>
                      {sshShortcutProfile ? (
                        <button
                          className="session-child"
                          onClick={() => onOpenSshTerminal(sshShortcutProfile)}
                          type="button"
                        >
                          <Icon name="terminalTool" height="15" width="15" />
                          <span>打开 SSH 终端</span>
                        </button>
                      ) : null}
                      {hasTerminals ? <button
                        className="session-child"
                        onClick={() => onNewTerminal(node)}
                        type="button"
                      >
                        <Icon name="plus" height="15" width="15" />
                        <span>新建终端</span>
                      </button> : null}
                      {node.kind === "ssh" && node.profile && !hasSftp ? (
                        <button
                          className="session-child"
                          onClick={() => onOpenSftp(node.profile!)}
                          type="button"
                        >
                          <Icon name="serverFolder" height="16" width="16" />
                          <span>SFTP</span>
                        </button>
                      ) : null}
                      {hasTerminals && node.kind === "ssh" && node.profile ? (
                        <button
                          className="session-child"
                          onClick={() => onOpenForward(node)}
                          type="button"
                        >
                          <Icon name="forward" height="15" width="15" />
                          <span>端口转发</span>
                        </button>
                      ) : null}
                      {hasTerminals && (node.kind === "local" || (node.kind === "ssh" && node.profile)) ? (
                      <button
                        className="session-child"
                        onClick={() => onOpenFileList(node)}
                        type="button"
                      >
                        <Icon name="tree" height="15" width="15" />
                        <span>文件列表</span>
                      </button>
                      ) : null}

                    </div> : null}
                    {node.sftpTabs.map((tab) => (
                      <div className={`session-terminal${tab.id === activeSftpId ? " is-active" : ""}`} key={tab.id}>
                        <button
                          aria-current={tab.id === activeSftpId ? "page" : undefined}
                          className="session-terminal__open"
                          onClick={() => onFocusSftp(tab.id)}
                          title={`SFTP · ${tab.title}`}
                          type="button"
                        >
                          <Icon name="serverFolder" height="16" width="16" />
                          <span className="session-terminal__name">SFTP · {tab.title}</span>
                        </button>
                        <button
                          aria-label={`关闭 SFTP · ${tab.title}`}
                          className="session-terminal__close"
                          onClick={() => onCloseSftp(tab.id)}
                          title="关闭 SFTP"
                          type="button"
                        >
                          <Icon name="close" height="13" width="13" />
                        </button>
                      </div>
                    ))}
                    {hasTerminals ? <div className="session-node__terminal-heading"><span>终端窗口</span><span>{terminalWindows.length}</span></div> : null}

                    {terminalWindows.map((session, index) => {
                      const layout = paneLayoutBySession.get(session.id);
                      const paneIds = layout ? paneSessionIds(layout) : [];
                      const active = !activeSftpId && (session.id === activeSessionId || paneIds.includes(activeSessionId ?? ""));
                      const terminalName = terminalNames[session.id] ?? `终端 ${index + 1}`;
                      const isRenaming = renamingSessionId === session.id;
                      return (
                        <div className="session-terminal-group" key={session.id}>
                          <div className={`session-terminal ${active ? "is-active" : ""}`.trim()}>
                            {isRenaming ? (
                              <form
                                className="session-terminal__rename-form"
                                onSubmit={(event) => {
                                  event.preventDefault();
                                  finishRename(session.id, terminalName);
                                }}
                              >
                                <Icon name="terminalTool" height="15" width="15" />
                                <input
                                  aria-label="终端名称"
                                  autoFocus
                                  className="session-terminal__rename-input"
                                  onBlur={() => finishRename(session.id, terminalName)}
                                  onChange={(event) => setRenameValue(event.currentTarget.value)}
                                  onFocus={(event) => event.currentTarget.select()}
                                  onKeyDown={(event) => {
                                    if (event.key === "Escape") {
                                      event.preventDefault();
                                      setRenamingSessionId(null);
                                    }
                                  }}
                                  value={renameValue}
                                />
                              </form>
                            ) : (
                              <button
                                className="session-terminal__open"
                                aria-current={active ? "page" : undefined}
                                onClick={() => onFocusTerminal(layout?.focusedPaneId ?? session.id)}
                                onDoubleClick={() => beginRename(session, index)}
                                title={`${terminalName} · ${STATUS_LABELS[session.status]} · 双击重命名`}
                                type="button"
                              >
                                <Icon name="terminalTool" height="15" width="15" />
                                <span className="session-terminal__name">{terminalName}</span>
                                <span className="session-terminal__dot" data-status={session.status} />
                              </button>
                            )}
                            <button
                              aria-label="重命名终端"
                              className="session-terminal__rename"
                              onClick={() => beginRename(session, index)}
                              title="重命名"
                              type="button"
                            >
                              <Icon name="edit" height="13" width="13" />
                            </button>
                            <button
                              className="session-terminal__close"
                              aria-label="关闭终端"
                              onClick={() => layout ? onCloseTerminalWindow(layout.tabSessionId) : onCloseSession(session.id)}
                              title="关闭"
                              type="button"
                            >
                              <Icon name="close" height="13" width="13" />
                            </button>
                          </div>
                          {layout ? (
                            <div className="session-terminal__panes" role="group" aria-label={`${terminalName} 的窗格`}>
                              {paneIds.map((paneId, paneIndex) => {
                                const pane = node.sessions.find((item) => item.id === paneId);
                                if (!pane) return null;
                                const paneActive = !activeSftpId && paneId === activeSessionId;
                                const paneName = paneNames[paneId] ?? `Pane ${paneIndex + 1}`;
                                const isRenamingPane = renamingPaneId === paneId;
                                return (
                                  <div className={`session-pane ${paneActive ? "is-active" : ""}`.trim()} key={paneId}>
                                    {isRenamingPane ? (
                                      <form
                                        className="session-pane__rename-form"
                                        onSubmit={(event) => {
                                          event.preventDefault();
                                          finishPaneRename(paneId, paneName);
                                        }}
                                      >
                                        <Icon name="terminalTool" height="14" width="14" />
                                        <input
                                          aria-label="Pane 名称"
                                          autoFocus
                                          className="session-pane__rename-input"
                                          onBlur={() => finishPaneRename(paneId, paneName)}
                                          onChange={(event) => setPaneRenameValue(event.currentTarget.value)}
                                          onFocus={(event) => event.currentTarget.select()}
                                          onKeyDown={(event) => {
                                            if (event.key === "Escape") {
                                              event.preventDefault();
                                              setRenamingPaneId(null);
                                            }
                                          }}
                                          value={paneRenameValue}
                                        />
                                      </form>
                                    ) : (
                                      <button
                                        className="session-pane__open"
                                        aria-current={paneActive ? "page" : undefined}
                                        onClick={() => onFocusTerminal(paneId)}
                                        onDoubleClick={() => beginPaneRename(paneId, paneIndex)}
                                        title={`${paneName} · ${STATUS_LABELS[pane.status]} · 双击重命名`}
                                        type="button"
                                      >
                                        <Icon name="terminalTool" height="14" width="14" />
                                        <span>{paneName}</span>
                                        <span className="session-terminal__dot" data-status={pane.status} />
                                      </button>
                                    )}
                                    <button
                                      aria-label={`重命名 ${paneName}`}
                                      className="session-pane__rename"
                                      onClick={() => beginPaneRename(paneId, paneIndex)}
                                      title="重命名"
                                      type="button"
                                    >
                                      <Icon name="edit" height="12" width="12" />
                                    </button>
                                    <button
                                      aria-label={`关闭 ${paneName}`}
                                      className="session-pane__close"
                                      onClick={() => onCloseSession(paneId)}
                                      title="关闭 Pane"
                                      type="button"
                                    >
                                      <Icon name="close" height="12" width="12" />
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}

                    {hasTerminals ? <button
                      className="session-child session-child--danger"
                      onClick={() => onDisconnectNode(node)}
                      type="button"
                    >
                      <Icon name="unplug" height="15" width="15" />
                      <span>关闭会话</span>
                    </button> : null}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : remoteDesktops ? null : (
        <div className="session-tree session-tree--empty">
          <div className="session-tree__empty-content">
            <span className="session-tree__empty-icon"><Icon name="terminalTool" height="18" width="18" /></span>
            <p className="session-tree__empty-title">暂无活动会话</p>
            <p className="session-tree__empty-hint">连接服务器后，会话将在这里显示。</p>
            <button className="session-tree__empty-action" type="button" onClick={onOpenConnections}>
              <Icon name="connections" height="14" width="14" /><span>打开连接管理</span><Icon name="arrowRight" height="13" width="13" />
            </button>
          </div>
        </div>
      )}
      </div>

      {nodes.length > 0 || remoteDesktops ? <div className="session-sidebar__footer">
        <button className="session-sidebar__all" onClick={onOpenConnections} type="button">
          <Icon name="connections" height="14" width="14" />
          <span>全部连接</span>
          <Icon name="arrowRight" height="13" width="13" />
        </button>
      </div> : null}
    </aside>
  );
}
