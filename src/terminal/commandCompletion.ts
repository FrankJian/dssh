export const commandCompletionEnabledKey = "dssh.terminal.commandCompletion.enabled";
const historyKey = "dssh.terminal.commandCompletion.history.v2";
// Old entries have no echo/provenance information: an arbitrary password is
// indistinguishable from a command. Discard that unverified store on upgrade.
try {
  localStorage.removeItem("dssh.terminal.commandCompletion.history.v1");
} catch {
  // Storage may be unavailable; never fall back to reading unverified entries.
}
const historyLimitKey = "dssh.terminal.commandCompletion.historyLimit";
export const COMMAND_HISTORY_DEFAULT_LIMIT = 300;
export const COMMAND_HISTORY_MIN_LIMIT = 1;
export const COMMAND_HISTORY_MAX_LIMIT = 5000;
const commandLimit = 500;
export const commandHistoryChangedEvent = "dssh:command-history-changed";
export const commandHistoryClearedEvent = "dssh:command-history-cleared";

export function clampCommandHistoryLimit(value: number): number {
  return Number.isFinite(value)
    ? Math.min(COMMAND_HISTORY_MAX_LIMIT, Math.max(COMMAND_HISTORY_MIN_LIMIT, Math.round(value)))
    : COMMAND_HISTORY_DEFAULT_LIMIT;
}

export function getCommandHistoryLimit(): number {
  const stored = localStorage.getItem(historyLimitKey);
  return stored === null || stored.trim() === ""
    ? COMMAND_HISTORY_DEFAULT_LIMIT
    : clampCommandHistoryLimit(Number(stored));
}

export function setCommandHistoryLimit(value: number): number {
  const limit = clampCommandHistoryLimit(value);
  localStorage.setItem(historyLimitKey, String(limit));
  // Persist the shorter list now, so increasing the limit later cannot bring
  // back commands that the user chose to discard.
  const history = loadHistory();
  localStorage.setItem(historyKey, JSON.stringify(history));
  window.dispatchEvent(new Event(commandHistoryChangedEvent));
  window.dispatchEvent(new Event("dssh:command-completion-settings"));
  return limit;
}

export function commandCompletionEnabled(): boolean {
  return localStorage.getItem(commandCompletionEnabledKey) === "true";
}

export function setCommandCompletionEnabled(enabled: boolean): void {
  localStorage.setItem(commandCompletionEnabledKey, String(enabled));
  window.dispatchEvent(new Event("dssh:command-completion-settings"));
}

function loadHistory(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(historyKey) ?? "[]");
    return Array.isArray(value)
      ? [...new Set(value.filter((item): item is string => typeof item === "string" && isRecordableCommand(item)))].slice(0, getCommandHistoryLimit())
      : [];
  } catch {
    return [];
  }
}

export function getCommandHistoryCount(): number {
  return loadHistory().length;
}

// Command lines can contain credentials. Only retain simple, visible shell
// input, and exclude common secret-bearing forms before writing localStorage.
export function isRecordableCommand(value: string): boolean {
  const command = value.trim();
  return command.length >= 1 && command.length <= commandLimit
    && !/[\r\n\x00-\x1f]/.test(command)
    && !/^\s/.test(value)
    && !/^[*•●]+$/.test(command)
    && !/(?:password|passwd|passphrase|token|secret|api[_-]?key|authorization|private[_-]?key)/i.test(command)
    && !/\b(?:export|set|setx|read|login|mysql|psql)\b/i.test(command);
}

export function recordCommand(value: string): void {
  if (!commandCompletionEnabled() || !isRecordableCommand(value)) return;
  const command = value.trimEnd();
  const history = loadHistory().filter((item) => item !== command);
  try {
    localStorage.setItem(historyKey, JSON.stringify([command, ...history].slice(0, getCommandHistoryLimit())));
    window.dispatchEvent(new Event(commandHistoryChangedEvent));
  } catch {
    // Storage may be full or unavailable. Completion remains usable this turn.
  }
}

export function clearCommandHistory(): void {
  localStorage.removeItem(historyKey);
  window.dispatchEvent(new Event(commandHistoryClearedEvent));
  window.dispatchEvent(new Event(commandHistoryChangedEvent));
  window.dispatchEvent(new Event("dssh:command-completion-settings"));
}

export function matchingCommands(prefix: string): string[] {
  if (!commandCompletionEnabled() || !prefix.trim() || prefix.length > commandLimit) return [];
  return loadHistory()
    .filter((command) => command.startsWith(prefix));
}

export class CommandInputTracker {
  line = "";
  atPrompt = false;
  private reliable = true;

  get canSuggest(): boolean {
    return this.atPrompt && this.reliable;
  }

  invalidateLine(): void {
    this.reliable = false;
  }

  reset(): void {
    this.line = "";
    this.atPrompt = false;
    this.reliable = true;
  }

  observe(data: string, visibleLine: string, renderedCommand?: string): string | null {
    // Check on every input event, including when a prompt arrives after the
    // user has started typing. Credential prompts are not limited to a bare
    // "Password:" (sudo, SSH keys, MFA, localization and masked input vary).
    if (/\b(?:password|passwd|passphrase|verification\s*code|one.time\s*(?:password|code)|otp|pin)\b|密码|口令|验证码/i.test(visibleLine)) {
      this.reset();
      return null;
    }
    // xterm wraps pasted text in these markers when the shell enables
    // bracketed paste. A single-line paste is still ordinary command input.
    if (data.startsWith("\x1b[200~") && data.endsWith("\x1b[201~")) {
      data = data.slice(6, -6);
      if (/[\r\n]/.test(data)) {
        this.reset();
        return null;
      }
    }
    if (!this.line && data && !this.atPrompt) {
      // Prompt formats vary; don't require a particular shell prompt suffix.
      this.atPrompt = true;
    }
    if (!this.atPrompt) return null;
    for (const char of data) {
      if (char === "\r" || char === "\n") {
        // Hidden/masked input must never be inferred from keystrokes alone.
        // Verify the PTY actually echoed the submitted text before saving it;
        // this also covers unknown/custom credential prompts and echo-off read.
        const echoed = renderedCommand?.trimEnd() ?? "";
        const submitted = this.reliable && echoed !== this.line.trimEnd() ? "" : echoed;
        this.reset();
        return isRecordableCommand(submitted) ? submitted : null;
      }
      if (char === "\x03") {
        this.reset();
        return null;
      }
      if (char === "\x15" || char === "\x1b" || char === "\t") {
        this.invalidateLine();
        return null;
      }
      if (!this.reliable) continue;
      if (char === "\x7f" || char === "\b") {
        this.line = this.line.slice(0, -1);
      } else if (char >= " " && char !== "\x7f") {
        this.line += char;
        if (this.line.length > commandLimit) this.reset();
      }
    }
    return null;
  }
}
