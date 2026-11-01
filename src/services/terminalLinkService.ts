import { getBrowserLinkTarget } from "../browser/browserPreferences";
import { openBrowser, openBrowserExternal } from "./browserService";

export async function openTerminalLink(address: string): Promise<void> {
  const url = new URL(address);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("终端链接仅支持 HTTP / HTTPS 地址。");
  const target = getBrowserLinkTarget();
  if (target === "builtin") await openBrowser(url.href);
  else await openBrowserExternal(url.href, target);
}
