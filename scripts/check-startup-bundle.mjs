/** Production entry's static import closure; dynamic feature chunks are excluded. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';
const reportPath = process.argv[2];
const forbidden = [/\/node_modules\/.*\/(@xterm|monaco-editor)\//, /\/src\/(editor\/EditorWorkbench|settings\/SettingsDialog|sftp\/FileBrowser|sftp\/RemoteFileTree|s3\/S3ObjectBrowser|ai\/AiChat)\.tsx$/];
let measured = false;
await build({ logLevel: 'error', build: { write: false }, plugins: [{ name: 'check-startup-boundary', async generateBundle(_, bundle) {
  const entry = Object.values(bundle).find(item => item.type === 'chunk' && item.isEntry && item.facadeModuleId?.endsWith('/index.html'));
  if (!entry) return;
  measured = true;
  const visited = new Set();
  const visit = name => { if (visited.has(name)) return; const chunk = bundle[name]; if (!chunk || chunk.type !== 'chunk') return; visited.add(name); chunk.imports.forEach(visit); };
  visit(entry.fileName);
  const chunks = [...visited].map(name => bundle[name]);
  const modules = chunks.flatMap(chunk => Object.entries(chunk.modules).map(([id, info]) => ({ id, bytes: info.renderedLength })));
  const report = {
    bytes: chunks.reduce((sum, chunk) => sum + Buffer.byteLength(chunk.code), 0),
    gzip: chunks.reduce((sum, chunk) => sum + gzipSync(chunk.code).length, 0),
    chunks: chunks.map(chunk => ({ name: chunk.fileName, bytes: Buffer.byteLength(chunk.code) })),
    modules: modules.map(item => ({ ...item, id: item.id.replace(process.cwd() + '/', '') })).sort((a, b) => b.bytes - a.bytes),
  };
  const leaks = modules.filter(item => item.bytes > 0 && forbidden.some(pattern => pattern.test(item.id)));
  assert.deepEqual(leaks, [], 'Heavy optional implementation leaked into startup');
  assert.ok(report.bytes < 900_000, `Startup static JavaScript exceeded 900 kB: ${report.bytes}`);
  if (reportPath) await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`Startup boundary passed: ${report.bytes} UTF-8 bytes; ${report.gzip} gzip bytes; ${chunks.length} static chunks`);
}}] });
assert.ok(measured, 'Production HTML entry was not measured');
