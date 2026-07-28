import { isMacOS } from "../platform";

/**
 * App-level shortcuts must be recognised in two places: the global `window`
 * listener that acts on them, and xterm's custom key handler that has to let
 * them escape the terminal.
 *
 * xterm treats several `Ctrl`+letter combos as its own bindings (Ctrl+K sends a
 * vertical tab, for example) and calls `stopPropagation()` on them, so without
 * an explicit opt-out the window listener never sees the key on Windows/Linux.
 * On macOS the same shortcuts use Cmd, which xterm ignores — which is why such
 * bugs are invisible there. Keep this list as the single source of truth.
 */

/** The platform's primary modifier: Cmd on macOS, Ctrl elsewhere. */
export function hasPrimaryModifier(event: KeyboardEvent): boolean {
  return isMacOS ? event.metaKey : event.ctrlKey;
}

/** Toggles the command palette (⌘K / Ctrl+K). */
export function isCommandPaletteShortcut(event: KeyboardEvent): boolean {
  return hasPrimaryModifier(event) && !event.altKey && event.key.toLowerCase() === "k";
}

/**
 * True when the key is an app-level shortcut that the terminal must not consume.
 * xterm's custom key handler should return `false` for these so they bubble up.
 */
export function isAppShortcut(event: KeyboardEvent): boolean {
  return isCommandPaletteShortcut(event);
}
