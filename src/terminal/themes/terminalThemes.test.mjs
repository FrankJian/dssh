import assert from "node:assert/strict";
import { test } from "node:test";

const values = new Map();
globalThis.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
};

const [{ BUILTIN_TERMINAL_SCHEMES, DEFAULT_TERMINAL_SCHEME_ID }, { toXtermTheme }, store] = await Promise.all([
  import("./presets.ts"),
  import("./resolve.ts"),
  import("../../settings/terminalThemeStore.ts"),
]);

const expectedFields = [
  "foreground", "background", "cursor", "cursorAccent", "selectionBackground",
  "selectionInactiveBackground", "selectionForeground", "black", "red", "green",
  "yellow", "blue", "magenta", "cyan", "white", "brightBlack", "brightRed",
  "brightGreen", "brightYellow", "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
];

test("all twelve presets define a complete terminal palette and preserve Graphite defaults", () => {
  assert.equal(BUILTIN_TERMINAL_SCHEMES.length, 12);
  for (const scheme of BUILTIN_TERMINAL_SCHEMES) {
    assert.deepEqual(Object.keys(scheme.colors).sort(), [...expectedFields].sort());
    for (const [field, color] of Object.entries(scheme.colors)) {
      assert.ok(field === "selectionForeground" && color === null || /^#[\da-f]{6}$/.test(color), `${scheme.id}.${field}`);
    }
  }
  assert.equal(DEFAULT_TERMINAL_SCHEME_ID, "builtin:graphite-dark");
  const graphite = BUILTIN_TERMINAL_SCHEMES[0].colors;
  assert.deepEqual(graphite, {
    background: "#0b0e12", foreground: "#dde4ea", cursor: "#a8c7de", cursorAccent: "#0b0e12",
    selectionBackground: "#182630", selectionInactiveBackground: "#121c24", selectionForeground: null,
    black: "#151b22", red: "#e18484", green: "#73c9a2", yellow: "#d6b56c", blue: "#79a6c9",
    magenta: "#c69ac9", cyan: "#70c5c8", white: "#dde4ea", brightBlack: "#65717c",
    brightRed: "#efaaaa", brightGreen: "#9ad8ba", brightYellow: "#e5ca8b", brightBlue: "#a8c7de",
    brightMagenta: "#dbb7dc", brightCyan: "#9bdcdf", brightWhite: "#ffffff",
  });
});

test("HEX input accepts short and long RGB forms and rejects other CSS values", () => {
  assert.equal(store.normalizeTerminalColorInput(" #AbC "), "#aabbcc");
  assert.equal(store.normalizeTerminalColorInput("#0a12ef"), "#0a12ef");
  assert.equal(store.normalizeTerminalColorInput("red"), null);
  assert.equal(store.normalizeTerminalColorInput("#12"), null);
  assert.equal(store.normalizeTerminalColorInput("rgba(0,0,0,.5)"), null);
});

test("xterm themes support transparency and clearing optional selection foreground", () => {
  const colors = BUILTIN_TERMINAL_SCHEMES[0].colors;
  const opaque = toXtermTheme(colors, false);
  const transparent = toXtermTheme(colors, true);
  assert.equal(opaque.background, colors.background);
  assert.equal(transparent.background, "rgba(0, 0, 0, 0)");
  assert.equal(Object.hasOwn(opaque, "selectionForeground"), false);
});

test("scheme selection, custom save, and active custom deletion persist atomically", () => {
  store.selectTerminalScheme("builtin:nord");
  assert.equal(store.getTerminalThemeStoreState().preferences.activeSchemeId, "builtin:nord");

  const colors = BUILTIN_TERMINAL_SCHEMES[1].colors;
  store.saveCustomTerminalScheme({
    name: "My terminal",
    kind: "light",
    sourcePresetId: "builtin:graphite-light",
    baseColors: colors,
    colors: { ...colors, foreground: "#112233" },
  });
  const saved = store.getTerminalThemeStoreState().preferences;
  assert.match(saved.activeSchemeId, /^custom:/);
  assert.equal(saved.customSchemes.length, 1);
  assert.equal(saved.customSchemes[0].colors.foreground, "#112233");
  assert.equal(JSON.parse(values.get(store.terminalThemeStorageKey)).revision, saved.revision);

  store.deleteCustomTerminalScheme(saved.activeSchemeId);
  const afterDelete = store.getTerminalThemeStoreState().preferences;
  assert.equal(afterDelete.customSchemes.length, 0);
  assert.equal(afterDelete.activeSchemeId, "builtin:graphite-light");
});

test("appearance-aware selections keep light and dark terminal palettes paired with the app", async () => {
  values.delete(store.terminalThemeStorageKey);
  const pairedStore = await import("../../settings/terminalThemeStore.ts?appearance-aware");
  const preferences = pairedStore.getTerminalThemeStoreState().preferences;
  assert.equal(preferences.followAppearance, true);
  assert.equal(preferences.darkSchemeId, DEFAULT_TERMINAL_SCHEME_ID);
  assert.equal(preferences.lightSchemeId, "builtin:graphite-light");

  pairedStore.selectTerminalScheme("builtin:nord");
  assert.equal(pairedStore.getTerminalThemeStoreState().preferences.darkSchemeId, "builtin:nord");
  assert.equal(pairedStore.getActiveTerminalScheme().id, "builtin:nord");

  pairedStore.setTerminalThemeFollowAppearance(false);
  pairedStore.selectTerminalScheme("builtin:solarized-light");
  assert.equal(pairedStore.getActiveTerminalScheme().id, "builtin:solarized-light");
  pairedStore.setTerminalThemeFollowAppearance(true);
  assert.equal(pairedStore.getActiveTerminalScheme().id, "builtin:nord");
});

test("legacy records receive compatible light and dark defaults without losing their active scheme", async () => {
  values.set(store.terminalThemeStorageKey, JSON.stringify({
    schemaVersion: 1,
    revision: 8,
    activeSchemeId: "builtin:nord",
    customSchemes: [],
  }));
  const legacyStore = await import("../../settings/terminalThemeStore.ts?legacy-record");
  const preferences = legacyStore.getTerminalThemeStoreState().preferences;
  assert.equal(preferences.activeSchemeId, "builtin:nord");
  assert.equal(preferences.followAppearance, true);
  assert.equal(preferences.darkSchemeId, "builtin:nord");
  assert.equal(preferences.lightSchemeId, "builtin:graphite-light");
});

test("invalid persisted data is preserved until explicit reset", async () => {
  values.set(store.terminalThemeStorageKey, "{broken json");
  const brokenStore = await import("../../settings/terminalThemeStore.ts?invalid-record");
  assert.equal(brokenStore.getTerminalThemeStoreState().readOnly, true);
  assert.match(brokenStore.getTerminalThemeStoreState().storageError, /无法读取/);
  assert.equal(values.get(store.terminalThemeStorageKey), "{broken json");

  brokenStore.resetInvalidTerminalThemeStorage();
  assert.equal(brokenStore.getTerminalThemeStoreState().readOnly, false);
  assert.equal(brokenStore.getTerminalThemeStoreState().preferences.activeSchemeId, DEFAULT_TERMINAL_SCHEME_ID);
});
