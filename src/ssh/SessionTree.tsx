import { useMemo, useState } from "react";
import type {
  KubernetesContextSelection,
  KubernetesProfile,
  SshProfile,
  TerminalSession,
} from "../models";
import type { SessionStatus } from "../models/terminal";
import { Icon } from "../ui/Icon";
import { SectionHeader } from "../ui/SectionHeader";
import { paneSessionIds, type PaneLayout } from "../terminal/usePaneLayout";

/** A live host in the active-session tree: a group of terminals sharing a target. */
export interface SessionNode {
  /** profileId for ssh nodes, "local" for the local-terminals group. */
  key: string;
  kind: "ssh" | "local";
  title: string;
  subtitle: string;
  profile: SshProfile | null;
  sessions: TerminalSession[];
  status: SessionStatus;
}

const LOCAL_KEY = "local";

function aggregateStatus(sessions: TerminalSession[]): SessionStatus {
  if (sessions.some((s) => s.status === "connected")) return "connected";
  if (sessions.some((s) => s.status === "connecting")) return "connecting";
  return sessions[0]?.status ?? "disconnected";
}

/** Group active terminal sessions into host nodes, preserving first-seen order. */
function buildNodes(sessions: TerminalSession[], profiles: SshProfile[]): SessionNode[] {
  const order: string[] = [];
  const byKey = new Map<string, TerminalSession[]>();
  for (const session of sessions) {
    const key = session.kind === "ssh" ? session.profileId : LOCAL_KEY;
    if (!byKey.has(key)) {
      byKey.set(key, []);
      order.push(key);
    }
    byKey.get(key)!.push(session);
  }

  return order.map((key) => {
    const nodeSessions = byKey.get(key)!;
    if (key === LOCAL_KEY) {
      return {
        key,
        kind: "local",
        title: "本地终端",
        subtitle: "",
        profile: null,
        sessions: nodeSessions,
        status: aggregateStatus(nodeSessions),
      };
    }
    const profile = profiles.find((p) => p.id === key) ?? null;
    return {
      key,
      kind: "ssh",
      title: profile?.name ?? nodeSessions[0]?.title ?? "SSH",
      subtitle: profile ? `${profile.username}@${profile.host}:${profile.port}` : "",
      profile,
      sessions: nodeSessions,
      status: aggregateStatus(nodeSessions),
    };
  });
}

interface SessionTreeProps {
  sessions: TerminalSession[];
  terminalNames: Record<string, string>;
  paneNames: Record<string, string>;
  paneLayouts: PaneLayout[];
  activeSessionId: string | null;
  isSftpActive: boolean;
  profiles: SshProfile[];
  kubernetesConnection: {
    profile: KubernetesProfile;
    context: KubernetesContextSelection;
  } | null;
  onFocusTerminal: (sessionId: string) => void;
  onNewTerminal: (node: SessionNode) => void;
  onOpenSftp: (profile: SshProfile) => void;
  onOpenForward: (node: SessionNode) => void;
  onOpenFileList: (node: SessionNode) => void;
  onCloseSession: (sessionId: string) => void;
  onCloseTerminalWindow: (sessionId: string) => void;
  onRenameTerminal: (sessionId: string, name: string) => void;
  onRenamePane: (sessionId: string, name: string) => void;
  onDisconnectNode: (node: SessionNode) => void;
  onConnectProfile: (profile: SshProfile) => void;
  onOpenConnections: () => void;
  onOpenKubernetes: () => void;
}

/**
 * The Sessions sidebar: an "active sessions" tree of live host nodes, plus a
 * compact Favorites quick-launch list. The full saved-connection library lives
 * in the Connections hub (Session Manager) — this sidebar only shows what's
 * running and a shortcut to favorites, so the two don't duplicate each other.
 */
