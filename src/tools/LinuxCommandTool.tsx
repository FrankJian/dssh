import { useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { copyToolText } from "../services/toolsService";
import { openTerminalLink } from "../services/terminalLinkService";
import { Icon } from "../ui/Icon";
import { SearchField } from "../ui/SearchField";
import { ToolAction, ToolFeedback, ToolNote, ToolPanel, ToolSelect } from "./ToolControls";
import { LINUX_COMMANDS, searchLinuxCommands } from "./linuxCommands";

const categories = [
  { value: "all", label: "全部分类" },
  ...[...new Set(LINUX_COMMANDS.map(({ category }) => category))].map((category) => ({ value: category, label: category })),
];

export default function LinuxCommandTool() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [selected, setSelected] = useState("ls");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const entries = searchLinuxCommands(query, category);
  const current = entries.find(({ name }) => name === selected) ?? entries[0];

  async function copy(command: string) {
    setStatus("");
    setError("");
    try {
      await copyToolText(command);
      setStatus(`已复制 ${command}`);
    } catch {
      setError("复制失败，请重试或手动选择示例复制。");
    }
  }

  return (
    <div className="tool-form linux-memo">
      <div className="tool-form__toolbar linux-memo__toolbar">
        <SearchField label="命令或参数" placeholder="例如 tail、--max-depth、监听端口"
          value={query} maxLength={256} onChange={(event) => setQuery(event.currentTarget.value)} />
        <ToolSelect label="分类" value={category} options={categories} onChange={setCategory} />
        <ToolNote>离线中文摘要，覆盖常用 GNU/Linux 工具、systemd 与 OpenSSH。参数随实现和版本有所差异，完整行为请查看对应手册或目标主机的 man 页面。</ToolNote>
      </div>
      {current ? (
        <div className="linux-memo__layout">
          <nav className="linux-memo__commands" aria-label="Linux 命令列表">
            {entries.map((entry) => (
              <button type="button" key={entry.name} aria-current={current.name === entry.name ? "true" : undefined}
                onClick={() => { setSelected(entry.name); setStatus(""); setError(""); }}>
                <code>{entry.name}</code><span>{entry.summary}</span>
              </button>
            ))}
          </nav>
          <div className="linux-memo__detail" key={current.name}>
            <section className="linux-memo__overview" aria-label={`${current.name} 用法概览`}>
              <header className="linux-memo__heading">
                <div><h3>{current.name}</h3><p>{current.summary}</p></div>
                <a className="icon-button" href={current.source.url} target="_blank" rel="noopener noreferrer"
                  aria-label={`查看 ${current.source.label} 中的 ${current.name} 手册`}
                  title={`${current.source.label} · ${current.name} 手册`}
                  onClick={(event) => {
                    if (!isTauri()) return;
                    event.preventDefault();
                    setError("");
                    void openTerminalLink(current.source.url).catch(() => setError("无法打开手册链接，请重试。"));
                  }}><Icon name="externalWindow" /></a>
              </header>
              <code className="linux-memo__syntax">{current.syntax}</code>
              {current.note ? <p className="linux-memo__note"><Icon name="info" />{current.note}</p> : null}
            </section>
            <ToolPanel label="常用参数" expandable>
              <dl className="linux-memo__parameters">
                {current.options.map(([flag, explanation]) => (
                  <div key={flag}><dt><code>{flag}</code></dt><dd>{explanation}</dd></div>
                ))}
              </dl>
            </ToolPanel>
            <ToolPanel label="使用示例">
              <div className="linux-memo__examples">
                {current.examples.map(([command, explanation]) => (
                  <div key={command}>
                    <div><code>{command}</code><p>{explanation}</p></div>
                    <ToolAction variant="ghost" label={`复制 ${command}`} icon="copy" onClick={() => void copy(command)} />
                  </div>
                ))}
              </div>
            </ToolPanel>
            <p className="linux-memo__source">{current.source.label}</p>
          </div>
        </div>
      ) : <p className="tools-workspace__empty" role="status">没有匹配的命令，请修改关键词或分类。</p>}
      <ToolFeedback error={error} status={status} />
    </div>
  );
}
