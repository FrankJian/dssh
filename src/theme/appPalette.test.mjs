import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { appPaletteContrast, appPaletteTokens, normalizeAppPaletteColor } from "./appPalette.ts";

test("destructive button text remains readable in both appearances and hover states", () => {
  const css = readFileSync(new URL("./global.css", import.meta.url), "utf8");
  for (const selector of [/:root\s*\{([\s\S]*?)\n\}/, /:root\[data-theme="light"\]\s*\{([\s\S]*?)\n\}/]) {
    const block = css.match(selector)?.[1];
    assert.ok(block, "appearance token block exists");
    const tokens = Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
    for (const background of ["--btn-danger-bg", "--btn-danger-bg-hover"]) {
      assert.ok(appPaletteContrast(tokens["--btn-danger-fg"], tokens[background]) >= 4.5, `${selector}: ${background}`);
    }
  }
});

test("custom palette accepts only normalized RGB hex values", () => {
  assert.equal(normalizeAppPaletteColor(" #AbC "), "#aabbcc");
  assert.equal(normalizeAppPaletteColor("#12aBcF"), "#12abcf");
  for (const value of ["red", "#12", "#12345678", "var(--accent)", "url(x)"]) {
    assert.equal(normalizeAppPaletteColor(value), null);
  }
});

test("custom hues generate coherent light and dark tokens with readable text and buttons", () => {
  for (const color of ["#84c6ae", "#ff0000", "#ffff00", "#00ff00", "#0000ff", "#ff00ff", "#00ffff", "#ffffff", "#000000"]) {
    const dark = appPaletteTokens(color, "dark");
    const light = appPaletteTokens(color, "light");
    assert.deepEqual(Object.keys(dark).sort(), Object.keys(light).sort());
    assert.notEqual(dark["--bg-app"], light["--bg-app"]);
    assert.notEqual(dark["--accent"], light["--accent"]);
    for (const tokens of [dark, light]) {
      assert.ok(appPaletteContrast(tokens["--text-base"], tokens["--bg-app"]) >= 4.5, `${color}: body text`);
      assert.ok(appPaletteContrast(tokens["--text-muted"], tokens["--bg-app"]) >= 4.5, `${color}: muted text`);
      assert.ok(appPaletteContrast(tokens["--text-faint"], tokens["--bg-app"]) >= 4.5, `${color}: faint text`);
      assert.ok(appPaletteContrast(tokens["--btn-primary-fg"], tokens["--btn-primary-bg"]) >= 4.5, `${color}: primary button`);
      assert.ok(appPaletteContrast(tokens["--btn-primary-fg"], tokens["--btn-primary-bg-hover"]) >= 4.5, `${color}: hover button`);
      assert.ok(appPaletteContrast(tokens["--accent-fg"], tokens["--accent"]) >= 4.5, `${color}: accent badge`);
    }
  }
});

test("changing the chosen color's shade changes surfaces and accents", () => {
  for (const appearance of ["dark", "light"]) {
    const deep = appPaletteTokens("#143e33", appearance);
    const pale = appPaletteTokens("#b4e2d4", appearance);
    for (const token of ["--bg-app", "--accent", "--btn-primary-bg"]) {
      assert.notEqual(deep[token], pale[token], `${appearance}: ${token}`);
      assert.ok(appPaletteContrast(deep[token], "#000000") < appPaletteContrast(pale[token], "#000000"), `${appearance}: ${token} lightness`);
    }
  }
});