export function SessionTree({
  sessions,
  terminalNames,
  paneNames,
  paneLayouts,
  activeSessionId,
  isSftpActive,
  profiles,
  kubernetesConnection,
  onFocusTerminal,
  onNewTerminal,
  onOpenSftp,
  onOpenForward,
  onOpenFileList,
  onCloseSession,
  onCloseTerminalWindow,
  onRenameTerminal,
  onRenamePane,
  onDisconnectNode,
  onConnectProfile,
  onOpenConnections,
  onOpenKubernetes,
}: SessionTreeProps) {
  const nodes = buildNodes(sessions, profiles);
  const favorites = profiles.filter((profile) => profile.favorite);
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(new Set());
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

  function toggleNode(key: string) {
    setCollapsedNodes((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function beginRename(session: TerminalSession, index: number) {
    setRenamingSessionId(session.id);
    setRenameValue(terminalNames[session.id] ?? `终端 ${index + 1}`);
  }

  function finishRename(sessionId: string) {
    onRenameTerminal(sessionId, renameValue.trim());
    setRenamingSessionId(null);
  }

  function beginPaneRename(sessionId: string, index: number) {
    setRenamingPaneId(sessionId);
    setPaneRenameValue(paneNames[sessionId] ?? `Pane ${index + 1}`);
  }

  function finishPaneRename(sessionId: string) {
    onRenamePane(sessionId, paneRenameValue.trim());
    setRenamingPaneId(null);
  }

  return (
    <aside className="sidebar session-sidebar" aria-label="会话">
      <div className="sidebar__top">
        <SectionHeader title="会话" />
      </div>

      {nodes.length > 0 || kubernetesConnection ? (
        <div className="session-tree" role="tree" aria-label="活动会话">
          <div className="session-tree__eyebrow">活动会话</div>
          {kubernetesConnection ? (() => {
            const nodeKey = `kubernetes:${kubernetesConnection.profile.id}`;
            const collapsed = collapsedNodes.has(nodeKey);
            return (
              <div className="session-node" key={nodeKey}>
                <div className="session-node__row">
                  <button
                    className="session-node__disclosure"
                    aria-expanded={!collapsed}
                    onClick={() => toggleNode(nodeKey)}
                    type="button"
                  >
                    <span className="session-node__chevron" data-collapsed={collapsed}>
                      <Icon name="chevron-right" height="14" width="14" />
                    </span>
                    <span className="session-node__status" data-status="connected" />
                    <span className="session-node__label">
                      <span className="session-node__title">{kubernetesConnection.profile.name}</span>
                      <span className="session-node__sub">Kubernetes · {kubernetesConnection.context.name}</span>
                    </span>
                    <span className="session-node__count">1</span>
                  </button>
                </div>
                {collapsed ? null : (
                  <div className="session-node__children">
                    <button className="session-child is-active" onClick={onOpenKubernetes} type="button">
                      <Icon name="database" height="15" width="15" />
                      <span>{kubernetesConnection.context.name}</span>
                    </button>
                  </div>
                )}
              </div>
            );
          })() : null}
          {nodes.map((node) => {
            const collapsed = collapsedNodes.has(node.key);
            const terminalWindows = node.sessions.filter((session) => {
              const layout = paneLayoutBySession.get(session.id);
              return !layout || layout.tabSessionId === session.id;
            });
            return (
              <div className="session-node" key={node.key}>
                <div className="session-node__row">
                  <button
                    className="session-node__disclosure"
                    aria-expanded={!collapsed}
                    onClick={() => toggleNode(node.key)}
                    type="button"
                  >
                    <span className="session-node__chevron" data-collapsed={collapsed}>
                      <Icon name="chevron-right" height="14" width="14" />
                    </span>
                    <span className="session-node__status" data-status={node.status} />
                    <span className="session-node__label">
                      <span className="session-node__title">{node.title}</span>
                      {node.subtitle ? (
                        <span className="session-node__sub">{node.subtitle}</span>
                      ) : null}
                    </span>
                    <span className="session-node__count">{terminalWindows.length}</span>
                  </button>
                </div>

                {collapsed ? null : (
                  <div className="session-node__children">
                    <button
                      className="session-child"
                      onClick={() => onNewTerminal(node)}
                      type="button"
                    >
                      <Icon name="plus" height="15" width="15" />
                      <span>新建终端</span>
                    </button>
                    {node.kind === "ssh" && node.profile ? (
                      <button
                        className="session-child"
                        onClick={() => onOpenSftp(node.profile!)}
                        type="button"
                      >
                        <Icon name="folder" height="15" width="15" />
                        <span>SFTP</span>
                      </button>
                    ) : null}
                    {node.kind === "ssh" ? (
                      <button
                        className="session-child"
                        onClick={() => onOpenForward(node)}
                        type="button"
                      >
                        <Icon name="forward" height="15" width="15" />
                        <span>端口转发</span>
                      </button>
                    ) : null}
                    {node.kind === "local" || (node.kind === "ssh" && node.profile) ? (
                    <button
                      className="session-child"
                      onClick={() => onOpenFileList(node)}
                      type="button"
                    >
                      <Icon name="tree" height="15" width="15" />
                      <span>文件列表</span>
                    </button>
                    ) : null}

                    <div className="session-child__sep" />

                    {terminalWindows.map((session, index) => {
                      const layout = paneLayoutBySession.get(session.id);
                      const paneIds = layout ? paneSessionIds(layout) : [];
                      const active = !isSftpActive && (session.id === activeSessionId || paneIds.includes(activeSessionId ?? ""));
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
                                  finishRename(session.id);
                                }}
                              >
                                <Icon name="terminalTool" height="15" width="15" />
                                <input
                                  aria-label="终端名称"
                                  autoFocus
                                  className="session-terminal__rename-input"
                                  onBlur={() => finishRename(session.id)}
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
                                onClick={() => onFocusTerminal(layout?.focusedPaneId ?? session.id)}
                                onDoubleClick={() => beginRename(session, index)}
                                title="双击重命名"
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
                                const paneActive = !isSftpActive && paneId === activeSessionId;
                                const paneName = paneNames[paneId] ?? `Pane ${paneIndex + 1}`;
                                const isRenamingPane = renamingPaneId === paneId;
                                return (
                                  <div className={`session-pane ${paneActive ? "is-active" : ""}`.trim()} key={paneId}>
                                    {isRenamingPane ? (
                                      <form
                                        className="session-pane__rename-form"
                                        onSubmit={(event) => {
                                          event.preventDefault();
                                          finishPaneRename(paneId);
                                        }}
                                      >
                                        <Icon name="terminalTool" height="14" width="14" />
                                        <input
                                          aria-label="Pane 名称"
                                          autoFocus
                                          className="session-pane__rename-input"
                                          onBlur={() => finishPaneRename(paneId)}
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
                                        onClick={() => onFocusTerminal(paneId)}
                                        onDoubleClick={() => beginPaneRename(paneId, paneIndex)}
                                        title="双击重命名"
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

                    <button
                      className="session-child session-child--danger"
                      onClick={() => onDisconnectNode(node)}
                      type="button"
                    >
                      <Icon name="unplug" height="15" width="15" />
                      <span>关闭会话</span>
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="session-tree session-tree--empty">
          <Icon name="sessions" height="24" width="24" />
          <p className="session-tree__empty-title">暂无活动会话</p>
          <p className="session-tree__empty-hint">从下方收藏或「连接管理」里连接一台主机。</p>
        </div>
      )}

      <div className="session-fav">
        <div className="session-fav__head">
          <span className="session-tree__eyebrow">收藏</span>
          <button className="session-fav__all" onClick={onOpenConnections} type="button">
            <span>全部连接</span>
            <Icon name="chevron-right" height="13" width="13" />
          </button>
        </div>
        {favorites.length > 0 ? (
          <div className="session-fav__list">
            {favorites.map((profile) => (
              <button
                className="session-fav__row"
                key={profile.id}
                onClick={() => onConnectProfile(profile)}
                title={`连接 ${profile.username}@${profile.host}:${profile.port}`}
                type="button"
              >
                <Icon name="ssh" height="15" width="15" />
                <span className="session-fav__name">{profile.name}</span>
                <Icon name="play" height="13" width="13" />
              </button>
            ))}
          </div>
        ) : (
          <p className="session-fav__hint">在「连接管理」里给常用连接点 ★，这里可快速启动。</p>
        )}
      </div>
    </aside>
  );
}
