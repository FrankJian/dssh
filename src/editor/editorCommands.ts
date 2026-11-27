export interface EditorTextCommand { id: string; label: string; category: "edit" | "selection" | "navigate" | "language"; core?: boolean; command?: boolean }
export const EDITOR_TEXT_COMMANDS: readonly EditorTextCommand[] = [
  { id: "undo", label: "撤销", category: "edit", core: true },
  { id: "redo", label: "重做", category: "edit", core: true },
  { id: "editor.action.clipboardCutAction", label: "剪切", category: "edit" },
  { id: "editor.action.clipboardCopyAction", label: "复制", category: "edit" },
  { id: "editor.action.clipboardPasteAction", label: "粘贴", category: "edit" },
  { id: "editor.action.selectAll", label: "全选", category: "selection" },
  { id: "editor.action.toggleColumnSelection", core: true, label: "切换列选择模式", category: "selection" },
  { id: "editor.action.insertCursorAbove", label: "在上方添加光标", category: "selection" },
  { id: "editor.action.insertCursorBelow", label: "在下方添加光标", category: "selection" },
  { id: "editor.action.addSelectionToNextFindMatch", label: "选择下一个匹配项", category: "selection" },
  { id: "editor.action.selectHighlights", label: "选择全部匹配项", category: "selection" },
  { id: "editor.action.moveLinesUpAction", label: "上移行", category: "edit" },
  { id: "editor.action.moveLinesDownAction", label: "下移行", category: "edit" },
  { id: "editor.action.copyLinesUpAction", label: "向上复制行", category: "edit" },
  { id: "editor.action.copyLinesDownAction", label: "向下复制行", category: "edit" },
  { id: "editor.action.deleteLines", label: "删除行", category: "edit" },
  { id: "editor.action.commentLine", label: "切换行注释", category: "edit" },
  { id: "editor.action.blockComment", label: "切换块注释", category: "edit" },
  { id: "editor.action.indentLines", label: "增加缩进", category: "edit" },
  { id: "editor.action.outdentLines", label: "减少缩进", category: "edit" },
  { id: "editor.foldAll", label: "全部折叠", category: "navigate" },
  { id: "editor.unfoldAll", label: "全部展开", category: "navigate" },
  { id: "editor.action.jumpToBracket", label: "跳转到匹配括号", category: "navigate" },
  { id: "editor.action.gotoLine", label: "转到行/列…", category: "navigate" },
  { id: "editor.action.quickOutline", label: "转到文档符号…", category: "language" },
  { id: "actions.find", label: "查找", category: "navigate" },
  { id: "editor.action.startFindReplaceAction", label: "替换", category: "navigate" },
  { id: "editor.action.triggerSuggest", label: "触发补全", category: "language" },
  { id: "editor.action.showHover", label: "显示悬浮信息", category: "language" },
  { id: "editor.action.revealDefinition", command: true, label: "转到定义", category: "language" },
  { id: "editor.action.rename", label: "重命名符号", category: "language" },
  { id: "editor.action.formatDocument", label: "格式化文档", category: "language" },
  { id: "editor.action.formatSelection", label: "格式化选区", category: "language" },
];

export function editorCommandSupported(command: EditorTextCommand, instance: import("monaco-editor").editor.IStandaloneCodeEditor | undefined): boolean {
  if (!instance) return false;
  if (command.command) {
    // Monaco registers definition navigation as a global Action2 command rather
    // than an editor action. Its local provider is shipped for JS/TS only.
    return ["javascript", "typescript"].includes(instance.getModel()?.getLanguageId() ?? "") && Boolean(instance.getAction("editor.action.quickOutline")?.isSupported());
  }
  return Boolean(command.core || instance.getAction(command.id)?.isSupported());
}
