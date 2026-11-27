import { useEffect, useState } from "react";
import { ComboBox } from "../ui/ComboBox";

export const codeBlockLanguages = [
  ["", "纯文本"], ["bash", "Bash / Shell"], ["mermaid", "Mermaid"], ["yaml", "YAML"],
  ["json", "JSON"], ["typescript", "TypeScript"], ["javascript", "JavaScript"],
  ["python", "Python"], ["rust", "Rust"], ["go", "Go"], ["java", "Java"], ["c", "C"],
  ["cpp", "C++"], ["csharp", "C#"], ["sql", "SQL"], ["html", "HTML"], ["css", "CSS"],
  ["markdown", "Markdown"], ["toml", "TOML"], ["xml", "XML"], ["dockerfile", "Dockerfile"],
].map(([value, label]) => ({ value, label }));

export function CodeBlockLanguage({ language, disabled, onChange }: { language: string; disabled: boolean; onChange(language: string): void }) {
  const [query, setQuery] = useState(language);
  useEffect(() => setQuery(language), [language]);
  const options = codeBlockLanguages.some(option => option.value === language) ? codeBlockLanguages : [...codeBlockLanguages, { value: language, label: language }];
  return <ComboBox singleLabel emptyMessage="未找到匹配的语言" ariaLabel="代码块语言" value={query} options={options} placeholder="选择语言" disabled={disabled} onChange={setQuery}
    onSelect={value => { if (!disabled) onChange(value); }} />;
}
