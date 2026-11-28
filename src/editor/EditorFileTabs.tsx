import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';

export function EditorFileTabs({ activeId, itemsKey, label = '文件标签', children }: { activeId: string | null; itemsKey: string; label?: string; children: ReactNode }) {
  const viewport = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ overflow: false, left: false, right: false });
  function measure() {
    const element = viewport.current; if (!element) return;
    const max = element.scrollWidth - element.clientWidth;
    const next = { overflow: max > 1, left: element.scrollLeft > 1, right: element.scrollLeft < max - 1 };
    setEdges(previous => previous.overflow === next.overflow && previous.left === next.left && previous.right === next.right ? previous : next);
  }
  function reveal() {
    const element = viewport.current, tab = element?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (!element || !tab || !element.clientWidth) return;
    const bounds = element.getBoundingClientRect(), item = tab.getBoundingClientRect();
    if (item.left < bounds.left) element.scrollLeft += item.left - bounds.left;
    else if (item.right > bounds.right) element.scrollLeft += item.right - bounds.right;
    measure();
  }
  useLayoutEffect(() => {
    const element = viewport.current; if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      const before = element.scrollLeft;
      const delta = event.deltaY * (event.deltaMode === 1 ? 24 : event.deltaMode === 2 ? element.clientWidth : 1);
      element.scrollLeft += delta;
      if (before !== element.scrollLeft) event.preventDefault();
    };
    const observer = new ResizeObserver(reveal); observer.observe(element);
    const itemsObserver = new ResizeObserver(measure);
    for (const tab of element.children) itemsObserver.observe(tab);
    const focus = (event: FocusEvent) => { if (event.target instanceof Element && event.target.matches('[role="tab"][aria-selected="true"]')) reveal(); };
    element.addEventListener('focusin', focus); element.addEventListener('scroll', measure, { passive: true }); element.addEventListener('wheel', wheel, { passive: false });
    reveal();
    return () => { observer.disconnect(); itemsObserver.disconnect(); element.removeEventListener('focusin', focus); element.removeEventListener('scroll', measure); element.removeEventListener('wheel', wheel); };
  }, [activeId, itemsKey]);
  useLayoutEffect(reveal, [edges.overflow]);
  function scroll(direction: -1 | 1) {
    const element = viewport.current; if (!element) return;
    element.scrollBy({ left: direction * Math.max(120, element.clientWidth * .7), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  return <div className="editor-file-tabs-container">
    {edges.overflow ? <IconButton label={`向左滚动${label}`} disabled={!edges.left} className="editor-file-tabs__scroll" onClick={() => scroll(-1)}><Icon name="arrowLeft" width="14" height="14" /></IconButton> : null}
    <div className="editor-file-tabs" role="tablist" aria-label={label} ref={viewport}>{children}</div>
    {edges.overflow ? <IconButton label={`向右滚动${label}`} disabled={!edges.right} className="editor-file-tabs__scroll" onClick={() => scroll(1)}><Icon name="arrowRight" width="14" height="14" /></IconButton> : null}
  </div>;
}
