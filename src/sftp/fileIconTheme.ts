import theme from "../assets/seti/vs-seti-icon-theme.json" with { type: "json" };

const definitions = new Map<string, { fontCharacter: string; fontColor?: string }>(Object.entries(theme.iconDefinitions));
const names = new Map(Object.entries(theme.fileNames));
const extensions = new Map(Object.entries(theme.fileExtensions));
const languages = new Map(Object.entries(theme.languageIds));
const lightNames = new Map(Object.entries(theme.light.fileNames));
const lightExtensions = new Map(Object.entries(theme.light.fileExtensions));
const lightLanguages = new Map(Object.entries(theme.light.languageIds));

// Standard language-extension associations normally supplied by VS Code extensions.
const languageExtensions: Record<string, string> = {
  typescript: "ts mts cts", typescriptreact: "tsx", javascript: "js mjs cjs", javascriptreact: "jsx",
  rust: "rs", json: "json jsonc jsonl", yaml: "yaml yml", markdown: "md mdx markdown mdown",
  xml: "xml plist xsl xslt xsd dtd", html: "html htm", css: "css", scss: "scss", less: "less", sass: "sass",
  python: "py pyw pyi", go: "go", java: "java", kotlin: "kt kts", c: "c", cpp: "h hh hpp hxx cc cpp cxx", csharp: "cs",
  shellscript: "sh bash zsh fish", powershell: "ps1 psm1 psd1", bat: "bat cmd", properties: "ini conf cfg properties env",
  php: "php", ruby: "rb", lua: "lua", swift: "swift", sql: "sql", r: "r", dart: "dart", vue: "vue", svelte: "svelte",
  perl: "pl pm", clojure: "clj cljs cljc edn", coffeescript: "coffee", dockerfile: "dockerfile", makefile: "mk",
  'objective-c': "m", 'objective-cpp': "mm", fsharp: "fs fsx fsi", julia: "jl", tex: "tex", groovy: "groovy",
};
const languageByExtension = new Map(Object.entries(languageExtensions).flatMap(([language, extensions]) => extensions.split(" ").map(extension => [extension, language] as const)));
const languageNames = new Map<string, string>([
  [".gitignore", "ignore"], [".gitmodules", "ignore"], [".gitkeep", "ignore"], [".npmignore", "ignore"], [".dockerignore", "ignore"],
  ["dockerfile", "dockerfile"], ["containerfile", "dockerfile"], ["makefile", "makefile"], ["gnumakefile", "makefile"],
  [".bashrc", "shellscript"], [".bash_profile", "shellscript"], [".profile", "shellscript"], [".zshrc", "shellscript"], [".zprofile", "shellscript"],
  [".editorconfig", "properties"], [".env", "dotenv"],
]);
function languageForName(name: string): string | undefined {
  if (name.startsWith(".env.")) return "dotenv";
  return languageNames.get(name) ?? languageByExtension.get(name.slice(name.lastIndexOf(".") + 1));
}
export function fileTypeIcon(name: string) {
  const lower = name.toLowerCase();
  let id = names.get(lower); let lightId = lightNames.get(lower);
  if (!id) {
    // Try longest suffix first, e.g. d.ts before ts.
    for (let dot = lower.indexOf("."); dot >= 0; dot = lower.indexOf(".", dot + 1)) {
      const extension = lower.slice(dot + 1); const match = extensions.get(extension);
      if (match) { id = match; lightId = lightExtensions.get(extension); break; }
    }
  }
  if (!id) {
    const language = languageForName(lower);
    if (language) { id = languages.get(language); lightId = lightLanguages.get(language); }
  }
  id ??= theme.file; lightId ??= id === theme.file ? theme.light.file : id;
  const dark = definitions.get(id) ?? definitions.get(theme.file)!;
  const light = definitions.get(lightId) ?? dark;
  return { id, glyph: String.fromCodePoint(parseInt(dark.fontCharacter.replace(/\\/g, ""), 16)), color: dark.fontColor ?? "var(--file-icon-code)", lightColor: light.fontColor ?? dark.fontColor ?? "var(--file-icon-code)" };
}
