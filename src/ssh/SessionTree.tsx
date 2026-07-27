import { useState } from "react";
import type { SshProfile, TerminalSession } from "../models";
import type { SessionStatus } from "../models/terminal";
import { Icon } from "../ui/Icon";
import { IconButton } from "../ui/IconButton";
import { SectionHeader } from "../ui/SectionHeader";

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
  activeSessionId: string | null;
  isSftpActive: boolean;
  profiles: SshProfile[];
  onFocusTerminal: (sessionId: string) => void;
  onNewTerminal: (node: SessionNode) => void;
  onOpenSftp: (profile: SshProfile) => void;
  onOpenForward: (node: SessionNode) => void;
  onCloseSession: (sessionId: string) => void;
  onDisconnectNode: (node: SessionNode) => void;
  onConnectProfile: (profile: SshProfile) => void;
  onCreateProfile: () => void;
  onOpenConnections: () => void;
}

/**
 * The Sessions sidebar: an "active sessions" tree of live host nodes, plus a
 * compact Favorites quick-launch list. The full saved-connection library lives
 * in the Connections hub (Session Manager) — this sidebar only shows what's
 * running and a shortcut to favorites, so the two don't duplicate each other.
 */
export function SessionTree({
  sessions,
  activeSessionId,
  isSftpActive,
  profiles,
  onFocusTerminal,
  onNewTerminal,
  onOpenSftp,
  onOpenForward,
  onCloseSession,
  onDisconnectNode,
  onConnectProfile,
  onCreateProfile,
  onOpenConnections,
}: SessionTreeProps) {
  const nodes = buildNodes(sessions, profiles);
  const favorites = profiles.filter((profile) => profile.favorite);
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(new Set());

  function toggleNode(key: string) {
    setCollapsedNodes((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <aside className="sidebar session-sidebar" aria-label="会话">
      <div className="sidebar__top">
        <SectionHeader title="会话" />
        <IconButton className="icon-button--primary" label="新建 SSH 配置" onClick={onCreateProfile}>
          <Icon name="plus" />
        </IconButton>
      </div>

      {nodes.length > 0 ? (
        <div className="session-tree" role="tree" aria-label="活动会话">
          <div className="session-tree__eyebrow">活动会话</div>
          {nodes.map((node) => {
            const collapsed = collapsedNodes.has(node.key);
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
                    <span className="session-node__count">{node.sessions.length}</span>
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

                    <div className="session-child__sep" />

                    {node.sessions.map((session, index) => {
                      const active = !isSftpActive && session.id === activeSessionId;
                      return (
                        <div
                          className={`session-terminal ${active ? "is-active" : ""}`.trim()}
                          key={session.id}
                        >
                          <button
                            className="session-terminal__open"
                            onClick={() => onFocusTerminal(session.id)}
                            type="button"
                          >
                            <Icon name="terminalTool" height="15" width="15" />
                            <span className="session-terminal__name">终端 {index + 1}</span>
                            <span className="session-terminal__dot" data-status={session.status} />
                          </button>
                          <button
                            className="session-terminal__close"
                            aria-label="关闭终端"
                            onClick={() => onCloseSession(session.id)}
                            title="关闭"
                            type="button"
                          >
                            <Icon name="close" height="13" width="13" />
                          </button>
                        </div>
                      );
                    })}

                    <button
                      className="session-child session-child--danger"
                      onClick={() => onDisconnectNode(node)}
                      type="button"
                    >
                      <Icon name="unplug" height="15" width="15" />
                      <span>断开</span>
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
