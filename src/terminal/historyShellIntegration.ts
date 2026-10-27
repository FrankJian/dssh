export type HistoryShell = "bash" | "zsh" | "fish" | "powershell" | "posix";

/** Installs reporting in the current Bash/Zsh process without changing rc files. */
export const historyShellIntegrationCommand = [
  ' if [ -n "${BASH_VERSION-}" ]; then',
  'if [ "${__dssh_history_enabled-}" != 1 ]; then',
  "__dssh_history_prompt() { local __dssh_status=$?; printf '\\033]633;D;%s\\007\\033]633;A\\007' \"$__dssh_status\"; return \"$__dssh_status\"; };",
  'case "$(declare -p PROMPT_COMMAND 2>/dev/null)" in',
  '"declare -a"*) PROMPT_COMMAND=(__dssh_history_prompt "${PROMPT_COMMAND[@]}");;',
  '*) PROMPT_COMMAND="__dssh_history_prompt${PROMPT_COMMAND:+; $PROMPT_COMMAND}";; esac;',
  '__dssh_history_enabled=1; fi;',
  "printf '\\033]633;DsshReady;bash\\007';",
  'elif [ -n "${ZSH_VERSION-}" ]; then',
  'if [ "${__dssh_history_enabled-}" != 1 ]; then',
  'if (( $+functions[precmd] )); then functions[__dssh_history_original_precmd]=$functions[precmd]; fi;',
  '__dssh_history_status() { return "$1"; };',
  "precmd() { local __dssh_status=$?; printf '\\033]633;D;%s\\007\\033]633;A\\007' \"$__dssh_status\"; if (( $+functions[__dssh_history_original_precmd] )); then __dssh_history_status \"$__dssh_status\"; __dssh_history_original_precmd; else return 0; fi; };",
  '__dssh_history_enabled=1; fi;',
  "printf '\\033]633;DsshReady;zsh\\007';",
  "else printf '\\033]633;DsshReady;unsupported\\007'; fi",
].join(" ");

const fishIntegration = [
  ' if not functions -q __dssh_history_postexec;',
  'function __dssh_history_postexec --on-event fish_postexec;',
  'set -l dssh_status $status;',
  "printf '\\033]633;D;%s\\007\\033]633;A\\007' $dssh_status;",
  'end; end;',
  "printf '\\033]633;DsshReady;fish\\007'",
].join(" ");

const powershellIntegration = [
  ' if ($null -eq (Get-Variable -Name __DsshHistoryOriginalPrompt -Scope Global -ErrorAction SilentlyContinue)) {',
  '$global:__DsshHistoryOriginalPrompt = $function:prompt;',
  'function global:prompt {',
  '$dsshSuccess = $?; $dsshNative = Get-Variable -Name LASTEXITCODE -Scope Global -ValueOnly -ErrorAction SilentlyContinue; $dsshCode = 0;',
  'if (-not $dsshSuccess) { $dsshCode = 1; if ($null -ne $dsshNative -and $dsshNative -ne 0) { $dsshCode = $dsshNative } };',
  '[Console]::Write(([char]27) + "]633;D;" + $dsshCode + ([char]7) + ([char]27) + "]633;A" + ([char]7));',
  '$global:LASTEXITCODE = $dsshNative; & $global:__DsshHistoryOriginalPrompt',
  '} };',
  '[Console]::Write(([char]27) + "]633;DsshReady;powershell" + ([char]7))',
].join(" ");

const posixIntegration = [
  ' if [ "${__dssh_history_enabled-}" != 1 ]; then',
  `PS1='$(printf "\\033]633;D;%s\\007\\033]633;A\\007" "$?")'"$PS1";`,
  '__dssh_history_enabled=1; fi;',
  "printf '\\033]633;DsshReady;posix\\007'",
].join(" ");

export function historyShellIntegrationFor(shell: HistoryShell): string {
  if (shell === "fish") return fishIntegration;
  if (shell === "powershell") return powershellIntegration;
  if (shell === "posix") return posixIntegration;
  return historyShellIntegrationCommand;
}

/** Setup echo can span arbitrary PTY chunks; only a real OSC acknowledgment completes it. */
export function readHistorySetupOutput(buffer: string): { shell: HistoryShell; output: string } | null {
  const match = /\x1b\]633;DsshReady;(bash|zsh|fish|powershell|posix)(?:\x07|\x1b\\)/.exec(buffer);
  return match ? { shell: match[1] as HistoryShell, output: buffer.slice(match.index + match[0].length) } : null;
}
