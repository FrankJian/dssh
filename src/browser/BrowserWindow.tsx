import { useEffect, useRef, useState, type FormEvent } from "react";
import { browserAction, detachBrowserTab, mountBrowser, openBrowser, resizeBrowser, type BrowserTab } from "../services/browserService";
import { isMacOS } from "../platform";
import { useTheme } from "../theme/useTheme";
import { Icon } from "../ui/Icon";
import { IconButton } from "../ui/IconButton";
import { useBrowserTabs } from "./useBrowserTabs";
import "./browser.css";

export function BrowserWindow() {
  useTheme();
  const tabs = useBrowserTabs();
  return <div className="browser-native-window">
    {isMacOS ? <header className="browser-titlebar" data-tauri-drag-region>浏览器 · Duo SSH</header> : null}
    {tabs[0] ? <BrowserWorkspace key={tabs[0].id} tab={tabs[0]} visible /> : <p>正在移动浏览器页面…</p>}
  </div>;
}

// Native views sit above HTML. Hide them when inactive or covered by an HTML
// overlay; retain their process, history and DOM while other tabs are selected.
export function BrowserWorkspace({ tab, visible }: { tab: BrowserTab; visible: boolean }) {
  const [address, setAddress] = useState(tab.url);
  const [loading, setLoading] = useState(tab.loading);
  const [opened, setOpened] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(false);
  const ready = useRef(false);
  const region = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const syncRef = useRef<() => void>(() => {});
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  function bounds() {
    const rect = region.current!.getBoundingClientRect();
    return { x: Math.max(0, rect.x), y: Math.max(0, rect.y), width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
  }
  async function navigate(value: string, explicit = true) {
    setError(""); setLoading(true);
    mounted.current = true;
    try {
      await mountBrowser(tab.id, value, bounds(), explicit);
      ready.current = true;
      setOpened(true);
      syncRef.current();
    } catch (cause) {
      mounted.current = false;
      setError(cause instanceof Error ? cause.message : "打开网页失败。"); setLoading(false);
    }
  }
  useEffect(() => {
    if (tab.url && !mounted.current) void navigate(tab.url, false);
  }, [tab.id, tab.url]);
  useEffect(() => {
    setLoading(tab.loading);
    if (document.activeElement !== input.current) setAddress(tab.url);
  }, [tab.url, tab.loading]);

  useEffect(() => {
    let disposed = false;
    let pending = false;
    let dirty = false;
    let frame = 0;
    function covered() {
      if (!visibleRef.current || !region.current?.getClientRects().length) return true;
      const r = region.current.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return true;
      // Explicit modal/menu rectangles catch small floating overlays, including
      // ones which cover only a corner of the web content.
      for (const overlay of document.querySelectorAll<HTMLElement>('[role="dialog"], [role="menu"], [aria-modal="true"], .profile-editor-backdrop, .palette-backdrop, .app-lock-backdrop')) {
        const b = overlay.getBoundingClientRect();
        if (b.width && b.height && getComputedStyle(overlay).visibility !== "hidden" && b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top) return true;
      }
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return Boolean(top && !region.current.contains(top));
    }
    let last = "";
    async function sync() {
      if (disposed || !ready.current) return;
      if (pending) { dirty = true; return; }
      const geometry = bounds(); const show = !covered();
      const key = JSON.stringify([geometry, show]);
      if (key === last) return;
      pending = true;
      try { await resizeBrowser(tab.id, geometry, show); last = key; }
      catch { /* Ownership may have changed during detach/close. */ }
      finally { pending = false; if (dirty && !disposed) { dirty = false; void sync(); } }
    }
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => void sync()); };
    syncRef.current = schedule;
    const observer = new ResizeObserver(schedule);
    observer.observe(region.current!);
    const mutations = new MutationObserver(schedule);
    mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden", "open"] });
    window.addEventListener("resize", schedule);
    schedule();
    return () => {
      disposed = true; observer.disconnect(); mutations.disconnect(); cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      void resizeBrowser(tab.id, { x: 0, y: 0, width: 1, height: 1 }, false).catch(() => {});
    };
  }, [tab.id]);
  useEffect(() => { syncRef.current(); }, [visible, opened]);
  useEffect(() => {
    if (!loading) return;
    const timeout = window.setTimeout(() => { setLoading(false); setError("页面长时间未完成加载。可检查地址、SSH 转发或证书，然后刷新重试。"); }, 30000);
    return () => window.clearTimeout(timeout);
  }, [loading, tab.url]);

  async function action(value: "back" | "forward" | "reload" | "stop") {
    setError("");
    try { await browserAction(tab.id, value); if (value === "stop") setLoading(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "浏览器操作失败。"); }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!address.trim()) return;
    input.current?.blur();
    void navigate(address);
  }

  return <main className="browser-window" aria-label="内置浏览器">
    <form className="browser-toolbar" onSubmit={submit}>
      <IconButton disabled={!opened} label="后退" onClick={() => void action("back")}><Icon name="arrowLeft" /></IconButton>
      <IconButton disabled={!opened} label="前进" onClick={() => void action("forward")}><Icon name="arrowRight" /></IconButton>
      <IconButton disabled={!opened} label={loading ? "停止加载" : "刷新"} onClick={() => void action(loading ? "stop" : "reload")}><Icon name={loading ? "stop" : "refresh"} /></IconButton>
      <input ref={input} aria-label="网页地址" placeholder="https://example.com 或 http://127.0.0.1:8080" value={address} onChange={(event) => setAddress(event.target.value)} onFocus={(event) => event.currentTarget.select()} spellCheck={false} autoComplete="off" />
      <IconButton label="移至独立窗口" onClick={() => void detachBrowserTab(tab.id).catch((cause: Error) => setError(cause.message))}><Icon name="externalWindow" /></IconButton>
      <IconButton label="新建浏览器标签" onClick={() => void openBrowser().catch((cause: Error) => setError(cause.message))}><Icon name="plus" /></IconButton>
    </form>
    {error || loading ? <div className={`browser-status${error ? " browser-status--error" : ""}`} role={error ? "alert" : "status"}>
      {error || "正在加载…"}
    </div> : null}
    <div className="browser-content" ref={region}>
      {!opened ? (
        <div className="browser-empty" role="img" aria-label="浏览器空白页，请在地址栏输入网址">
          <Icon name="windowGlobe" className="browser-empty__watermark" aria-hidden="true" />
        </div>
      ) : null}
    </div>
  </main>;
}
