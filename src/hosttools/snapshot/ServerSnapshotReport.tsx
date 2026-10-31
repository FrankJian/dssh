import { useState, type ReactNode } from "react";
import type { ServerSnapshot, SnapshotProcess } from "../../models/serverSnapshot";
import { size } from "./formatSnapshot";
import { isStorageDisk } from "./diskVisibility";
import { DockerSnapshotReport } from "./DockerSnapshotReport";

const percent = (value?: number) => value === undefined ? "不可用" : `${value.toFixed(1)}%`;
const ratio = (used?: number, total?: number) => used !== undefined && total !== undefined && total > 0 ? used / total * 100 : undefined;
type Tone = "normal" | "warning" | "danger";
const diskTone = (value?: number): Tone => value !== undefined && value >= 90 ? "danger" : value !== undefined && value >= 80 ? "warning" : "normal";

function Meter({ value, label, tone = "normal", max = 100 }: { value?: number; label: string; tone?: Tone; max?: number }) {
  if (value === undefined || !Number.isFinite(value) || max <= 0) return <span className="snapshot-unavailable">不可用</span>;
  return <div className="snapshot-meter" data-tone={tone} role="meter" aria-label={label}
    aria-valuemin={0} aria-valuemax={Math.max(max, value)} aria-valuenow={Math.max(0, value)} aria-valuetext={label}>
    <span style={{ width: `${Math.min(100, Math.max(0, value / max * 100))}%` }} />
  </div>;
}
function Section({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return <section className="snapshot-section"><header><h3>{title}</h3>{note && <span>{note}</span>}</header>{children}</section>;
}
function ProcessTable({ rows, metric }: { rows: SnapshotProcess[]; metric: "cpu" | "mem" }) {
  return <Section title={metric === "cpu" ? "CPU 进程 Top 5" : "内存进程 Top 5"}>
    <div className="snapshot-table-scroll"><table><thead><tr><th scope="col">进程</th><th scope="col">PID</th><th scope="col" className="is-number">占用</th></tr></thead>
      <tbody>{rows.map(p => <tr key={p.pid}><td className="snapshot-path">{p.name}</td><td className="snapshot-muted">{p.pid}</td><td className="is-number">{percent(p[metric])}</td></tr>)}</tbody>
    </table></div>{!rows.length && <p className="snapshot-empty">无法获取进程数据</p>}
  </Section>;
}

export function ServerSnapshotReport({ data: d }: { data: ServerSnapshot }) {
  const [showAllDisks, setShowAllDisks] = useState(false);
  const storageDisks = d.disks.filter(isStorageDisk);
  const visibleDisks = showAllDisks ? d.disks : storageDisks;
  const m = d.memory, memoryUsage = ratio(m.used, m.total), swapUsage = ratio(m.swapUsed, m.swap);
  const memoryLow = m.total !== undefined && m.total > 0 && m.available !== undefined && m.available / m.total < .1;
  const loadHigh = d.cores !== undefined && d.load.some(v => v !== undefined && v > d.cores!);
  const maxLoad = Math.max(d.cores ?? 1, ...d.load.map(v => v ?? 0), 1);
  return <div className="snapshot-report">
    <div className="snapshot-report__identity"><div><h2>{d.host}</h2><p>{d.os} · {d.arch}</p></div><span>{d.collectedAt} · 单次采样</span></div>
    <div className="snapshot-summary" data-tone={d.alerts.some(a => a.severity === "danger") ? "danger" : d.alerts.length ? "warning" : "normal"}>
      <strong>{d.alerts.length ? `⚠ ${d.alerts.length} 项需要关注` : "采集完成"}</strong>
      <span>{d.alerts.length ? d.alerts.slice(0, 3).map(a => a.message).join("；") + (d.alerts.length > 3 ? `；另 ${d.alerts.length - 3} 项，详见下方指标` : "") : "请结合采样时刻与业务负载判断；缺失指标标为不可用。"}</span>
    </div>
    <div className="snapshot-metrics">
      <div className="snapshot-metric"><span>CPU 使用率</span><strong>{percent(d.cpu?.[0])}</strong><Meter value={d.cpu?.[0]} label={`CPU 使用率 ${percent(d.cpu?.[0])}`} /><small>采样间隔 ≥1 秒 · 含 I/O 等待</small></div>
      <div className="snapshot-metric" data-tone={memoryLow ? "warning" : "normal"}><span>内存使用率</span><strong>{percent(memoryUsage)}{memoryLow && <em>可用偏低</em>}</strong><Meter value={memoryUsage} label={`内存使用率 ${percent(memoryUsage)}`} tone={memoryLow ? "warning" : "normal"} /><small>已用 {size(m.used)} / 总量 {size(m.total)}</small></div>
      <div className="snapshot-metric" data-tone={swapUsage !== undefined && swapUsage >= 50 ? "warning" : "normal"}><span>Swap 使用率</span><strong>{m.swap === 0 ? "未启用" : percent(swapUsage)}</strong>{m.swap === 0 ? <span className="snapshot-muted">未配置交换空间</span> : <Meter value={swapUsage} label={`Swap 使用率 ${percent(swapUsage)}`} tone={swapUsage !== undefined && swapUsage >= 50 ? "warning" : "normal"} />}<small>已用 {size(m.swapUsed)} / 总量 {size(m.swap)}</small></div>
      <div className="snapshot-metric" data-tone={loadHigh ? "warning" : "normal"}><span>1 分钟负载 / 逻辑核数</span><strong>{d.load[0]?.toFixed(2) ?? "不可用"}<small> / {d.cores ?? "—"} 核</small></strong><span className="snapshot-load-status">{loadHigh ? "⚠ 存在负载超过核数" : d.cores && d.load.every(v => v !== undefined) && d.load.length === 3 ? "各时段负载均未超过核数" : "部分数据不可用"}</span><small>含可运行任务与 I/O 等待任务</small></div>
    </div>
    <div className="snapshot-columns">
      <Section title="系统与资源" note="容量单位 GiB / MiB"><dl className="snapshot-facts">
        <dt>运行时间</dt><dd>{d.uptime}</dd><dt>内核</dt><dd>{d.kernel}</dd><dt>CPU</dt><dd>{d.cpuModel} · {d.cores ?? "—"} 逻辑核</dd>
        <dt>可用内存</dt><dd data-tone={memoryLow ? "warning" : "normal"}>{size(m.available)}{m.estimated ? "（估算）" : ""}</dd><dt>缓冲 / 缓存</dt><dd>{size(m.cache)}</dd>
      </dl></Section>
      <Section title="负载对比" note={`参考线：${d.cores ?? "未知"} 个逻辑核`}>
        <div className="snapshot-loads">{["1 分钟", "5 分钟", "15 分钟"].map((label, i) => <div className="snapshot-load" key={label}>
          <span>{label}</span><div className="snapshot-load__track"><Meter value={d.load[i]} max={maxLoad} label={`${label}负载 ${d.load[i]?.toFixed(2) ?? "不可用"}`} tone={d.cores && d.load[i] !== undefined && d.load[i]! > d.cores ? "warning" : "normal"} />{d.cores !== undefined && d.cores > 0 && <span className="snapshot-load__reference" style={{ left: `${d.cores / maxLoad * 100}%` }} />}</div><strong>{d.load[i]?.toFixed(2) ?? "—"}</strong>
        </div>)}</div>
        <div className="snapshot-cpu-parts">{["用户 us", "系统 sy", "等待 wa", "空闲 idle"].map((label, i) => <span key={label}>{label}<strong>{percent(d.cpu?.[i + 1])}</strong></span>)}</div>
      </Section>
    </div>
    <Section title={`磁盘与挂载 · ${visibleDisks.length}`} note={<span className="snapshot-section-actions">{showAllDisks ? "全部挂载（含虚拟文件系统）" : `存储挂载 / 全部 ${d.disks.length} 项`}{storageDisks.length < d.disks.length && <button className="button" type="button" aria-expanded={showAllDisks} aria-controls="snapshot-mount-table" onClick={() => setShowAllDisks(!showAllDisks)}>{showAllDisks ? "仅显示存储挂载" : `显示全部（${d.disks.length}）`}</button>}</span>}>
      <div className="snapshot-table-scroll" id="snapshot-mount-table"><table className="snapshot-disks" role="table"><colgroup><col className="snapshot-disk-col-mount" /><col className="snapshot-disk-col-type" /><col className="snapshot-disk-col-size" /><col className="snapshot-disk-col-size" /><col className="snapshot-disk-col-size" /><col className="snapshot-disk-col-usage" /><col className="snapshot-disk-col-state" /></colgroup><thead><tr><th scope="col">挂载点</th><th scope="col">类型</th><th scope="col" className="is-number">总量</th><th scope="col" className="is-number">已用</th><th scope="col" className="is-number">可用</th><th scope="col">使用率</th><th scope="col">状态</th></tr></thead>
        <tbody role="rowgroup">{visibleDisks.map((disk, i) => <tr role="row" key={`${disk.mount}-${i}`} data-tone={diskTone(disk.usage)}>
          <th scope="row" role="rowheader" className="snapshot-path snapshot-disk-mount"><span className="snapshot-cell-label" aria-hidden="true">挂载点</span>{disk.mount}</th>
          <td role="cell" className="snapshot-muted snapshot-disk-type"><span className="snapshot-cell-label" aria-hidden="true">类型</span>{disk.filesystem}</td>
          <td role="cell" className="is-number"><span className="snapshot-cell-label" aria-hidden="true">总量</span>{size(disk.total)}</td>
          <td role="cell" className="is-number"><span className="snapshot-cell-label" aria-hidden="true">已用</span>{size(disk.used)}</td>
          <td role="cell" className="is-number"><span className="snapshot-cell-label" aria-hidden="true">可用</span>{size(disk.available)}</td>
          <td role="cell" className="snapshot-disk-meter-cell"><span className="snapshot-cell-label" aria-hidden="true">使用率</span><div className="snapshot-disk-usage"><Meter value={disk.usage} label={`${disk.mount} 使用率 ${percent(disk.usage)}`} tone={diskTone(disk.usage)} /><strong>{percent(disk.usage)}</strong></div></td>
          <td role="cell" className="snapshot-disk-state"><span className="snapshot-cell-label" aria-hidden="true">状态</span>{disk.usage === undefined ? "不可用" : disk.usage >= 90 ? "⚠ 空间紧张" : disk.usage >= 80 ? "⚠ 使用偏高" : "未达阈值"}</td>
        </tr>)}</tbody>
      </table></div>{!visibleDisks.length && <p className="snapshot-empty">{d.disks.length ? "未检测到可确认容量的存储挂载，可显示全部查看其他挂载。" : "无法获取挂载数据"}</p>}
    </Section>
    <DockerSnapshotReport data={d.docker} />
    <div className="snapshot-columns"><ProcessTable rows={d.topCpu} metric="cpu" /><ProcessTable rows={d.topMemory} metric="mem" /></div>
    <p className="snapshot-footnote">进程 CPU 为 ps 统计值（通常为生命周期平均值），多线程进程可超过 100%。</p>
    <div className="snapshot-columns">
      <Section title={`登录会话 · ${d.users.length}`}><div className="snapshot-table-scroll"><table><thead><tr><th scope="col">用户</th><th scope="col">终端</th><th scope="col">来源</th></tr></thead><tbody>{d.users.map((u, i) => <tr key={i}><td>{u.user}</td><td>{u.terminal}</td><td className="snapshot-path">{u.source}</td></tr>)}</tbody></table></div>{!d.users.length && <p className="snapshot-empty">无会话或 who 不可用</p>}</Section>
      <Section title="网络地址" note={`TCP/UDP 监听套接字：${d.sockets ?? "不可用"}`}><div className="snapshot-table-scroll"><table><thead><tr><th scope="col">网卡</th><th scope="col">IP 地址</th></tr></thead><tbody>{d.addresses.map((ip, i) => <tr key={i}><td>{ip.interface}</td><td className="snapshot-path">{ip.address}</td></tr>)}</tbody></table></div>{!d.addresses.length && <p className="snapshot-empty">无法获取网络地址</p>}</Section>
    </div>
    <p className="snapshot-footnote">内存已用 = 总量 − available；负载超过核数不等同 CPU 过载。{d.source === "terminal" ? `通过当前交互终端采集 · ${d.targetLabel}；刷新固定绑定这次选择的资产。` : "只读采集 SSH 连接主机；检测到 JumpServer 时使用已选资产的原终端。"}</p>
  </div>;
}
