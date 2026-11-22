import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { toast } from '../ui/ToastHost';
import { commandOutputPreview, unknownCommandIntegration, type CommandOutputRecord } from './commandOutput';
import { commandOutputTracker, emptyCommandOutputs } from './commandOutputStore';
import { ShellIntegrationDialog } from './ShellIntegrationDialog';
import './commandOutput.css';

const noSubscribe = () => () => {};
const emptySnapshot = () => emptyCommandOutputs;
const time = (record: CommandOutputRecord) => new Date(record.startedAt).toLocaleTimeString();

export function CommandOutputTools({ sessionId, canEnableIntegration = false }: { sessionId: string; canEnableIntegration?: boolean }) {
  const tracker = commandOutputTracker(sessionId);
  const records = useSyncExternalStore(tracker?.subscribe ?? noSubscribe, tracker?.snapshot ?? emptySnapshot);
  const integration = useSyncExternalStore(tracker?.subscribe ?? noSubscribe, tracker?.integrationSnapshot ?? (() => unknownCommandIntegration));
  const [installDialog, setInstallDialog] = useState(false);
  const [view, setView] = useState<'closed' | 'tools' | 'records'>('closed');
  const [preview, setPreview] = useState<CommandOutputRecord | null>(null);
  const [feedback, setFeedback] = useState<{ id: string; message: string; error: boolean } | null>(null);
  const [detail, setDetail] = useState<CommandOutputRecord | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0, maxHeight: 400 });
  const trigger = useRef<HTMLButtonElement>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelId = useId();
  const previewId = useId();
  const cancelPreview = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  const keepOpen = () => { if (closeTimer.current) clearTimeout(closeTimer.current); closeTimer.current = null; };
  const close = (restore = false) => {
    cancelPreview(); keepOpen(); setPreview(null); setView('closed');
    if (restore) trigger.current?.focus();
  };
  const scheduleClose = () => {
    if (detail || installDialog) return;
    keepOpen(); closeTimer.current = setTimeout(() => {
      if (!panel.current?.contains(document.activeElement) && !anchor.current?.contains(document.activeElement)) close();
    }, 250);
  };
  const showPreview = (record: CommandOutputRecord) => {
    cancelPreview(); setPreview(null);
    timer.current = setTimeout(() => { setPreview(record); timer.current = null; }, 300);
  };
  useEffect(() => () => { cancelPreview(); keepOpen(); }, []);
  useEffect(() => {
    if (detail && !records.some(record => record.id === detail.id)) setDetail(null);
    if (preview && !records.some(record => record.id === preview.id)) setPreview(null);
  }, [records, detail, preview]);

  useLayoutEffect(() => {
    if (view === 'closed') return;
    const place = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(view === 'tools' ? 210 : 440, window.innerWidth - 16);
      const top = Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 100));
      setPosition({ left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)), top,
        maxHeight: Math.max(80, window.innerHeight - top - 8) });
    };
    place();
    const observer = new ResizeObserver(place);
    if (anchor.current) observer.observe(anchor.current);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    const outside = (event: PointerEvent) => {
      if (detail || installDialog) return;
      if (event.target instanceof Node && !anchor.current?.contains(event.target) && !panel.current?.contains(event.target)) close();
    };
    document.addEventListener('pointerdown', outside);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); document.removeEventListener('pointerdown', outside); };
  }, [view, detail, installDialog]);

  async function copy(record: CommandOutputRecord) {
    if (!record.output) return;
    try {
      await navigator.clipboard.writeText(record.output);
      setFeedback({id: record.id, message: '输出已复制', error: false});
      if (!detail) toast('输出已复制', 'success');
    } catch {
      setFeedback({id: record.id, message: '复制失败，请检查剪贴板权限后重试。', error: true});
      if (!detail) toast('复制失败，请检查剪贴板权限后重试。', 'error');
    }
  }
  function openRecords() {
    setView('records'); cancelPreview(); setPreview(null);
    requestAnimationFrame(() => panel.current?.querySelector<HTMLButtonElement>('button')?.focus());
  }
  return <div className="command-output-tools" ref={anchor} onPointerEnter={() => { keepOpen(); if (view === 'closed') setView('tools'); }}
    onPointerLeave={scheduleClose} onMouseDown={event => event.stopPropagation()}
    onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); close(true); }
      if (event.key === 'ArrowDown') { event.preventDefault(); panel.current?.querySelector<HTMLButtonElement>('button')?.focus(); } }}>
    <button ref={trigger} type="button" className="icon-button" aria-label="终端魔法工具" title="终端魔法工具"
      aria-expanded={view !== 'closed'} aria-controls={panelId} aria-haspopup="dialog"
      onFocus={() => { keepOpen(); if (view === 'closed') setView('tools'); }}
      onClick={() => { keepOpen(); setView('tools'); }}><Icon name="zap" /></button>
    {view !== 'closed' && createPortal(<div ref={panel} id={panelId} role="dialog" aria-label={view === 'tools' ? '终端魔法工具' : '最近命令输出'}
      className={`command-output-panel command-output-panel--${view}`} style={position}
      onPointerEnter={keepOpen} onPointerLeave={() => { cancelPreview(); setPreview(null); scheduleClose(); }}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) { cancelPreview(); setPreview(null); scheduleClose(); } }}
      onMouseDown={event => event.stopPropagation()} onKeyDown={event => {
        event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); close(true); }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          event.preventDefault(); buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus();
        }
      }}>
      {view === 'tools' ? <Button variant="ghost" onClick={openRecords}><Icon name="copy" />复制命令输出</Button> : <>
        <header><strong>最近命令输出</strong>{integration.state === 'ready' && <span className="command-integration-ready" role="status">已启用</span>}<IconButton label="关闭命令列表" onClick={() => close(true)}><Icon name="close" /></IconButton></header>
        <div className="command-output-list">
          {integration.state !== 'ready' && <div className="command-output-empty">
            <p role={integration.state === 'error' ? 'alert' : 'status'}>{integration.state === 'enabling' ? '正在启用命令识别…' : integration.state === 'error' ? integration.message : '尚未启用命令识别'}</p>
            {canEnableIntegration && integration.state !== 'enabling' && <Button data-integration-trigger onClick={() => { keepOpen(); cancelPreview(); setPreview(null); setInstallDialog(true); }}>启用本次会话的命令识别</Button>}
          </div>}
          {!records.length && integration.state === 'ready' && <p className="command-output-empty">暂无可复制的命令输出</p>}
          {records.map(record => <div key={record.id} className="command-output-row" onPointerEnter={() => showPreview(record)}
            onFocus={() => showPreview(record)}>
            <button type="button" className="command-output-record" aria-describedby={preview?.id === record.id ? previewId : undefined}
              onClick={event => { event.currentTarget.focus({ preventScroll: true }); cancelPreview(); keepOpen(); setFeedback(null); setPreview(null); setDetail(record); }}>
              <code>{record.command}</code><span><time>{time(record)}</time>{record.truncated && <span>输出已截断</span>}</span>
            </button>
            <IconButton label={`复制输出：${record.command}`} disabled={!record.output} onClick={() => void copy(record)}><Icon name="copy" /></IconButton>
          </div>)}
        </div>
        {preview && <section id={previewId} className="command-output-preview" aria-label="输出预览" onPointerEnter={() => { keepOpen(); cancelPreview(); }}>
          {preview.truncated && <span>输出已截断</span>}<pre>{commandOutputPreview(preview.output) || '无输出'}</pre>
        </section>}
      </>}
    </div>, document.body)}
    {installDialog && <ShellIntegrationDialog sessionId={sessionId} onClose={() => {
      setInstallDialog(false);
      requestAnimationFrame(() => (panel.current?.querySelector<HTMLButtonElement>('[data-integration-trigger]') ?? panel.current?.querySelector<HTMLButtonElement>('button') ?? trigger.current)?.focus());
    }} />}
    {detail && <Dialog title="命令输出" onClose={() => setDetail(null)} footer={<>
      <Button onClick={() => setDetail(null)}>关闭</Button>
      <Button variant="primary" disabled={!detail.output} onClick={() => void copy(detail)}>复制输出</Button>
    </>}>
      <div className="command-output-detail"><code>{detail.command}</code><time>{time(detail)}</time>
        {detail.truncated && <p role="status">输出已截断</p>}
        {feedback?.id === detail.id && <p role={feedback.error ? 'alert' : 'status'}>{feedback.message}</p>}
        <pre tabIndex={0}>{detail.output || '无输出'}</pre>
      </div>
    </Dialog>}
  </div>;
}
