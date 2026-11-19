export type CommandActivity = "idle" | "running";

type ParserState = "text" | "escape" | "csi" | "osc" | "oscEscape" | "charset";

const MAX_LINE_LENGTH = 240;
const MAX_OSC_LENGTH = 256;
const INTERACTIVE_SHELLS = new Set([
  "ash",
  "bash",
  "csh",
  "dash",
  "fish",
  "ksh",
  "pwsh",
  "powershell",
  "sh",
  "tcsh",
  "zsh",
]);

/**
 * Tracks command activity without modifying the bytes sent to xterm. OSC 133
 * supplies an exact lifecycle when supported; other shells fall back to the
 * prompt that was visible before Enter and common prompt suffixes.
 */
export class TerminalCommandActivityTracker {
  private activity: CommandActivity = "idle";
  private parserState: ParserState = "text";
  private currentLine = "";
  private inputLine = "";
  private promptBeforeCommand: string | null = null;
  private sawLineBreakSinceCommand = false;
  private ignoreNextOscCommandStart = false;
  private hasShellIntegration = false;
  private osc = "";

  /** A newly attached PTY may already be running a command whose input was hidden. */
  restoreFromOutput(data: string, knownActivity?: CommandActivity): CommandActivity {
    this.observeOutput(data);
    if (!this.hasShellIntegration) {
      // A moved window knows more than prompt-shape heuristics (custom zsh,
      // PowerShell and gateways need not end with $, # or %). OSC markers still
      // win if the command finished while the window was opening.
      this.activity = knownActivity ?? (looksLikeShellPrompt(this.currentLine) ? "idle" : "running");
    }
    this.sawLineBreakSinceCommand = true;
    return this.activity;
  }

  observeInput(data: string): CommandActivity | null {
    if (data.includes("\x03")) {
      this.inputLine = "";
      this.ignoreNextOscCommandStart = false;
      return this.setActivity("idle");
    }

    if (this.activity === "idle" && this.promptBeforeCommand === null) {
      // Capture the prompt before the PTY echoes the first typed character.
      // This also handles custom prompts that do not end in $, #, or %.
      this.promptBeforeCommand = this.currentLine || null;
    }
    const { submittedInteractiveShell, submittedCommand } = this.recordInput(data);
    if (data.includes("\r") || data.includes("\n")) {
      if (!submittedCommand && this.activity === "idle") {
        return this.setActivity("idle");
      }
      this.sawLineBreakSinceCommand = false;
      if (submittedInteractiveShell) {
        // The nested shell may not inherit the parent's integration hooks.
        this.hasShellIntegration = false;
        // A child shell owns the terminal interactively. It is not a
        // background or long-running task for the tab indicator, and its
        // parent shell's OSC 133;C marker must not turn the indicator back on.
        this.ignoreNextOscCommandStart = true;
        return this.setActivity("idle");
      }
      this.ignoreNextOscCommandStart = false;
      return this.setActivity("running");
    }
    return null;
  }

  observeOutput(data: string): CommandActivity | null {
    let changed: CommandActivity | null = null;
    let sawVisibleOutput = false;

    const controls = /[\x00-\x1f]/g;
    let offset = 0;
    while (offset < data.length) {
      if (this.parserState === "text") {
        // Ordinary output is usually a whole text run. Keep only its bounded
        // tail once, rather than allocating/slicing a 240-character string
        // for every character of a log line or a large unbroken response.
        controls.lastIndex = offset;
        const end = controls.exec(data)?.index ?? data.length;
        if (end > offset) {
          const tail = data.slice(Math.max(offset, end - MAX_LINE_LENGTH), end);
          this.currentLine = end - offset >= MAX_LINE_LENGTH
            ? tail : (this.currentLine + tail).slice(-MAX_LINE_LENGTH);
          sawVisibleOutput = true;
          offset = end;
          if (offset === data.length) break;
        }
      }
      // Control strings can contain Unicode. Preserve the old code-point
      // iteration, including the OSC limit and split escape parser state.
      const point = data.codePointAt(offset)!;
      const char = String.fromCodePoint(point);
      offset += char.length;
      switch (this.parserState) {
        case "escape":
          this.parserState = char === "[" ? "csi"
            : char === "]" ? "osc"
            : char === "(" || char === ")" ? "charset" : "text";
          if (char === "]") this.osc = "";
          break;
        case "csi":
          if (char >= "@" && char <= "~") this.parserState = "text";
          break;
        case "osc":
          if (char === "\x07") {
            changed = this.finishOsc() ?? changed;
          } else if (char === "\x1b") {
            this.parserState = "oscEscape";
          } else if (this.osc.length < MAX_OSC_LENGTH) {
            this.osc += char;
          }
          break;
        case "oscEscape":
          if (char === "\\") {
            changed = this.finishOsc() ?? changed;
          } else {
            this.parserState = "osc";
          }
          break;
        case "charset":
          this.parserState = "text";
          break;
        case "text":
          if (char === "\x1b") {
            this.parserState = "escape";
          } else if (char === "\r" || char === "\n") {
            this.currentLine = "";
            if (this.activity === "running") this.sawLineBreakSinceCommand = true;
          } else if (char === "\b") {
            this.currentLine = this.currentLine.slice(0, -1);
          } else if (char === "\t") {
            this.currentLine = (this.currentLine + " ").slice(-MAX_LINE_LENGTH);
            sawVisibleOutput = true;
          }
          break;
      }
    }

    if (!this.hasShellIntegration && sawVisibleOutput && this.activity === "running" && this.sawLineBreakSinceCommand
      && (looksLikeShellPrompt(this.currentLine)
        || (this.promptBeforeCommand !== null && this.currentLine === this.promptBeforeCommand))) {
      changed = this.setActivity("idle") ?? changed;
    }
    return changed;
  }

