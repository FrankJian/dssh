/** Session-only execution records. Never import persistence or transport here. */
export const COMMAND_OUTPUT_LIMIT = 1024 * 1024;
export const COMMAND_OUTPUT_COUNT = 20;
export interface CommandOutputRecord {
  id: string;
  sessionId: string;
  generation: number;
  sequence: number;
  command: string;
  startedAt: number;
  completedAt: number;
  output: string;
  truncated: boolean;
  exitCode?: number;
}

// Recognition is deliberately conservative; these are exclusion signals, not
// a claim that arbitrary terminal output can be automatically made secret-free.
const interaction = /password|passphrase|verification\s*code|one.time\s*(password|code)|\botp\b|密码|口令|验证码|\[y\/n\]|\(yes\/no\)|press .* (key|enter)|请输入|请选择/i;
const excluded = /(?:^|[\s;&|/])(?:vim?|nvim|nano|emacs|top|htop|less|more|ssh|sftp|telnet|su|bash|zsh|fish|sh|pwsh|powershell|read|select|login|mysql|psql|python[\d.]*|node)(?:\s|$)|password|passwd|passphrase|token|secret|api[_-]?key|authorization|private[_-]?key/i;
const encoder = new TextEncoder();

/** A bounded logical line, including CR/BS overwrite, with no screen wrapping. */
class TextCapture {
  private chunks: string[] = [];
  private block = '';
  private line = '';
  private cursor = 0;
  private bytes = 0;
  private lineBytes = 0;
  private frozen = false;
  private unsupportedRewrite = false;
  truncated = false;
  private tail = '';

  private limit: number;
  constructor(limit: number) { this.limit = limit; }

  write(text: string): boolean {
    const inspected = this.tail + text;
    if (interaction.test(inspected)) return false;
    this.tail = inspected.slice(-512);
    if (this.frozen) return true;
    if (this.unsupportedRewrite && text !== '\r' && text !== '\n') return false;
    if (this.cursor === this.line.length && !/[\r\n\b\t]/.test(text)) {
      const encoded = encoder.encode(text);
      const remaining = this.limit - this.bytes - this.lineBytes;
      if (encoded.length <= remaining) {
        this.line += text; this.lineBytes += encoded.length; this.cursor = this.line.length;
      } else {
        let end = remaining;
        while (end > 0 && (encoded[end] & 0xc0) === 0x80) end--;
        this.line += new TextDecoder().decode(encoded.subarray(0, end));
        this.lineBytes += end; this.cursor = this.line.length; this.freeze();
      }
      return true;
    }
    for (const char of text) {
      if (char === '\r') { this.unsupportedRewrite = /[^\x00-\x7f]/.test(this.line); this.cursor = 0; continue; }
      if (char === '\b') {
        if (/[^\x00-\x7f]/.test(this.line)) return false;
        const previous = this.line.charCodeAt(this.cursor - 1);
        this.cursor = Math.max(0, this.cursor - (previous >= 0xdc00 && previous <= 0xdfff ? 2 : 1)); continue;
      }
      if (this.frozen) continue;
      if (char === '\n') {
        if (this.bytes + this.lineBytes + 1 > this.limit) { this.freeze(); continue; }
        this.block += this.line + '\n';
        // Fixed-size committed blocks avoid both per-line objects and repeated
        // joins of the entire retained prefix during floods of short lines.
        if (this.block.length >= 16384) { this.chunks.push(this.block); this.block = ''; }
        this.bytes += this.lineBytes + 1;
        this.line = ''; this.lineBytes = 0; this.cursor = 0; this.unsupportedRewrite = false;
        continue;
      }
      const width = char === '\t' ? 8 - (this.cursor % 8) : 1;
      const value = char === '\t' ? ' '.repeat(width) : char;
      // Cursor indices use UTF-16, but never split a code point when advancing.
      const old = this.line.codePointAt(this.cursor);
      const oldWidth = old === undefined ? 0 : old > 0xffff ? 2 : 1;
      const next = this.line.slice(0, this.cursor) + value + this.line.slice(this.cursor + (char === '\t' ? width : oldWidth));
      const delta = encoder.encode(value).length - encoder.encode(this.line.slice(this.cursor, this.cursor + (char === '\t' ? width : oldWidth))).length;
      if (this.bytes + this.lineBytes + delta > this.limit) { this.freeze(); continue; }
      this.line = next; this.lineBytes += delta; this.cursor += value.length;
    }
    return true;
  }

  eraseLine(mode: string): boolean {
    if (this.frozen) return true;
    if (mode === '' || mode === '0') this.line = this.line.slice(0, this.cursor);
    else if (mode === '2' && !/[^\x00-\x7f]/.test(this.line)) { this.line = ' '.repeat(this.cursor); this.unsupportedRewrite = false; }
    else return false;
    this.lineBytes = encoder.encode(this.line).length;
    return true;
  }

