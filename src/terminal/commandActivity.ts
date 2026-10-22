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
  private osc = "";

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
    const submittedInteractiveShell = this.recordInput(data);
    if (data.includes("\r") || data.includes("\n")) {
      this.sawLineBreakSinceCommand = false;
      if (submittedInteractiveShell) {
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

    for (const char of data) {
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
            this.currentLine += " ";
            sawVisibleOutput = true;
          } else if (char >= " ") {
            this.currentLine += char;
            if (this.currentLine.length > MAX_LINE_LENGTH) {
              this.currentLine = this.currentLine.slice(-MAX_LINE_LENGTH);
            }
            sawVisibleOutput = true;
          }
          break;
      }
    }

    if (sawVisibleOutput && this.activity === "running" && this.sawLineBreakSinceCommand
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
    if (!marker || marker === "B") return null;
    if (marker === "C" && this.ignoreNextOscCommandStart) {
      this.ignoreNextOscCommandStart = false;
      return null;
    }
    if (marker !== "C") this.ignoreNextOscCommandStart = false;
    return this.setActivity(marker === "C" ? "running" : "idle");
  }

  private recordInput(data: string): boolean {
    let submittedInteractiveShell = false;
    for (const char of data) {
      if (char === "\r" || char === "\n") {
        submittedInteractiveShell ||= isInteractiveShellInvocation(this.inputLine);
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
    return submittedInteractiveShell;
  }

  private setActivity(next: CommandActivity): CommandActivity | null {
    if (next === this.activity) return null;
    this.activity = next;
    if (next === "idle") {
      this.promptBeforeCommand = null;
      this.sawLineBreakSinceCommand = false;
    }
    return next;
  }
}

function looksLikeShellPrompt(line: string): boolean {
  const trimmed = line.trimEnd();
  if (trimmed.length === 0 || trimmed.length > MAX_LINE_LENGTH) return false;

  return /[\w./~:@-][#$]$/.test(trimmed)
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

  const executableParts = words[index]?.split("/");
  const executable = executableParts?.[executableParts.length - 1]?.toLowerCase();
  if (!executable || !INTERACTIVE_SHELLS.has(executable)) return false;

  const argumentsAfterExecutable = words.slice(index + 1);
  return !argumentsAfterExecutable.some((argument) =>
    argument === "-c"
      || argument === "--command"
      || argument === "-Command"
      || !argument.startsWith("-"),
  );
}
