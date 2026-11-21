interface Props { value: string; onChange: (value: string) => void; disabled?: boolean }

export function ConnectionFolderField({ value, onChange, disabled }: Props) {
  return <label className="field">
    <span>目录（可选）</span>
    <input aria-label="连接目录" placeholder="例如 production/asia/web" value={value} disabled={disabled}
      onChange={(event) => onChange(event.target.value)} spellCheck={false} />
  </label>;
}