  private finishOsc(): CommandActivity | null {
    this.parserState = "text";
    const marker = /^133;([ABCD])(?:;|$)/.exec(this.osc)?.[1];
    this.osc = "";
    if (!marker) return null;
    // Once a shell supplies prompt/completion markers, trust its lifecycle.
    // Output such as "progress 50%" is not a prompt, even across PTY chunks.
    // A lone C marker can come from a parent shell, so keep fallback in that case.
    if (marker !== "C") this.hasShellIntegration = true;
    if (marker === "B") return null;
    if (marker === "C" && this.ignoreNextOscCommandStart) {
      this.ignoreNextOscCommandStart = false;
      return null;
    }
    if (marker !== "C") this.ignoreNextOscCommandStart = false;
    return this.setActivity(marker === "C" ? "running" : "idle");
  }

  private recordInput(data: string): { submittedInteractiveShell: boolean; submittedCommand: boolean } {
    let submittedInteractiveShell = false;
    let submittedCommand = false;
    for (const char of data) {
      if (char === "\r" || char === "\n") {
        submittedInteractiveShell ||= isInteractiveShellInvocation(this.inputLine);
        submittedCommand ||= this.inputLine.trim().length > 0;
        this.inputLine = "";
      } else if (char === "\x7f" || char === "\b") {
        this.inputLine = this.inputLine.slice(0, -1);
      } else if (char >= " ") {
        this.inputLine += char;
        if (this.inputLine.length > MAX_LINE_LENGTH) {
          this.inputLine = this.inputLine.slice(-MAX_LINE_LENGTH);
        }
      }
    }
    return { submittedInteractiveShell, submittedCommand };
  }

  private setActivity(next: CommandActivity): CommandActivity | null {
    if (next === "idle") {
      this.promptBeforeCommand = null;
      this.sawLineBreakSinceCommand = false;
    }
    if (next === this.activity) return null;
    this.activity = next;
    return next;
  }
}

function looksLikeShellPrompt(line: string): boolean {
  const trimmed = line.trimEnd();
  if (trimmed.length === 0 || trimmed.length > MAX_LINE_LENGTH) return false;

  return /[\w./~:@\]-][#$]$/.test(trimmed)
    || /[%❯➜]$/.test(trimmed)
    || /^PS\s+.+>$/.test(trimmed);
}

function isInteractiveShellInvocation(input: string): boolean {
  const command = input.trim();
  if (!command || /[|;&<>]/.test(command)) return false;

  const words = command.split(/\s+/);
  let index = 0;
  while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index] ?? "")) index += 1;
  if (words[index] === "command" || words[index] === "exec") index += 1;

  return isInteractiveShellWords(words.slice(index));
}

function isInteractiveShellWords(words: string[]): boolean {
  const executableParts = words[0]?.split("/");
  const executable = executableParts?.[executableParts.length - 1]?.toLowerCase();

  if (executable === "sudo") {
    let index = 1;
    let shellMode = false;
    while (index < words.length) {
      const option = words[index];
      if (option === "--") {
        index += 1;
        break;
      }
      if (!option.startsWith("-")) break;
      if (["-i", "--login", "-s", "--shell"].includes(option)) {
        shellMode = true;
      } else if (["-u", "--user", "-g", "--group", "-h", "--host", "-p", "--prompt"].includes(option)) {
        index += 1;
      } else if (!["-E", "--preserve-env", "-H", "--set-home", "-P", "--preserve-groups", "-n", "--non-interactive"].includes(option)) {
        return false;
      }
      index += 1;
    }
    return index === words.length ? shellMode : isInteractiveShellWords(words.slice(index));
  }

  if (executable === "su") {
    const args = words.slice(1);
    if (args.some((arg) => arg.startsWith("-c") || /^--(?:session-)?command(?:=|$)/.test(arg))) return false;
    let users = 0;
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      if (["-s", "--shell", "-g", "--group", "-G", "--supp-group", "-w", "--whitelist-environment"].includes(arg)) {
        if (index + 1 >= args.length) return false;
        index += 1;
      } else if (arg !== "-" && !arg.startsWith("-")) {
        users += 1;
      }
    }
    return users <= 1;
  }

  if (!executable || !INTERACTIVE_SHELLS.has(executable)) return false;

  const argumentsAfterExecutable = words.slice(1);
  return !argumentsAfterExecutable.some((argument) =>
    argument === "-c"
      || argument === "--command"
      || argument === "-Command"
      || !argument.startsWith("-"),
  );
}
