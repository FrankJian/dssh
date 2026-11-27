import { createRoot } from 'react-dom/client';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { Icon } from '../ui/Icon';
import { codeBlockLanguages } from './CodeBlockLanguage';

/** A transient view of a fence paragraph; source remains canonical until accepted. */
export function fenceLanguageCompletion(allowed: () => boolean, boundary: () => void) {
  let view: EditorView;
  let active = 0, dismissed = '', previous = '', destroyed = false;
  const popup = document.createElement('div');
  popup.className = 'context-menu is-glass-overlay editor-fence-completion';
  popup.setAttribute('role', 'listbox'); popup.setAttribute('aria-label', '代码围栏语言建议');
  popup.hidden = true;
  const root = createRoot(popup);
  const candidate = () => {
    if (!view || !allowed() || !view.editable || view.composing || !view.hasFocus() || document.querySelector('[aria-modal="true"]')) return null;
    const { $from, empty } = view.state.selection;
    if (!empty || $from.parent.type.name !== 'paragraph' || $from.parentOffset !== $from.parent.content.size) return null;
    const match = /^( {0,3})```([a-zA-Z0-9_+#.-]*)$/.exec($from.parent.textContent);
    if (!match) return null;
    const start = $from.before(), parent = view.state.doc.resolve(start);
    const type = view.state.schema.nodes.codeBlock;
    if (!type || !parent.parent.canReplaceWith(parent.index(), parent.index() + 1, type)) return null;
    return { start, end: $from.after(), anchor: $from.start() + match[1].length + 3, query: match[2], sourceKey: $from.parent.attrs.sourceKey };
  };
  const options = (query: string) => codeBlockLanguages.filter(item => !query || `${item.value} ${item.label}`.toLowerCase().includes(query.toLowerCase()));
  const hide = () => { popup.hidden = true; view?.dom.removeAttribute('aria-controls'); view?.dom.removeAttribute('aria-activedescendant'); };
  const accept = (value: string) => {
    const current = candidate(); if (!current || dismissed === `${current.start}:${current.query}`) return;
    boundary();
    const node = view.state.schema.nodes.codeBlock.create({ language: value || null, sourceKey: current.sourceKey });
    const transaction = view.state.tr.replaceWith(current.start, current.end, node);
    transaction.setSelection(TextSelection.near(transaction.doc.resolve(current.start + 1)));
    hide(); view.dispatch(transaction.scrollIntoView()); boundary(); view.focus();
  };
  const render = () => {
    if (destroyed) return;
    const current = candidate();
    if (!current) { previous = ''; dismissed = ''; hide(); return; }
    const signature = `${current.start}:${current.query}`;
    if (signature === dismissed) { hide(); return; }
    const items = options(current.query);
    if (!items.length) { hide(); return; }
    if (previous !== signature) active = 0;
    previous = signature; active = Math.min(active, items.length - 1);
    const caret = view.coordsAtPos(current.anchor);
    const viewport = view.dom.closest('.editor-rich-scroll')?.getBoundingClientRect();
    if (viewport && (caret.bottom < viewport.top || caret.top > viewport.bottom)) { hide(); return; }
    const width = Math.min(248, innerWidth - 16), height = Math.min(232, items.length * 32 + 8);
    popup.style.width = `${width}px`;
    popup.style.left = `${Math.max(8, Math.min(caret.left, innerWidth - width - 8))}px`;
    const below = innerHeight - caret.bottom - 12, above = caret.top - 12;
    const upwards = below < height && above > below;
    const available = Math.max(32, upwards ? above : below);
    popup.style.maxHeight = `${Math.min(232, available)}px`;
    popup.style.top = `${upwards ? Math.max(8, caret.top - Math.min(height, available) - 4) : caret.bottom + 4}px`;
    popup.hidden = false;
    view.dom.setAttribute('aria-controls', popup.id);
    view.dom.setAttribute('aria-activedescendant', `${popup.id}-${active}`);
    root.render(<>{items.map((item, index) => <button key={item.value} id={`${popup.id}-${index}`} type="button" role="option" aria-label={item.value || item.label} aria-selected={index === active}
      className={`context-menu__item${index === active ? ' is-active' : ''}`} onMouseDown={event => event.preventDefault()} onClick={() => accept(item.value)}>
      <Icon name={item.value === 'mermaid' ? 'tree' : 'code'} width="16" height="16" /><span>{item.value || item.label}</span>
    </button>)}</>);
    requestAnimationFrame(() => { if (!destroyed && !popup.hidden) popup.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); });
  };
  const dismiss = () => { const current = candidate(); dismissed = current ? `${current.start}:${current.query}` : previous; hide(); };
  const outside = (event: PointerEvent) => { if (event.target instanceof Node && !popup.contains(event.target) && !view.dom.contains(event.target)) dismiss(); };
  const key = new PluginKey('editor-fence-language');
  return new Plugin({
    key,
    props: {
      handleKeyDown(_view, event) {
        if (event.isComposing || view.composing || popup.hidden || !candidate()) return false;
        const items = options(candidate()!.query);
        if (event.key === 'Escape') { event.stopPropagation(); dismiss(); return true; }
        if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { active = (active + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length; render(); return true; }
        if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) { accept(items[active].value); return true; }
        return false;
      },
      handleDOMEvents: { compositionstart() { hide(); return false; }, compositionend() { queueMicrotask(render); return false; }, blur() { dismiss(); return false; }, focus() { queueMicrotask(render); return false; } },
    },
    view(editorView) {
      view = editorView; popup.id = `fence-language-${Math.random().toString(36).slice(2)}`; document.body.appendChild(popup);
      document.addEventListener('pointerdown', outside, true); window.addEventListener('resize', render); window.addEventListener('scroll', render, true);
      render();
      return { update() { render(); }, destroy() { destroyed = true; hide(); document.removeEventListener('pointerdown', outside, true); window.removeEventListener('resize', render); window.removeEventListener('scroll', render, true); popup.remove(); queueMicrotask(() => root.unmount()); } };
    },
  });
}