  private freeze() { this.frozen = true; this.truncated = true; }
  text() { return this.chunks.join('') + this.block + this.line; }
}

export interface CommandIntegrationStatus {
  state: 'unknown' | 'enabling' | 'ready' | 'error';
  message?: string;
}

export const unknownCommandIntegration: CommandIntegrationStatus = Object.freeze({ state: 'unknown' });

type Phase = 'unknown' | 'prompt' | 'input' | 'running' | 'ended';
type ParseState = 'text' | 'escape' | 'csi' | 'osc' | 'oscEscape';

export class CommandOutputTracker {
  private phase: Phase = 'unknown';
  private parser: ParseState = 'text';
  private control = '';
  private echo = '';
  private echoValid = true;
  private submitted = false;
  private candidate: { command: string; startedAt: number; capture: TextCapture } | null = null;
  private records: readonly CommandOutputRecord[] = [];
  private sequence = 0;
  private generation = 0;
  private listeners = new Set<() => void>();
  private integration: CommandIntegrationStatus = unknownCommandIntegration;
  private replaying = false;
  private integrationTimer: ReturnType<typeof setTimeout> | null = null;
  integrationSnapshot = () => this.integration;
  private setIntegration(next: CommandIntegrationStatus) {
    if (this.replaying) return;
    if (this.integration.state === next.state && this.integration.message === next.message) return;
    if (this.integrationTimer) clearTimeout(this.integrationTimer);
    this.integrationTimer = null;
    this.integration = Object.freeze(next);
    this.notify();
  }
  beginIntegration() {
    this.invalidate();
    this.setIntegration({ state: 'enabling' });
    this.integrationTimer = setTimeout(() => this.failIntegration('未收到启用确认，请检查所选 shell 和终端提示后重试。'), 5000);
  }
  failIntegration(message: string) { this.setIntegration({ state: 'error', message }); }

  readonly sessionId: string;
  private limit: number;
  constructor(sessionId: string, limit = COMMAND_OUTPUT_LIMIT) { this.sessionId = sessionId; this.limit = limit; }

  importCompleted(records: CommandOutputRecord[]) {
    this.reset();
    this.records = records.slice(0, COMMAND_OUTPUT_COUNT).map(record => Object.freeze({ ...record }));
    this.generation = Math.max(0, ...this.records.map(record => record.generation));
    this.sequence = Math.max(0, ...this.records.map(record => record.sequence));
    this.notify();
  }
  snapshot = () => this.records;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private notify() { for (const listener of this.listeners) listener(); }

  /** Input is only a lifecycle signal. Command text comes exclusively from echo. */
  input(data: string) {
    if (this.phase === 'running' || this.phase === 'ended' || data.includes('\x03')) { this.invalidate(); return; }
    if (this.phase !== 'input') return;
    if ((data.match(/[\r\n]/g)?.length ?? 0) > 1 || /[\r\n].+/.test(data)) { this.invalidate(); return; }
    if (/[\r\n]/.test(data)) this.submitted = true;
  }

  invalidate() { this.candidate = null; this.echo = ''; this.phase = 'unknown'; this.submitted = false; }
  reset(clear = false) {
    this.invalidate(); this.parser = 'text'; this.control = '';
    if (clear) { this.generation++; this.records = []; this.setIntegration(unknownCommandIntegration); this.notify(); }
  }
  /** Replay can establish the current prompt, but never a submitted candidate. */
  restore(data = "") {
    this.reset(); this.replaying = true;
    try { this.output(data); } finally { this.replaying = false; }
  }

  output(data: string) {
    // Batch ordinary runs; parsing is independent of xterm rendering/ACK timing.
    const tokens = /[^\x00-\x1f\x7f]+|[\s\S]/gu;
    for (const match of data.matchAll(tokens)) {
      const token = match[0];
      if (this.parser === 'text') {
        if (token === '\x1b') { this.parser = 'escape'; continue; }
        if (token === '\x07') continue;
        if (token.length === 1 && token < ' ' && !['\r', '\n', '\t', '\b'].includes(token)) { this.invalidate(); continue; }
        this.text(token);
      } else {
        // Runs may contain an entire control string and subsequent normal text.
        for (const char of token) this.controlChar(char);
      }
    }
  }

