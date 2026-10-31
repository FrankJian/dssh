import { useState } from "react";
import type { DockerSnapshot } from "../../models/serverSnapshot";
import { size } from "./formatSnapshot";

const stateLabels: Record<string, string> = { running: "运行中", exited: "已停止", created: "已创建", restarting: "重启中", paused: "已暂停", dead: "异常", removing: "移除中" };
const percentage = (n?: number) => n === undefined ? "—" : `${n.toFixed(1)}%`;
export function DockerSnapshotReport({ data: d }: { data: DockerSnapshot }) {
  const [showAll, setShowAll] = useState(false);
  if (d.state === "not_installed" || d.state === "not_probed") return null;
  if (d.state !== "running") return <section className="snapshot-section"><header><h3>Docker</h3><span>无法访问本机服务</span></header><p className="snapshot-footnote">Docker 服务未启动、不可达或当前 SSH 用户无访问权限。</p>{d.warning && <p className="snapshot-docker-warning">⚠ {d.warning}</p>}</section>;
  const active = d.containers.filter(c => !["exited", "created"].includes(c.state));
  const rows = showAll ? d.containers : active;
  return <section className="snapshot-section">
    <header><h3>Docker <span className="snapshot-muted">{d.version || "版本未知"}</span></h3><span className="snapshot-section-actions">本机服务{active.length < d.containers.length && <button className="button" type="button" aria-expanded={showAll} aria-controls="snapshot-container-table" onClick={() => setShowAll(!showAll)}>{showAll ? "仅显示活动容器" : `显示全部容器（${d.containers.length}）`}</button>}</span></header>
    <div className="snapshot-docker-summary"><span>运行 <strong>{d.running ?? "—"}</strong></span><span>暂停 <strong>{d.paused ?? "—"}</strong></span><span>已停止 <strong>{d.stopped ?? "—"}</strong></span><span>容器总数 <strong>{d.total ?? "—"}</strong></span><span>镜像 <strong>{d.images ?? "—"}</strong></span><span>存储驱动 {d.driver || "不可用"}</span></div>
    {d.warning && <p className="snapshot-docker-warning">⚠ {d.warning}</p>}
    <div className="snapshot-table-scroll" id="snapshot-container-table"><table className="snapshot-containers"><thead><tr><th scope="col">容器 / 镜像</th><th scope="col">状态</th><th scope="col" className="is-number">CPU</th><th scope="col" className="is-number">内存 / 限额</th><th scope="col">网络 I/O（收 / 发）</th><th scope="col">端口</th></tr></thead><tbody>
      {rows.map(c => <tr key={c.id} data-tone={/\bunhealthy\b/.test(c.status) || ["restarting", "dead"].includes(c.state) ? "warning" : "normal"}>
        <th scope="row"><span className="snapshot-path">{c.name}</span><small className="snapshot-muted snapshot-container-detail">{c.image || "镜像未知"} · {c.id}</small></th>
        <td><span className="snapshot-container-state">{(/\bunhealthy\b/.test(c.status) || ["restarting", "dead"].includes(c.state)) && "⚠ "}{stateLabels[c.state] || c.state || "未知"}</span><small className="snapshot-muted snapshot-container-detail">{c.status || "详细状态不可用"}</small></td>
        <td className="is-number">{percentage(c.cpu)}</td><td className="is-number">{size(c.memoryUsed)} / {size(c.memoryLimit)}<small className="snapshot-muted snapshot-container-detail">{percentage(c.memoryPercent)}</small></td>
        <td>{c.network || "—"}<small className="snapshot-muted snapshot-container-detail">磁盘 {c.block || "—"} · 进程/线程 {c.pids ?? "—"}</small></td><td className="snapshot-container-ports">{c.ports || "—"}</td>
      </tr>)}
    </tbody></table></div>
    {!rows.length && <p className="snapshot-empty">{d.containers.length ? "当前没有活动容器，可显示全部查看已停止的容器。" : d.total === 0 ? "当前没有容器。" : "未获取到容器列表。"}</p>}
    <p className="snapshot-footnote">资源为单次采样，CPU 可超过 100%；停止或刚启动的容器可能没有资源数据。网络与磁盘 I/O 为累计值。</p>
  </section>;
}
