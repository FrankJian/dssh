/**
 * Only promote an address to a tab title when the terminal stream identifies
 * the connected machine. An arbitrary IP printed by a command or an asset
 * search result is not evidence that the user has connected to that asset.
 */
const IPV4 = /(?:\d{1,3}\.){3}\d{1,3}/g;
const SHELL_PROMPT = /(?:^|\s|\[)[\w.-]+@[-\w.]+[^\r\n]{0,80}[#$%]\s*$/;

function validIpv4(value: string): boolean {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)
    && value.split(".").every((part) => Number(part) <= 255);
}

function firstIp(value: string): string | null {
  for (const match of value.matchAll(IPV4)) {
    const ip = match[0];
    if (validIpv4(ip)) return ip;
  }
  return null;
}

function ipInTerminalTitle(title: string): string | null {
  const host = /(?:^|\s)[\w.-]+@((?:\d{1,3}\.){3}\d{1,3})(?=[:/\s]|$)/.exec(title)?.[1];
  const labelled = /^(?:ip|host|主机|资产)[:：\s]+((?:\d{1,3}\.){3}\d{1,3})(?:\s|$)/i.exec(title)?.[1];
  const candidate = host ?? labelled ?? (validIpv4(title.trim()) ? title.trim() : null);
  return candidate && validIpv4(candidate) ? candidate : null;
}

/** JumpServer direct-login usernames include the asset address before the gateway. */
export function jumpServerAssetIp(username: string): string | null {
  const parts = username.split("@");
  if (parts.length < 4) return null;
  const candidate = parts[parts.length - 2] ?? "";
  return validIpv4(candidate) ? candidate : null;
}

export class TerminalTargetTracker {
  private line = "";
  private input = "";
  private osc = "";
  private escape: "text" | "escape" | "csi" | "osc" | "oscEscape" = "text";
  private jumpServer = false;
  private atShell = false;
  private pendingAssetIp: string | null = null;
  private readonly assetIds = new Map<string, string>();
  private target: string | null | undefined;

  get address(): string | null | undefined {
    return this.target;
  }

  resetConnection(): string | null | undefined {
    this.line = "";
    this.input = "";
    this.osc = "";
    this.escape = "text";
    this.atShell = false;
    this.pendingAssetIp = null;
    this.assetIds.clear();
    this.target = this.jumpServer ? null : undefined;
    return this.target;
  }

  observeInput(data: string): void {
    if (!this.jumpServer || this.atShell) return;
    for (const char of data) {
      if (char === "\r" || char === "\n") {
        const choice = this.input.trim();
        this.pendingAssetIp = validIpv4(choice) ? choice : this.assetIds.get(choice) ?? null;
        this.input = "";
      } else if (char === "\x7f" || char === "\b") {
        this.input = this.input.slice(0, -1);
      } else if (char >= " " && this.input.length < 80) {
        this.input += char;
      }
    }
  }

  observeOutput(data: string): string | null | undefined {
    const before = this.target;
    for (const char of data) {
      switch (this.escape) {
        case "escape":
          this.escape = char === "]" ? "osc" : char === "[" ? "csi" : "text";
          if (char === "]") this.osc = "";
          break;
        case "csi":
          if (char >= "@" && char <= "~") this.escape = "text";
          break;
        case "osc":
          if (char === "\x07") this.finishOsc();
          else if (char === "\x1b") this.escape = "oscEscape";
          else if (this.osc.length < 256) this.osc += char;
          break;
        case "oscEscape":
          if (char === "\\") this.finishOsc();
          else this.escape = "osc";
          break;
        case "text":
          if (char === "\x1b") this.escape = "escape";
          else if (char === "\r" || char === "\n") {
            this.finishLine();
            this.line = "";
          } else if (char === "\b") this.line = this.line.slice(0, -1);
          else if (char >= " " && this.line.length < 512) this.line += char;
          break;
      }
    }
    this.inspectPrompt(this.line);
    return this.target !== before ? this.target : undefined;
  }

  private finishOsc(): void {
    const title = /^(?:0|2);(.*)$/.exec(this.osc)?.[1];
    if (title && (!this.jumpServer || this.atShell || this.pendingAssetIp)) {
      const ip = ipInTerminalTitle(title);
      if (ip && (!this.jumpServer || this.atShell || ip === this.pendingAssetIp)) this.target = ip;
    }
    this.escape = "text";
    this.osc = "";
  }

  private finishLine(): void {
    const line = this.line.trim();
    if (/^(?:Welcome to|欢迎使用).*JumpServer|^(?:JumpServer|KoKo)(?:\s|$)/i.test(line)) {
      this.jumpServer = true;
      this.atShell = false;
      this.pendingAssetIp = null;
      this.assetIds.clear();
      this.target = null;
    }
    if (this.jumpServer && !this.atShell) {
      // Asset selection tables use a numeric ID plus an IP/address column.
      const row = /^(\d{1,5})[.)]?\s+.+$/.exec(line);
      const ip = row && firstIp(row[0]);
      if (row && ip) this.assetIds.set(row[1], ip);
      const connected = /(?:connected\s+to|连接(?:到|至)?[^\r\n]{0,80}成功|成功连接(?:到|至)?)/i.test(line);
      if (connected) {
        const connectedIp = firstIp(line);
        if (connectedIp) {
          this.target = connectedIp;
          this.atShell = true;
        }
      }
    }
    this.inspectPrompt(line);
  }

  private inspectPrompt(line: string): void {
    if (!SHELL_PROMPT.test(line)) return;
    if (this.jumpServer) {
      if (this.pendingAssetIp) {
        this.target = this.pendingAssetIp;
        this.pendingAssetIp = null;
        this.atShell = true;
      } else if (this.atShell) {
        const ip = /[\w.-]+@((?:\d{1,3}\.){3}\d{1,3})/.exec(line)?.[1];
        if (ip && validIpv4(ip)) this.target = ip;
      }
      return;
    }
    const ip = /[\w.-]+@((?:\d{1,3}\.){3}\d{1,3})/.exec(line)?.[1];
    if (ip && validIpv4(ip)) this.target = ip;
  }
}
