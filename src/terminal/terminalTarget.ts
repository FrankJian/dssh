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

export interface JumpServerSftpTarget {
  address: string;
  account: string;
}

export function jumpServerSftpTarget(username: string): JumpServerSftpTarget | undefined {
  const parts = username.split("@");
  const address = jumpServerAssetIp(username);
  const account = parts[parts.length === 4 && /^(ssh|sftp)$/i.test(parts[1]) ? 2 : parts.length === 3 ? 1 : parts.length - 3];
  if (address && account && /^[\w.-]+$/.test(account)) return { address, account };
}

/** JumpServer direct-login usernames include the asset address before the gateway. */
export function jumpServerAssetIp(username: string): string | null {
  const parts = username.split("@");
  if (parts.length < 3) return null;
  const candidate = parts.length === 3 || (parts.length === 4 && /^(ssh|sftp)$/i.test(parts[1]))
    ? parts[parts.length - 1]
    : parts[parts.length - 2] ?? "";
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
  private pendingAccount: string | undefined;
  private readonly assetIds = new Map<string, string>();
  private target: string | null | undefined;
  private sftpAsset: JumpServerSftpTarget | undefined;

  get address(): string | null | undefined {
    return this.target;
  }

  get sftpTarget(): JumpServerSftpTarget | undefined {
    return this.sftpAsset;
  }

  resetConnection(): string | null | undefined {
    this.line = "";
    this.input = "";
    this.osc = "";
    this.escape = "text";
    this.atShell = false;
    this.pendingAssetIp = null;
    this.pendingAccount = undefined;
    this.sftpAsset = undefined;
    this.assetIds.clear();
    this.target = this.jumpServer ? null : undefined;
    return this.target;
  }

  observeInput(data: string): void {
    if (!this.jumpServer || this.atShell) return;
    for (const char of data) {
      if (char === "\r" || char === "\n") {
        const choice = this.input.trim();
        const address = validIpv4(choice) ? choice : this.assetIds.get(choice);
        if (address) {
          this.pendingAssetIp = address;
          this.pendingAccount = undefined;
        }
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
    this.inspectJumpServerMenu(this.line);
    this.inspectPrompt(this.line);
    return this.target !== before ? this.target : undefined;
  }

  private inspectJumpServerMenu(line: string): void {
    // KoKo returns to Opt> after exiting an asset, often without repeating its
    // welcome banner. Clear the old asset so the next selection can be tracked.
    if (!/^Opt\s*[>:]\s*$/i.test(line.trim())) return;
    if (this.atShell) this.assetIds.clear();
    this.jumpServer = true;
    this.atShell = false;
    this.pendingAssetIp = null;
    this.pendingAccount = undefined;
    this.sftpAsset = undefined;
    this.input = "";
    this.target = null;
  }

  private finishOsc(): void {
    const title = /^(?:0|2);(.*)$/.exec(this.osc)?.[1];
    const koko = title && /^ssh:\/\/([\w.-]+)@((?:\d{1,3}\.){3}\d{1,3})(?=[:/\s]|$)/i.exec(title);
    const telnet = title && /^telnet:\/\/[^\r\n]*@((?:\d{1,3}\.){3}\d{1,3})(?=[:/\s]|$)/i.exec(title);
    const kokoIp = (koko && koko[2]) || (telnet && telnet[1]);
    if (kokoIp && validIpv4(kokoIp)) {
      if (!this.atShell && koko) this.sftpAsset = { address: kokoIp, account: koko[1] };
      this.jumpServer = true;
      this.atShell = true;
      this.pendingAssetIp = null;
      this.target = kokoIp;
    } else if (title && (!this.jumpServer || this.atShell || this.pendingAssetIp)) {
      const ip = ipInTerminalTitle(title);
      if (ip && (!this.jumpServer || this.atShell || ip === this.pendingAssetIp)) this.target = ip;
    }
    this.escape = "text";
    this.osc = "";
  }

  private finishLine(): void {
    const line = this.line.trim();
    this.inspectJumpServerMenu(line);
    if (/^(?:Welcome to|欢迎使用).*JumpServer|^(?:JumpServer|KoKo)(?:\s|$)/i.test(line)) {
      this.jumpServer = true;
      this.atShell = false;
      this.pendingAssetIp = null;
      this.pendingAccount = undefined;
      this.sftpAsset = undefined;
      this.assetIds.clear();
      this.target = null;
    }
    if (this.jumpServer && !this.atShell) {
      // Asset selection tables use a numeric ID plus an IP/address column.
      const row = /^(?:Opt\s*[>:]\s*)?(\d{1,5})[.)]?\s+.+$/i.exec(line);
      const ip = row && firstIp(row[0]);
      if (row && ip) this.assetIds.set(row[1], ip);
      const connecting = /(?:connect(?:ed|ing)\s+to|开始连接到|正在连接到|连接(?:到|至)?[^\r\n]{0,80}成功|成功连接(?:到|至)?)/i.test(line);
      if (connecting) {
        const assetIp = firstIp(line);
        if (assetIp) {
          const account = /([\w.-]+)(?:\([^()]*\))?@/.exec(line)?.[1];
          if (/(?:connected\s+to|连接(?:到|至)?[^\r\n]{0,80}成功|成功连接(?:到|至)?)/i.test(line)) {
            this.target = assetIp;
            this.atShell = true;
            if (account) this.sftpAsset = { address: assetIp, account };
          } else {
            this.pendingAssetIp = assetIp;
            this.pendingAccount = account;
          }
        }
      }
    }
    this.inspectPrompt(line);
  }

  private inspectPrompt(line: string): void {
    if (!SHELL_PROMPT.test(line)) return;
    if (this.jumpServer) {
      const account = this.pendingAccount ?? /(?:^|\s|\[)([\w.-]+)@/.exec(line)?.[1];
      const ip = /[\w.-]+@((?:\d{1,3}\.){3}\d{1,3})/.exec(line)?.[1];
      const address = ip && validIpv4(ip) ? ip : this.pendingAssetIp;
      if (!this.atShell && address && account) this.sftpAsset = { address, account };
      if (ip && validIpv4(ip)) {
        // The shell's own host is stronger evidence than a preceding menu row.
        this.target = ip;
        this.pendingAssetIp = null;
        this.atShell = true;
      } else if (this.pendingAssetIp) {
        this.target = this.pendingAssetIp;
        this.pendingAssetIp = null;
        this.atShell = true;
      }
      return;
    }
    const ip = /[\w.-]+@((?:\d{1,3}\.){3}\d{1,3})/.exec(line)?.[1];
    if (ip && validIpv4(ip)) this.target = ip;
  }
}
