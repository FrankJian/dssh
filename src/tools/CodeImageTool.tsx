import { useState } from "react";
import { loadMonaco } from "../sftp/monacoLoader";
import { ImageExportTool } from "./TextImageTool";
import { ToolSelect, ToolSwitch } from "./ToolControls";
import { renderCodeImage, type CodeImageTheme } from "./codeImage";

const LANGUAGES = [
  { value: "javascript", label: "JavaScript", example: '// Read the current host\nconst host = "dev-server";\nconsole.log(`Connected to ${host}`);' },
  { value: "typescript", label: "TypeScript", example: 'type Host = { name: string; port: number };\nconst host: Host = { name: "dev", port: 22 };' },
  { value: "python", label: "Python", example: '# Print the current host\ndef connect(host: str, port: int = 22):\n    print(f"Connecting to {host}:{port}")' },
  { value: "shell", label: "Shell", example: '#!/bin/sh\nhost="dev-server"\nssh -p 22 "$host"' },
  { value: "json", label: "JSON", example: '{\n  "host": "dev",\n  "port": 22,\n  "enabled": true\n}' },
  { value: "yaml", label: "YAML", example: '# SSH configuration\nssh:\n  host: dev\n  port: 22' },
  { value: "sql", label: "SQL", example: "SELECT name, port\nFROM hosts\nWHERE environment = 'dev';" },
  { value: "rust", label: "Rust", example: 'fn main() {\n    let port: u16 = 22;\n    println!("Listening on {port}");\n}' },
  { value: "go", label: "Go", example: 'package main\n\nimport "fmt"\n\nfunc main() {\n    fmt.Println("Duo SSH")\n}' },
  { value: "html", label: "HTML", example: '<main class="host">\n  <h1>dev-server</h1>\n</main>' },
  { value: "css", label: "CSS", example: ".host {\n  display: grid;\n  gap: 12px;\n}" },
  { value: "plaintext", label: "纯文本", example: "Host dev-server\n  HostName 192.0.2.10\n  Port 22" },
] as const;

export default function CodeImageTool() {
  const [language, setLanguage] = useState<string>("javascript");
  const [theme, setTheme] = useState<CodeImageTheme>("dark");
  const [lineNumbers, setLineNumbers] = useState(true);
  const [title, setTitle] = useState("");
  const selected = LANGUAGES.find((item) => item.value === language) ?? LANGUAGES[0];

  return (
    <ImageExportTool
      inputLabel="代码输入"
      previewAlt="代码截图预览"
      example={selected.example}
      revision={JSON.stringify([language, theme, lineNumbers, title])}
      options={
        <>
          <ToolSelect label="语言" value={language} onChange={setLanguage} options={LANGUAGES} searchable />
          <ToolSelect label="主题" value={theme} onChange={(value) => setTheme(value === "light" ? "light" : "dark")}
            options={[{ value: "dark", label: "深色" }, { value: "light", label: "浅色" }]} />
          <ToolSwitch label="行号" checked={lineNumbers} onChange={setLineNumbers} />
          <label className="tool-form__setting">
            图片标题
            <input className="tool-form__title-input" type="text" value={title} maxLength={80} placeholder={selected.label}
              spellCheck={false} onChange={(event) => setTitle(event.target.value)} />
          </label>
        </>
      }
      render={(input) => renderCodeImage(input, {
        theme,
        lineNumbers,
        title: title.trim() || selected.label,
        tokenize: async (source) => {
          if (language === "plaintext") return [];
          const monaco = await loadMonaco();
          // Resolve the lazy language tokenizer before using the synchronous token API.
          await monaco.editor.colorize("", language, {});
          return monaco.editor.tokenize(source, language);
        },
      })}
    />
  );
}
