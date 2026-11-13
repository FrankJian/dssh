// Native workers cannot resolve CSS variables. Generate their opaque palette
// from the same semantic tokens as the workbench; keep colors in global.css.
export function chromeThemeHeader(css) {
  const blocks = [css.split(':root[data-theme="light"]')[0], css.split(':root[data-theme="light"]')[1]?.split('}')[0]];
  function palette(block) {
    if (!block) throw new Error("Missing RDP chrome theme");
    function color(name, base = [0, 0, 0]) {
      const raw = block.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1];
      if (!raw) throw new Error(`Missing RDP chrome token: ${name}`);
      if (/^#[\da-f]{6}$/i.test(raw)) return [1, 3, 5].map((i) => parseInt(raw.slice(i, i + 2), 16));
      const rgb = raw.match(/^rgb\((\d+) (\d+) (\d+)(?: \/ ([\d.]+)%)?\)$/);
      if (!rgb) throw new Error(`Unsupported RDP chrome token: ${name}`);
      const alpha = rgb[4] === undefined ? 1 : Number(rgb[4]) / 100;
      return rgb.slice(1, 4).map((v, i) => Math.round(Number(v) * alpha + base[i] * (1 - alpha)));
    }
    const surface = color('bg-toolbar', color('bg-app'));
    const values = [surface, color('border-strong', surface), color('text-base'), color('text-muted'),
      color('bg-hover', surface), color('bg-selected', surface), color('accent'), color('danger'), color('btn-danger-bg'), color('btn-danger-fg')];
    return values.map((rgb) => '0x' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('')).join(', ');
  }
  return `// Generated from src/theme/global.css. Do not edit.\n#pragma once\ntypedef struct DsshChromePalette {\n    unsigned surface, border, text, muted, hover, pressed, accent, danger, dangerHover, onDanger;\n} DsshChromePalette;\nstatic const DsshChromePalette dssh_chrome_dark = { ${palette(blocks[0])} };\nstatic const DsshChromePalette dssh_chrome_light = { ${palette(blocks[1])} };\n`;
}
