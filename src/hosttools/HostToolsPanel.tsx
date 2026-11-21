import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { HostTool, HostToolsSnapshot } from "../models/hosttools";
import { hostToolsSnapshot } from "../services/hostToolsService";
import { Icon } from "../ui/Icon";
import type { IconName } from "../ui/Icon";
import { WorkspaceToolbar } from "../ui/WorkspaceToolbar";
import { IconButton } from "../ui/IconButton";
import { SelectMenu } from "../ui/SelectMenu";
import { SegmentedControl } from "../ui/SegmentedControl";

interface HostToolsPanelProps {
  /** SSH profile id of the active connection, or null when none / local. */
  profileId: string | null;
  /** Label of the connection the tools target, or null when none is active. */
  targetLabel: string | null;
  /** Closes the containing right dock. */
  onClose: () => void;
}

type RefreshInterval = 0 | 15 | 30 | 60;

const REFRESH_INTERVALS: { value: RefreshInterval; label: string }[] = [
  { value: 0, label: "不自动刷新" },
  { value: 15, label: "每 15 秒" },
  { value: 30, label: "每 30 秒" },
  { value: 60, label: "每分钟" },
];

const TOOLS: { id: HostTool; label: string; icon: IconName }[] = [
  { id: "monitor", label: "监控", icon: "gauge" },
  { id: "processes", label: "进程", icon: "connections" },
  { id: "services", label: "服务", icon: "toolbox" },
  { id: "logs", label: "日志", icon: "fileText" },
  { id: "ports", label: "端口", icon: "forward" },
];

/**
 * Right-panel Host Tools surface. Runs read-only SSH snapshots (monitor /
 * processes / services / logs / ports) scoped to the active connection and
 * renders them as structured tables, falling back to raw output when a parser
 * yields nothing.
 */
export function HostToolsPanel({ profileId, targetLabel, onClose }: HostToolsPanelProps) {
  const [tool, setTool] = useState<HostTool>("monitor");
  const [snapshot, setSnapshot] = useState<HostToolsSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshInterval, setRefreshInterval] = useState<RefreshInterval>(0);
  const loadInFlightRef = useRef(false);
  const queuedLoadRef = useRef(false);
  const latestLoadRef = useRef<() => Promise<void>>(null);
  const currentTargetRef = useRef({ profileId, tool });
  currentTargetRef.current = { profileId, tool };

  const load = useCallback(async () => {
    if (!profileId) {
      return;
    }
    if (loadInFlightRef.current) {
      queuedLoadRef.current = true;
      return;
    }
    loadInFlightRef.current = true;
    const requestedProfileId = profileId;
    const requestedTool = tool;
    const isCurrentTarget = () => currentTargetRef.current.profileId === requestedProfileId
      && currentTargetRef.current.tool === requestedTool;
    setIsLoading(true);
    setError(null);
    try {
      const result = await hostToolsSnapshot(profileId, tool);
      if (isCurrentTarget()) {
        setSnapshot(result);
      }
    } catch (err) {
      if (isCurrentTarget()) {
        setError(err instanceof Error ? err.message : "获取主机信息失败。");
        setSnapshot(null);
      }
    } finally {
      loadInFlightRef.current = false;
      setIsLoading(false);
      if (queuedLoadRef.current) {
        queuedLoadRef.current = false;
        void latestLoadRef.current?.();
      }
    }
  }, [profileId, tool]);

  latestLoadRef.current = load;

  useEffect(() => {
    setSnapshot(null);
    setError(null);
    void load();
  }, [load]);

  useEffect(() => {
    if (!profileId || refreshInterval === 0) {
      return;
    }
    const timer = window.setInterval(() => void load(), refreshInterval * 1_000);
    return () => window.clearInterval(timer);
  }, [load, profileId, refreshInterval]);

  return (
    <section className="host-tools" aria-label="主机工具">
      <WorkspaceToolbar label="主机工具" identity={<><Icon name="toolbox" width="18" height="18" /><strong>主机工具</strong></>}>
        <IconButton label="刷新主机信息" disabled={!profileId || isLoading} onClick={() => void load()}><Icon name="refresh" width="16" height="16" /></IconButton>
        <IconButton label="关闭主机工具" onClick={onClose}><Icon name="close" width="16" height="16" /></IconButton>
      </WorkspaceToolbar>
      <div className="host-tools__navigation">
        <div className="host-tools__scope">
          <span className="host-tools__target" title={targetLabel ?? undefined}>{targetLabel ?? "未连接主机"}</span>
          <SelectMenu ariaLabel="定时刷新频率" value={String(refreshInterval)}
            options={REFRESH_INTERVALS.map((interval) => ({ value: String(interval.value), label: interval.label }))}
            onChange={(value) => setRefreshInterval(Number(value) as RefreshInterval)} />
        </div>
        <SegmentedControl label="主机信息分类" value={tool} onChange={setTool} className="host-tools__categories"
          options={TOOLS.map((item) => ({ value: item.id, label: item.label,
            content: <><Icon name={item.icon} width="16" height="16" /><span>{item.label}</span></>,
          }))} />
      </div>

      <div className="host-tools__body" key={tool}>
        {!profileId ? (
          <div className="host-tools__empty">
            <Icon name="unplug" height="26" width="26" />
            <p className="host-tools__empty-title">未选择活动 SSH 连接</p>
            <p className="host-tools__empty-hint">本地终端不支持主机工具。</p>
          </div>
        ) : isLoading && !snapshot ? (
          <div className="host-tools__status">正在读取…</div>
        ) : error ? (
          <div className="host-tools__error">{error}</div>
        ) : snapshot ? (
          <>
            {snapshot.error ? <div className="host-tools__notice">{snapshot.error}</div> : null}
            <HostToolsContent snapshot={snapshot} />
          </>
        ) : null}
      </div>
    </section>
  );
}

