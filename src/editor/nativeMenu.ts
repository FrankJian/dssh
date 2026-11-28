import type { EditorMenuItem } from './EditorActionMenu';
import { getShortcutBinding, type ShortcutId } from '../app/shortcuts.ts';
import { isMacOS } from '../platform.ts';

export interface NativeEditorMenuItem { id: string; label: string; enabled: boolean; accelerator?: string; children?: NativeEditorMenuItem[] }
export interface NativeEditorMenuGroup { id: string; label: string; items: EditorMenuItem[] }
const bindings: Record<string, ShortcutId> = { new: 'editorNewFile', save: 'editorSave', saveAll: 'editorSaveAll', saveAs: 'editorSaveAs', close: 'editorCloseFile', quick: 'editorQuickOpen', 'editor.action.gotoLine': 'editorGoToLine', 'actions.find': 'editorFind', 'editor.action.startFindReplaceAction': 'editorReplace' };
function accelerator(id: string): string | undefined {
  const binding = bindings[id]; if (!binding) return;
  const key = getShortcutBinding(binding);
  return [key.primary ? isMacOS ? 'Cmd' : 'Ctrl' : '', key.alt ? 'Alt' : '', key.shift ? 'Shift' : '', key.key.length === 1 ? key.key.toUpperCase() : key.key].filter(Boolean).join('+');
}
export function nativeMenuModel(groups: NativeEditorMenuGroup[], blocked: boolean) {
  const actions = new Map<string, EditorMenuItem>();
  const menus: NativeEditorMenuItem[] = (blocked ? [] : groups).map(group => {
    const children: NativeEditorMenuItem[] = [];
    let section: NativeEditorMenuItem | undefined;
    group.items.forEach((item, index) => {
      if (item.disabled) return;
      if (/clipboard(?:Cut|Copy|Paste)Action/.test(item.id) || item.id === 'editor.action.selectAll') return;
      const id = `${group.id}/${index}/${item.id}`;
      actions.set(id, item);
      const entry = { id, label: Array.from(item.label).slice(0, 140).join(''), enabled: !blocked && !item.disabled, accelerator: accelerator(item.id) };
      if (item.section && ['项目文件', '行内格式', '区块', '文件比较', '正文显示', '选择'].includes(item.section)) {
        if (!section || section.label !== item.section) { section = { id: `${group.id}/section-${index}`, label: item.section, enabled: true, children: [] }; children.push(section); }
        section.children!.push(entry);
      } else { section = undefined; children.push(entry); }
    });
    return { id: group.id, label: group.label, enabled: true, children };
  }).filter(group => group.children.length > 0);
  return { menus, actions };
}
