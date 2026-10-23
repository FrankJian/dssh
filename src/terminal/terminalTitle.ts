import type { SshProfile, TerminalSession } from "../models";
import { jumpServerAssetIp } from "./terminalTarget";

/** `null` means a JumpServer menu was seen, but no asset was confirmed yet. */
export function defaultSshTerminalTitle(
  session: TerminalSession,
  profile: SshProfile | undefined,
  observedAddress: string | null | undefined,
): string {
  const directAssetIp = profile ? jumpServerAssetIp(profile.username) : null;
  if (typeof observedAddress === "string" && observedAddress !== profile?.host) return observedAddress;
  if (directAssetIp) return directAssetIp;
  if (typeof observedAddress === "string") return observedAddress;
  if (observedAddress === null) return profile?.name ?? session.title;
  return profile?.host || profile?.name || session.title;
}