function HostToolsContent({ snapshot }: { snapshot: HostToolsSnapshot }) {
  if (snapshot.tool === "monitor" && snapshot.monitor) {
    if (snapshot.monitor.length === 0) {
      return <RawBlock raw={snapshot.raw} />;
    }
    return (
      <div className="host-tools__metrics">
        {snapshot.monitor.map((metric) => (
          <div className="host-tools__metric" key={metric.label}>
            <span className="host-tools__metric-label">{metric.label}</span>
            <span className="host-tools__metric-value">{metric.value}</span>
          </div>
        ))}
      </div>
    );
  }

  if (snapshot.tool === "processes" && snapshot.processes) {
    if (snapshot.processes.length === 0) {
      return <RawBlock raw={snapshot.raw} />;
    }
    return (
      <div className="host-tools__table host-tools__table--proc">
        <div className="host-tools__thead">
          <span>PID</span>
          <span>用户</span>
          <span>CPU%</span>
          <span>内存%</span>
          <span>命令</span>
        </div>
        {snapshot.processes.map((row) => (
          <div className="host-tools__trow" key={`${row.pid}-${row.command}`}>
            <span className="host-tools__mono">{row.pid}</span>
            <span>{row.user}</span>
            <span className="host-tools__mono">{row.cpu}</span>
            <span className="host-tools__mono">{row.mem}</span>
            <span className="host-tools__ellipsis" title={row.command}>
              {row.command}
            </span>
          </div>
        ))}
      </div>
    );
  }

  if (snapshot.tool === "services" && snapshot.services) {
    if (snapshot.services.length === 0) {
      return <RawBlock raw={snapshot.raw} />;
    }
    return (
      <div className="host-tools__table host-tools__table--svc">
        <div className="host-tools__thead">
          <span>服务</span>
          <span>状态</span>
          <span>描述</span>
        </div>
        {snapshot.services.map((row) => (
          <div className="host-tools__trow" key={row.name}>
            <span className="host-tools__ellipsis" title={row.name}>
              {row.name}
            </span>
            <span
              className="host-tools__badge"
              data-active={row.active === "active" ? "true" : "false"}
            >
              {row.sub || row.active}
            </span>
            <span className="host-tools__ellipsis" title={row.description}>
              {row.description}
            </span>
          </div>
        ))}
      </div>
    );
  }

  if (snapshot.tool === "ports" && snapshot.ports) {
    if (snapshot.ports.length === 0) {
      return <RawBlock raw={snapshot.raw} />;
    }
    return (
      <div className="host-tools__table host-tools__table--port">
        <div className="host-tools__thead">
          <span>协议</span>
          <span>本地地址</span>
          <span>进程</span>
        </div>
        {snapshot.ports.map((row, index) => (
          <div className="host-tools__trow" key={`${row.local}-${index}`}>
            <span className="host-tools__mono">{row.proto}</span>
            <span className="host-tools__mono host-tools__ellipsis" title={row.local}>
              {row.local}
            </span>
            <span className="host-tools__ellipsis" title={row.process}>
              {row.process}
            </span>
          </div>
        ))}
      </div>
    );
  }

  if (snapshot.tool === "logs" && snapshot.logs) {
    if (snapshot.logs.length === 0) {
      return <RawBlock raw={snapshot.raw} />;
    }
    return <HostToolsLogs lines={snapshot.logs} />;
  }

  return <RawBlock raw={snapshot.raw} />;
}

function HostToolsLogs({ lines }: { lines: string[] }) {
  const logsRef = useRef<HTMLDivElement | null>(null);

  // A refreshed snapshot represents the newest tail of the remote log, so the
  // latest line should always be the visible anchor rather than the old scroll
  // position from the previous snapshot.
  useLayoutEffect(() => {
    const logs = logsRef.current;
    const scrollContainer = logs?.closest<HTMLElement>(".host-tools__body");
    const scrollToLatest = () => {
      if (scrollContainer) scrollContainer.scrollTop = scrollContainer.scrollHeight;
    };
    scrollToLatest();
    // The right dock can finish its flex layout after the snapshot commits.
    // Repeat on the next frame so the true content height is used on refresh.
    const frame = window.requestAnimationFrame(scrollToLatest);
    return () => window.cancelAnimationFrame(frame);
  }, [lines]);

  return (
    <div className="host-tools__logs" ref={logsRef}>
      {lines.map((line, index) => (
        <div className="host-tools__log-line" key={index}>
          {line}
        </div>
      ))}
    </div>
  );
}

function RawBlock({ raw }: { raw: string }) {
  if (!raw.trim()) {
    return <div className="host-tools__status">暂无数据。</div>;
  }
  return <pre className="host-tools__raw">{raw}</pre>;
}
