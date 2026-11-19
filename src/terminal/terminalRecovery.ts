// CAN aborts a partial CSI/OSC left by a dead PTY. Reset only client modes that
// cannot belong to the new shell; keep scrollback and terminal contents intact.
export const OFFLINE_TERMINAL_MODES = "\x18\x1b[?1049l\x1b[?1000;1002;1003;1004;1006;2004;2026l\x1b[?25h\x1b[0 q\x1b[0m";

// An explicit user action may reveal a cursor hidden by a login script without
// resetting the screen, leaving an alternate buffer, or sending remote input.
export const RESTORE_CURSOR = "\x18\x1b[?25h\x1b[0 q";
