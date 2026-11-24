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
import { getTerminalSuperKeyVisible, subscribeTerminalSuperKey } from '../settings/terminalSuperKeyStore';
import './commandOutput.css';

const noSubscribe = () => () => {};
const emptySnapshot = () => emptyCommandOutputs;
const time = (record: CommandOutputRecord) => new Date(record.startedAt).toLocaleTimeString();

interface CommandOutputToolsProps { sessionId: string; canEnableIntegration?: boolean }

export function CommandOutputTools(props: CommandOutputToolsProps) {
  const visible = useSyncExternalStore(subscribeTerminalSuperKey, getTerminalSuperKeyVisible);
  return visible ? <CommandOutputActions {...props} /> : null;
}

function CommandOutputActions({ sessionId, canEnableIntegration = false }: CommandOutputToolsProps) {
  const tracker = commandOutputTracker(sessionId);
  const records = useSyncExternalStore(tracker?.subscribe ?? noSubscribe, tracker?.snapshot ?? emptySnapshot);
  const integration = useSyncExternalStore(tracker?.subscribe ?? noSubscribe, tracker?.integrationSnapshot ?? (() => unknownCommandIntegration));
  const [installDialog, setInstallDialog] = useState(false);
  const [view, setView] = useState<'closed' | 'records'>('closed');
  const [expanded, setExpanded] = useState(false);
  const [preview, setPreview] = useState<CommandOutputRecord | null>(null);
  const [feedback, setFeedback] = useState<{ id: string; message: string; error: boolean } | null>(null);
  const [detail, setDetail] = useState<CommandOutputRecord | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 320, maxHeight: 400 });
  const trigger = useRef<HTMLButtonElement>(null);
  const copyTrigger = useRef<HTMLButtonElement>(null);
  const keyboardFocus = useRef(false);
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
      const width = Math.min(records.length ? 380 : 320, window.innerWidth - 16);
      const top = Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 100));
      setPosition({ left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)), top, width,
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
  }, [view, detail, installDialog, records.length]);

  async function copy(record: CommandOutputRecord) {
    if (!record.output) return;
    try {
      await navigator.clipboard.writeText(record.output);
      setFeedback({id: record.id, message: '已复制', error: false});
    } catch {
      setFeedback({id: record.id, message: '复制失败，请检查剪贴板权限后重试。', error: true});
      if (!detail) toast('复制失败，请检查剪贴板权限后重试。', 'error');
    }
  }
  function openRecords() {
    setView('records'); cancelPreview(); setPreview(null);
    requestAnimationFrame(() => panel.current?.querySelector<HTMLButtonElement>('button')?.focus());
  }
  return <div className="command-output-tools" ref={anchor} data-expanded={expanded}
    onPointerEnter={() => { keepOpen(); setExpanded(true); }}
    onPointerLeave={() => { if (!keyboardFocus.current) setExpanded(false); scheduleClose(); }}
    onFocus={event => { if (event.target.matches(':focus-visible')) { keyboardFocus.current = true; setExpanded(true); } }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) { keyboardFocus.current = false; setExpanded(false); } }}
    onPointerDown={() => { keyboardFocus.current = false; }}
    onMouseDown={event => event.stopPropagation()}
    onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); close(true); setExpanded(false); }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') { event.preventDefault(); keyboardFocus.current = true; setExpanded(true); requestAnimationFrame(() => copyTrigger.current?.focus()); }
      if (event.key === 'ArrowRight') { event.preventDefault(); trigger.current?.focus(); } }}>
    <button ref={trigger} type="button" className={`icon-button command-output-trigger${expanded || view !== 'closed' ? ' is-active' : ''}`} aria-label="终端超级键" title="终端超级键"
      aria-expanded={expanded} aria-controls={`${panelId}-actions`}
      onClick={() => { keepOpen(); setExpanded(true); }}><Icon name="zap" /></button>
    <div className="command-output-action-slot" id={`${panelId}-actions`} aria-hidden={!expanded}>
      <div className="command-output-action-slide">
        <button ref={copyTrigger} type="button" className="icon-button" aria-label="复制命令输出" title="复制命令输出"
          tabIndex={expanded ? 0 : -1} aria-haspopup="dialog" aria-controls={panelId} aria-expanded={view === 'records'}
          onClick={openRecords}><Icon name="copy" /></button>
      </div>
    </div>
    {view !== 'closed' && createPortal(<div ref={panel} id={panelId} role="dialog" aria-label="最近命令输出"
      className="command-output-panel is-glass-overlay command-output-panel--records" style={position}
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
      <>
        <header className="command-output-header"><div className="command-output-title"><Icon name="copy" /><strong>最近命令输出</strong>{records.length > 0 && <span className="command-output-count">{records.length}</span>}</div>{integration.state === 'ready' && <span className="command-integration-ready" role="status"><Icon name="check" />已启用</span>}<IconButton label="关闭命令列表" onClick={() => close(true)}><Icon name="close" /></IconButton></header>
        <div className="command-output-list">
          {integration.state !== 'ready' && <div className={`command-output-empty${integration.state === 'error' ? ' is-error' : ''}`}>
            <p role={integration.state === 'error' ? 'alert' : 'status'}><Icon name={integration.state === 'enabling' ? 'clock' : 'info'} /><span>{integration.state === 'enabling' ? '正在启用命令识别…' : integration.state === 'error' ? integration.message : '尚未启用命令识别'}</span></p>
            {canEnableIntegration && integration.state !== 'enabling' && <Button variant="ghost" className="command-output-enable" aria-label="启用本次会话的命令识别" data-integration-trigger onClick={() => { keepOpen(); cancelPreview(); setPreview(null); setInstallDialog(true); }}>启用识别<Icon name="arrowRight" /></Button>}
          </div>}
          {!records.length && integration.state === 'ready' && <div className="command-output-empty"><p><Icon name="terminalTool" /><span>暂无可复制的命令输出</span></p></div>}
          {records.map(record => <div key={record.id} className="command-output-row" onPointerEnter={() => showPreview(record)}
            onFocus={() => showPreview(record)}>
            <button type="button" className="command-output-record" aria-describedby={preview?.id === record.id ? previewId : undefined}
              onClick={event => { event.currentTarget.focus({ preventScroll: true }); cancelPreview(); keepOpen(); setFeedback(null); setPreview(null); setDetail(record); }}>
              <Icon name="terminalTool" /><span className="command-output-record-content"><code>{record.command}</code><span className="command-output-record-meta"><time>{time(record)}</time>{record.truncated && <span>输出已截断</span>}</span></span>
            </button>
            <IconButton className="command-output-copy" data-copied={feedback?.id === record.id && !feedback.error}
              label={`${feedback?.id === record.id && !feedback.error ? '已复制' : '复制输出'}：${record.command}`} disabled={!record.output}
              onClick={event => { event.currentTarget.focus({ preventScroll: true }); void copy(record); }}>
              <Icon name={feedback?.id === record.id && !feedback.error ? 'check' : 'copy'} />
              {feedback?.id === record.id && !feedback.error && <span>已复制</span>}
            </IconButton>
          </div>)}
        </div>
        {preview && <section id={previewId} className="command-output-preview" aria-label="输出预览" onPointerEnter={() => { keepOpen(); cancelPreview(); }}>
          <div className="command-output-preview-heading"><span>输出预览</span>{preview.truncated && <span>输出已截断</span>}</div><pre>{commandOutputPreview(preview.output) || '无输出'}</pre>
        </section>}
      </>
    </div>, document.body)}
    {installDialog && <ShellIntegrationDialog sessionId={sessionId} onClose={() => {
      setInstallDialog(false);
      requestAnimationFrame(() => (panel.current?.querySelector<HTMLButtonElement>('[data-integration-trigger]') ?? panel.current?.querySelector<HTMLButtonElement>('button') ?? trigger.current)?.focus());
    }} />}
    {detail && <Dialog title="命令输出" onClose={() => setDetail(null)} footer={<>
      <Button onClick={() => setDetail(null)}>关闭</Button>
      <Button variant="primary" disabled={!detail.output} onClick={() => void copy(detail)}>
        {feedback?.id === detail.id && !feedback.error ? '已复制' : '复制输出'}
      </Button>
    </>}>
      <div className="command-output-detail"><code>{detail.command}</code><time>{time(detail)}</time>
        {detail.truncated && <p role="status">输出已截断</p>}
        {feedback?.id === detail.id && feedback.error && <p role="alert">{feedback.message}</p>}
        <pre tabIndex={0}>{detail.output || '无输出'}</pre>
      </div>
    </Dialog>}
  </div>;
}
