import { useCallback, useEffect, useState } from "react";
import type { HostTool, HostToolsSnapshot } from "../models/hosttools";
import { hostToolsSnapshot } from "../services/hostToolsService";
import { Icon } from "../ui/Icon";
import type { IconName } from "../ui/Icon";

interface HostToolsPanelProps {
  /** SSH profile id of the active connection, or null when none / local. */
  profileId: string | null;
  /** Label of the connection the tools target, or null when none is active. */
  targetLabel: string | null;
}

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
export function HostToolsPanel({ profileId, targetLabel }: HostToolsPanelProps) {
  const [tool, setTool] = useState<HostTool>("monitor");
  const [snapshot, setSnapshot] = useState<HostToolsSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!profileId) {
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const result = await hostToolsSnapshot(profileId, tool);
      setSnapshot(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "获取主机信息失败。");
      setSnapshot(null);
    } finally {
      setIsLoading(false);
    }
  }, [profileId, tool]);

  useEffect(() => {
    setSnapshot(null);
    void load();
  }, [load]);

  return (
    <section className="host-tools" aria-label="主机工具">
      <div className="host-tools__header">
        <div className="host-tools__title">
          <Icon name="toolbox" height="16" width="16" />
          主机工具
        </div>
        <div className="host-tools__head-actions">
          {targetLabel ? <span className="host-tools__target">{targetLabel}</span> : null}
          <button
            className="host-tools__refresh"
            onClick={() => void load()}
            disabled={!profileId || isLoading}
            title="刷新"
            aria-label="刷新"
            type="button"
          >
            <Icon name="refresh" height="15" width="15" />
          </button>
        </div>
      </div>

      <div className="host-tools__tabs" role="tablist">
        {TOOLS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`host-tools__tab ${tool === item.id ? "is-active" : ""}`.trim()}
            role="tab"
            aria-selected={tool === item.id}
            onClick={() => setTool(item.id)}
          >
            <Icon name={item.icon} height="15" width="15" />
            <span>{item.label}</span>
          </button>
        ))}
      </div>

      <div className="host-tools__body">
        {!profileId ? (
          <div className="host-tools__empty">
            <Icon name="unplug" height="26" width="26" />
            <p className="host-tools__empty-title">未选择活动 SSH 连接</p>
            <p className="host-tools__empty-hint">连接一台主机（本地终端不支持主机工具）后，这里会显示它的实时状态。</p>
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
    return (
      <div className="host-tools__logs">
        {snapshot.logs.map((line, index) => (
          <div className="host-tools__log-line" key={index}>
            {line}
          </div>
        ))}
      </div>
    );
  }

  return <RawBlock raw={snapshot.raw} />;
}

function RawBlock({ raw }: { raw: string }) {
  if (!raw.trim()) {
    return <div className="host-tools__status">暂无数据。</div>;
  }
  return <pre className="host-tools__raw">{raw}</pre>;
}