  private text(text: string) {
    if (text === '\x07') return;
    if (/[\x00-\x07\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(text)) { this.invalidate(); return; }
    if (this.phase === 'input') {
      // The echoed Enter precedes OSC C. Do not include it in the command.
      if (text === '\r' || text === '\n') return;
      if (text === '\b') { this.echo = this.echo.slice(0, -1); return; }
      if (this.echo.length + text.length > 4096 || interaction.test(this.echo + text)) this.echoValid = false;
      else this.echo += text;
    } else if (this.phase === 'running' && this.candidate) {
      if (!this.candidate.capture.write(text)) this.invalidate();
    }
  }

  private controlChar(char: string) {
    if (this.parser === 'text') {
      if (char === '\x1b') this.parser = 'escape';
      else this.text(char);
      return;
    }
    if (this.parser === 'escape') {
      this.control = '';
      if (char === '[') this.parser = 'csi';
      else if (char === ']') this.parser = 'osc';
      else { this.invalidate(); this.parser = 'text'; }
      return;
    }
    if (this.parser === 'oscEscape') {
      if (char === '\\') this.finishOsc();
      else { this.invalidate(); this.parser = 'text'; }
      return;
    }
    if (this.parser === 'osc') {
      if (char === '\x07') { this.finishOsc(); return; }
      if (char === '\x1b') { this.parser = 'oscEscape'; return; }
    } else if (this.parser === 'csi' && char >= '@' && char <= '~') {
      const value = this.control; this.parser = 'text'; this.control = '';
      if (char === 'm' && /^[\d;:]*$/.test(value)) return;
      // Shell readline/ZLE toggles bracketed paste around each command. This
      // mode changes input framing, not printable output or screen ownership.
      if ((char === 'h' || char === 'l') && value === '?2004') return;
      if (char === 'K' && (value === '' || value === '0') && this.phase === 'input') return;
      if (this.phase === 'running' && char === 'K' && this.candidate?.capture.eraseLine(value)) return;
      this.invalidate(); return;
    }
    if (this.control.length >= 4096) { this.invalidate(); this.parser = 'text'; this.control = ''; }
    else this.control += char;
  }

  private finishOsc() {
    const value = this.control; this.control = ''; this.parser = 'text';
    if (value.startsWith('133;DuoSshIntegration;')) {
      const result = value.slice('133;DuoSshIntegration;'.length);
      if (result === 'ready') this.setIntegration({ state: 'ready' });
      else if (result === 'unsupported') this.failIntegration('所选 shell 与当前会话不匹配，请选择当前使用的 Bash 或 Zsh。');
      else if (result === 'conflict') this.failIntegration('当前 shell 存在冲突的 hook 或只读配置，未启用临时识别。');
      return;
    }
    const marker = /^133;([ABCD])(?:;(.*))?$/.exec(value);
    if (!marker) {
      // Title and hyperlink metadata do not contribute printable output.
      if (!/^(?:0|1|2|7|8);/.test(value)) this.invalidate();
      return;
    }
    switch (marker[1]) {
      case 'A':
        this.invalidate(); this.phase = 'prompt'; break;
      case 'B':
        if (this.phase !== 'prompt') { this.invalidate(); break; }
        this.phase = 'input'; this.echo = ''; this.echoValid = true; this.submitted = false;
        this.setIntegration({ state: 'ready' }); break;
      case 'C': {
        const command = this.echo.trimEnd();
        const valid = this.phase === 'input' && this.submitted && this.echoValid && !!command.trim()
          && !/^\s/.test(command) && !/[\x00-\x1f\x7f-\x9f]/.test(command) && !excluded.test(command);
        this.echo = '';
        this.candidate = valid ? { command, startedAt: Date.now(), capture: new TextCapture(this.limit) } : null;
        this.phase = 'running'; break;
      }
      case 'D': {
        if (this.phase === 'running' && this.candidate) {
          const c = this.candidate;
          const parsedExit = /^\d+$/.test(marker[2] ?? '') ? Number(marker[2]) : NaN;
          const exitCode = Number.isSafeInteger(parsedExit) && parsedExit <= 0xffffffff ? parsedExit : undefined;
          const sequence = ++this.sequence;
          this.records = [Object.freeze({ id: `${this.generation}:${sequence}`, sessionId: this.sessionId,
            generation: this.generation, sequence, command: c.command, startedAt: c.startedAt,
            completedAt: Date.now(), output: c.capture.text(), truncated: c.capture.truncated,
            ...(exitCode === undefined ? {} : { exitCode }) }), ...this.records].slice(0, COMMAND_OUTPUT_COUNT);
          this.notify();
        }
        this.candidate = null; this.phase = 'ended'; break;
      }
    }
  }
}

export function commandOutputPreview(output: string): string {
  // Slice before splitting: preview allocation is independent of output length.
  return output.slice(0, 4096).split('\n').slice(0, 8).map(line => line.slice(0, 240)).join('\n');
}
