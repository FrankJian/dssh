import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listScanInterfaces, startLanScan, cancelLanScan } from "../services/lanScanService";
import { copyToolText } from "../services/toolsService";
import type { AddressStatus, ScanInterface, ScanUpdate } from "../models/lanScan";
import { Button } from "../ui/Button";
import { Icon, type IconName } from "../ui/Icon";
import { SegmentedControl } from "../ui/SegmentedControl";
import { ToolAction, ToolFeedback, ToolPanel, ToolSelect } from "./ToolControls";
import { ADDRESS_LABELS, EMPTY_SCAN, applyScanUpdate, failScan } from "./lanScanState";

const statusIcons: Record<AddressStatus, IconName> = {
  occupied: "monitor", unresponsive: "check", unknown: "info", pending: "clock", scanning: "refresh", reserved: "lock", unfinished: "stop",
};
const filterOptions = [
  { value: "all", label: "全部地址" }, { value: "occupied", label: "检测到占用" },
  { value: "unresponsive", label: "未发现占用" }, { value: "unknown", label: "无法确认" },
  { value: "unfinished", label: "待扫描 / 未完成" }, { value: "reserved", label: "保留地址" },
];
const phases = { idle: "等待开始", starting: "准备探测", running: "扫描中", stopping: "正在停止", completed: "扫描完成", cancelled: "已停止", failed: "扫描失败" };

