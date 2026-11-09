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

test("all presets define a complete terminal palette and retain stable default IDs", () => {
  assert.equal(BUILTIN_TERMINAL_SCHEMES.length, 31);
  for (const scheme of BUILTIN_TERMINAL_SCHEMES) {
    assert.deepEqual(Object.keys(scheme.colors).sort(), [...expectedFields].sort());
    for (const [field, color] of Object.entries(scheme.colors)) {
      assert.ok(field === "selectionForeground" && color === null || /^#[\da-f]{6}$/.test(color), `${scheme.id}.${field}`);
    }
  }
  assert.equal(new Set(BUILTIN_TERMINAL_SCHEMES.map(({ id }) => id)).size, BUILTIN_TERMINAL_SCHEMES.length);
  assert.equal(DEFAULT_TERMINAL_SCHEME_ID, "builtin:graphite-dark");
});

test("screenshot gallery schemes use the correct appearance and upstream background", () => {
  const expected = [
    ["builtin:light-owl", "light", "#fbfbfb"],
    ["builtin:one-half-light", "light", "#fafafa"],
    ["builtin:pencil-light", "light", "#f1f1f1"],
    ["builtin:piatto-light", "light", "#ffffff"],
    ["builtin:atom-one-light", "light", "#f9f9f9"],
    ["builtin:ayu-light", "light", "#f8f9fa"],
    ["builtin:base2tone-heath-light", "light", "#fbfaf9"],
    ["builtin:base2tone-morning-light", "light", "#faf8f5"],
    ["builtin:3024-night", "dark", "#090300"],
    ["builtin:belafonte-night", "dark", "#20111b"],
    ["builtin:night-owl", "dark", "#011627"],
    ["builtin:night-lion-v1", "dark", "#000000"],
    ["builtin:night-lion-v2", "dark", "#171717"],
    ["builtin:tokyo-night-storm", "dark", "#24283b"],
    ["builtin:tomorrow-night", "dark", "#1d1f21"],
    ["builtin:tomorrow-night-blue", "dark", "#002451"],
    ["builtin:tomorrow-night-bright", "dark", "#000000"],
    ["builtin:tomorrow-night-eighties", "dark", "#2d2d2d"],
    ["builtin:tokyo-night-day", "light", "#e1e2e7"],
  ];
  for (const [id, kind, background] of expected) {
    const scheme = BUILTIN_TERMINAL_SCHEMES.find((scheme) => scheme.id === id);
    assert.ok(scheme, id);
    assert.equal(scheme.kind, kind, id);
    assert.equal(toXtermTheme(scheme.colors, false).background, background, id);
  }
});

test("writable-directory backgrounds follow blue, purple and amber preset accents", () => {
  const expected = [
    ["builtin:graphite-light", "blue"],
    ["builtin:porcelain-white", "magenta"],
    ["builtin:solarized-light", "yellow"],
    ["builtin:night-owl", "magenta"],
  ];
  const backgrounds = new Set();
  for (const [id, accent] of expected) {
    const scheme = BUILTIN_TERMINAL_SCHEMES.find((scheme) => scheme.id === id);
    const theme = toXtermTheme(scheme.colors, false);
    assert.equal(theme.green, scheme.colors[accent], id);
    backgrounds.add(theme.green);
  }
  assert.equal(backgrounds.size, expected.length);
});

test("Graphite and Porcelain text, directory accents and selection remain readable", () => {
  for (const { colors, id } of BUILTIN_TERMINAL_SCHEMES.filter(({ id }) => ["builtin:graphite-dark", "builtin:graphite-light", "builtin:porcelain-white"].includes(id))) {
    for (const field of ["foreground", "red", "green", "yellow", "blue", "magenta", "cyan", "brightBlack",
      "brightRed", "brightGreen", "brightYellow", "brightBlue", "brightMagenta", "brightCyan"]) {
      assert.ok(store.contrastRatio(colors[field], colors.background) >= 4.5, `${id}.${field}`);
    }
    for (const background of ["selectionBackground", "selectionInactiveBackground"]) {
      assert.ok(store.contrastRatio(colors.foreground, colors[background]) >= 4.5, `${id}.${background}`);
    }
  }
});

test("Porcelain White keeps a pure white background and supports saved selection", () => {
  const scheme = BUILTIN_TERMINAL_SCHEMES.find(({ id }) => id === "builtin:porcelain-white");
  assert.equal(scheme.kind, "light");
  assert.equal(toXtermTheme(scheme.colors, false).background, "#ffffff");
  store.setTerminalThemeFollowAppearance(false);
  store.selectTerminalScheme(scheme.id);
  assert.equal(store.getActiveTerminalScheme().id, scheme.id);
  assert.equal(JSON.parse(values.get(store.terminalThemeStorageKey)).lightSchemeId, scheme.id);
  store.selectTerminalScheme(DEFAULT_TERMINAL_SCHEME_ID);
  store.setTerminalThemeFollowAppearance(true);
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
    colors: { ...colors, foreground: "#112233", green: "#ad63ac" },
  });
  const saved = store.getTerminalThemeStoreState().preferences;
  assert.match(saved.activeSchemeId, /^custom:/);
  assert.equal(saved.customSchemes.length, 1);
  assert.equal(saved.customSchemes[0].colors.foreground, "#112233");
  assert.equal(saved.customSchemes[0].colors.green, "#ad63ac");
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
