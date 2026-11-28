/** Production controls without IPC, user files, or remote commands. */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "../../src/ui/Button";
import { IconButton } from "../../src/ui/IconButton";
import { Icon } from "../../src/ui/Icon";
import { EditorActionMenu } from "../../src/editor/EditorActionMenu";
import { AiToolbarMenu } from "../../src/ai/AiToolbarMenu";
import { appPaletteTokens } from "../../src/theme/appPalette";
import "../../src/theme/global.css";
import "../../src/editor/editor.css";
const query = new URLSearchParams(location.search);
const theme = query.get("theme") === "dark" ? "dark" : "light";
document.documentElement.dataset.theme = theme;
if (query.get("color")) for (const [name, value] of Object.entries(appPaletteTokens(query.get("color")!, theme))) document.documentElement.style.setProperty(name, value);
function Fixture() {
  const [available, setAvailable] = useState(false), [last, setLast] = useState("无");
  const run = () => setLast("动作已执行");
  return <main style={{ padding: 20, display: "flex", flexDirection: "column", gap: 20, width: "100%", maxWidth: query.has("narrow") ? 360 : 1000 }}>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
      <Button onClick={run}>普通操作</Button><Button variant="primary" onClick={run}>主要操作</Button>
      <IconButton label="图标操作" onClick={run}><Icon name="plus" /></IconButton>
      <Button disabled>处理中表单按钮</Button><IconButton label="不可用图标" disabled><Icon name="save" /></IconButton>
      <Button onClick={() => setAvailable(value => !value)}>切换动作可用性</Button>
    </div>
    <nav role="toolbar" aria-label="测试工具栏" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      <Button onClick={run}>工具栏可用动作</Button><Button disabled={!available}>工具栏条件动作</Button>
      <EditorActionMenu label="测试动作菜单" items={() => [{ id: "open", label: "打开", section: "文件", run }, { id: "save", label: "条件保存", section: "保存", disabled: !available, run }]} />
      <EditorActionMenu label="空动作菜单" items={() => [{ id: "none", label: "不可用项", disabled: true, run }]} />
    </nav>
    <AiToolbarMenu position="right" onOpenConfig={() => setLast("配置已打开")} onRename={run} renameDisabled={!available} onClear={run} onDelete={run} sessionActionsDisabled={!available} />
    <div role="menu" aria-label="通用动作菜单"><button role="menuitem" disabled={!available}>通用条件动作</button><button role="menuitem" onClick={run}>通用可用动作</button></div>
    <label>文本输入<input aria-label="文本输入" /></label>
    <div className="pane-resizer" role="separator" aria-label="调整尺寸" style={{ height: 32 }} />
    <div className="editor-tree-row" role="treeitem" tabIndex={0}>可点击文件行</div>
    <div className="editor-file-tab" role="tab" tabIndex={0}>可点击文件标签</div>
    <div draggable="true" style={{ cursor: "grab" }}>拖拽目标</div>
    <output>{last}</output>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