export default function IpScanTool() {
  const [mode, setMode] = useState("cidr");
  const [cidr, setCidr] = useState("");
  const [startIp, setStartIp] = useState("");
  const [endIp, setEndIp] = useState("");
  const [interfaces, setInterfaces] = useState<ScanInterface[]>([]);
  const [source, setSource] = useState("");
  const [view, setView] = useState(EMPTY_SCAN);
  const [filter, setFilter] = useState("all");
  const [resultView, setResultView] = useState("cards");
  const [selectedIp, setSelectedIp] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [loadingInterfaces, setLoadingInterfaces] = useState(false);
  const active = useRef<{ id: string; stop: boolean; cancelSent: boolean } | null>(null);
  const mounted = useRef(true);
  const refreshSequence = useRef(0);
  const busy = ["starting", "running", "stopping"].includes(view.phase);

  async function refreshInterfaces() {
    const sequence = ++refreshSequence.current;
    setLoadingInterfaces(true);
    setError("");
    try {
      const result = await listScanInterfaces();
      if (!mounted.current || sequence !== refreshSequence.current) return;
      setInterfaces(result);
      if (result[0]) setCidr((value) => value || `${result[0].address}/${Math.max(24, result[0].prefix)}`);
    } catch (failure) {
      if (mounted.current && sequence === refreshSequence.current) setError(failure instanceof Error ? failure.message : "无法读取网络接口。");
    } finally {
      if (mounted.current && sequence === refreshSequence.current) setLoadingInterfaces(false);
    }
  }

  useEffect(() => {
    mounted.current = true;
    if (isTauri()) void refreshInterfaces();
    return () => {
      mounted.current = false;
      refreshSequence.current++;
      const job = active.current;
      active.current = null;
      if (job) void cancelLanScan(job.id).catch(() => undefined);
    };
  }, []);

  async function sendCancel() {
    const job = active.current;
    if (!job || job.cancelSent) return;
    job.cancelSent = true;
    try {
      const found = await cancelLanScan(job.id);
      if (active.current === job && !found) job.cancelSent = false;
    } catch (failure) {
      if (mounted.current && active.current === job) {
        job.cancelSent = false;
        setError(failure instanceof Error ? failure.message : "停止失败，请重试。");
      }
    }
  }

  async function begin() {
    if (active.current) return;
    if (!isTauri()) { setError("请在 Duo SSH 桌面应用中运行本机网络检测。"); return; }
    const id = crypto.randomUUID();
    const job = { id, stop: false, cancelSent: false };
    active.current = job;
    setView({ ...EMPTY_SCAN, scanId: id, phase: "starting" });
    setFilter("all");
    setSelectedIp("");
    setError("");
    setStatus("");
    const receive = (update: ScanUpdate) => {
      if (!mounted.current || active.current !== job || update.scanId !== id) return;
      setView((current) => applyScanUpdate(current, update));
      if (job.stop && update.phase === "running") void sendCancel();
    };
    try {
      const request = { scanId: id, sourceAddress: source || undefined,
        ...(mode === "cidr" ? { cidr } : { startIp, endIp }) };
      const result = await startLanScan(request, receive);
      receive(result);
    } catch (failure) {
      if (mounted.current && active.current === job) {
        setView((current) => failScan(current));
        setError(failure instanceof Error ? failure.message : "扫描失败，请重试。");
      }
    } finally {
      if (active.current === job) active.current = null;
    }
  }

  function stop() {
    if (!active.current) return;
    active.current.stop = true;
    setView((current) => ({ ...current, phase: "stopping" }));
    void sendCancel();
  }

  function fillSubnet() {
    const candidate = interfaces.find((i) => i.address === source) ?? interfaces[0];
    if (!candidate) return;
    setMode("cidr");
    setCidr(`${candidate.address}/${Math.max(24, candidate.prefix)}`);
  }

  const counts = view.rows.reduce<Record<string, number>>((result, row) => {
    result[row.status] = (result[row.status] ?? 0) + 1;
    return result;
  }, {});
  const visible = view.rows.filter((row) => filter === "all" || row.status === filter ||
    (filter === "unfinished" && (row.status === "pending" || row.status === "scanning")));
  const selected = visible.find((row) => row.ip === selectedIp) ?? visible[0];

  function moveAddress(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const grid = event.currentTarget.parentElement!;
    const columns = getComputedStyle(grid).gridTemplateColumns.split(" ").length;
    const destinations: Record<string, number> = { ArrowLeft: index - 1, ArrowRight: index + 1, ArrowUp: index - columns, ArrowDown: index + columns, Home: 0, End: visible.length - 1 };
    const destination = destinations[event.key];
    if (destination === undefined) return;
    event.preventDefault();
    const next = Math.max(0, Math.min(destination, visible.length - 1));
    setSelectedIp(visible[next].ip);
    grid.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
  }

  async function copyAddress() {
    if (!selected) return;
    setStatus("");
    setError("");
    try { await copyToolText(selected.ip); setStatus(`已复制 ${selected.ip}`); }
    catch { setError("复制失败，请重试或手动选择 IP 地址复制。"); }
  }

  return (
    <div className="tool-form ip-scan">
      <div className="tool-form__toolbar ip-scan__toolbar">
        <fieldset className="ip-scan__inputs" disabled={busy}>
          <SegmentedControl label="地址输入方式" value={mode} onChange={setMode}
            options={[{ value: "cidr", label: "CIDR 网段" }, { value: "range", label: "起止地址" }]} />
          <div className="ip-scan__range">
            {mode === "cidr" ? <label className="field"><span>IPv4 网段</span>
              <input aria-label="IPv4 网段" placeholder="192.168.1.0/24" value={cidr} maxLength={64} onChange={(event) => setCidr(event.currentTarget.value)} />
            </label> : <>
              <label className="field"><span>起始 IPv4</span><input aria-label="起始 IPv4" placeholder="192.168.1.1" value={startIp} maxLength={32} onChange={(event) => setStartIp(event.currentTarget.value)} /></label>
              <label className="field"><span>结束 IPv4</span><input aria-label="结束 IPv4" placeholder="192.168.1.254" value={endIp} maxLength={32} onChange={(event) => setEndIp(event.currentTarget.value)} /></label>
            </>}
          </div>
          <ToolSelect label="来源接口" value={source} onChange={setSource} options={[
            { value: "", label: "系统路由（自动）" }, ...interfaces.map((i) => ({ value: i.address, label: `${i.name} · ${i.address}/${i.prefix}` })),
          ]} />
        </fieldset>
        <div className="ip-scan__actions">
          <ToolAction icon="refresh" label="刷新网络接口" variant="ghost" disabled={busy || loadingInterfaces} onClick={() => void refreshInterfaces()} />
          <ToolAction icon="fileInput" label="填入接口所在网段" variant="ghost" disabled={busy || !interfaces.length} onClick={fillSubnet} />
          {busy ? <Button variant="secondary" onClick={stop}><Icon name="stop" />{view.phase === "stopping" ? "重试停止" : "停止"}</Button>
            : <Button variant="primary" onClick={() => void begin()}><Icon name="play" />{view.rows.length ? "重新扫描" : "开始扫描"}</Button>}
        </div>
      </div>
      <ToolFeedback error={error} status={status} />
      <div className="ip-scan__overview">
      <div className="ip-scan__summary" role="status">
        <div className="ip-scan__phase"><strong>{phases[view.phase]}</strong>{view.range ? <code>{view.range}</code> : null}</div>
        <span className="ip-scan__count"><strong>{view.completed}</strong><span>/ {view.total}</span></span>
        <progress aria-label="扫描进度" value={view.completed} max={Math.max(1, view.total)} />
      </div>
      <div className="ip-scan__legend">
        <div className="ip-scan__metrics">{(["occupied", "unresponsive", "unknown"] as const).map((key) => <span key={key} data-status={key}><Icon name={statusIcons[key]} /><span>{ADDRESS_LABELS[key]}</span><strong>{counts[key] ?? 0}</strong></span>)}</div>
        <div className="ip-scan__view-controls">
          <SegmentedControl label="结果显示方式" value={resultView} onChange={setResultView}
            options={[{ value: "cards", label: "卡片视图" }, { value: "compact", label: "简洁视图" }]} />
          <ToolSelect label="筛选" value={filter} onChange={setFilter} options={filterOptions} />
        </div>
      </div>
      </div>
      <p className="ip-scan__notice"><Icon name="info" />绿色仅表示本次未发现占用。分配前请核对 DHCP 租约、保留地址及离线设备。</p>
      {view.rows.length ? <div className="ip-scan__results">
        <div className="ip-scan__grid" data-view={resultView} role="group" aria-label="IP 地址扫描结果">
          {visible.map((row, index) => <button key={row.ip} type="button" data-status={row.status}
            aria-pressed={selected?.ip === row.ip} tabIndex={selected?.ip === row.ip ? 0 : -1}
            aria-label={`${row.ip}，${ADDRESS_LABELS[row.status]}`} title={`${row.ip} · ${ADDRESS_LABELS[row.status]}\n${row.evidence}`}
            onClick={() => setSelectedIp(row.ip)} onKeyDown={(event) => moveAddress(event, index)}>
            {resultView === "compact" ? <span className="ip-scan__dot" aria-hidden="true" /> : <Icon name={statusIcons[row.status]} />}
            <code>{row.ip}</code>{resultView === "cards" ? <span>{ADDRESS_LABELS[row.status]}</span> : null}
          </button>)}
          {!visible.length ? <p>当前筛选没有匹配地址。</p> : null}
        </div>
        {selected ? <ToolPanel label="地址详情" actions={<ToolAction variant="ghost" icon="copy" label={`复制 ${selected.ip}`} onClick={() => void copyAddress()} />}>
          <div className="ip-scan__selected">
            <code>{selected.ip}</code>
            <span data-status={selected.status}><Icon name={statusIcons[selected.status]} />{ADDRESS_LABELS[selected.status]}</span>
          </div>
          <dl className="ip-scan__details">
            <div><dt>依据</dt><dd>{selected.evidence}</dd></div>
            <div><dt>来源</dt><dd>{selected.source ?? "—"}</dd></div>
            <div><dt>MAC</dt><dd><code>{selected.mac ?? "—"}</code></dd></div>
            <div><dt>响应耗时</dt><dd>{selected.responseMs === null ? "—" : `${selected.responseMs.toFixed(2)} ms`}</dd></div>
            <div><dt>检测时间</dt><dd>{selected.checkedAt === null ? "—" : new Date(selected.checkedAt).toLocaleString()}</dd></div>
          </dl>
        </ToolPanel> : null}
      </div> : <p className="ip-scan__empty">输入网段或地址范围后开始检测，每次最多 4096 个地址。</p>}
    </div>
  );
}
