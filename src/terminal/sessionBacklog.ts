import { RETAINED_OUTPUT_CHARS } from "../settings/settings.ts";

/** Retain whole transport chunks, with amortized O(1) eviction. This is raw
 * history, not a screen snapshot: chunks can still split ANSI sequences. */
export interface SessionBacklog {
  chunks: string[];
  head: number;
  length: number;
}

export function createBacklog(initial?: string): SessionBacklog {
  return { chunks: initial ? [initial] : [], head: 0, length: initial?.length ?? 0 };
}

export function appendToBacklog(backlog: SessionBacklog, data: string) {
  if (!data) return;
  backlog.chunks.push(data);
  backlog.length += data.length;
  while (backlog.head < backlog.chunks.length - 1) {
    const oldest = backlog.chunks[backlog.head];
    if (backlog.length - oldest.length < RETAINED_OUTPUT_CHARS) break;
    backlog.length -= oldest.length;
    // Release the string immediately, without shifting every remaining chunk.
    backlog.chunks[backlog.head++] = "";
  }
  if (backlog.head >= 1024 && backlog.head * 2 >= backlog.chunks.length) {
    backlog.chunks = backlog.chunks.slice(backlog.head);
    backlog.head = 0;
  }
}

export function readBacklog(backlog: SessionBacklog): string {
  // Do not merge the stored chunks: a merged history becomes a single oversized
  // eviction unit and makes the next append retain nearly twice the target.
  return backlog.chunks.slice(backlog.head).join("");
}
