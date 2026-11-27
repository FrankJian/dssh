import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateMermaidSource, diagramRasterSize } from './mermaidImage.ts';
test('Mermaid raster export preserves proportions inside native PNG limits', () => {
  assert.deepEqual(diagramRasterSize(200, 100), { width: 400, height: 200 });
  assert.deepEqual(diagramRasterSize(4000, 2000), { width: 1024, height: 512 });
  assert.deepEqual(diagramRasterSize(200, 10000), { width: 82, height: 4096 });
  for (const dimensions of [[0, 1], [NaN, 1], [100001, 1], [1, Infinity]]) assert.throws(() => diagramRasterSize(...dimensions));
});
test('Mermaid source accepts diagrams and rejects budgets, config and network-capable constructs', () => {
  validateMermaidSource('flowchart LR\n A[开始] --> B[结束]');
  for (const source of ['', 'x'.repeat(65537), '测'.repeat(24000), 'A;'.repeat(1001), '%%{init: {securityLevel:"loose"}}%%\ngraph LR\nA-->B', '---\nconfig: {}\n---\ngraph LR\nA-->B', 'graph LR\nA@{ img: "image.png" }', 'graph LR\nA["https://example.test"]', 'classDef a fill:url(https://example.test)', 'classDef a fill:u\\72l(\\68ttps\\3a\\2f\\2fexample.test)', 'graph LR\nA["https&#58;&#47;&#47;example.test"]']) assert.throws(() => validateMermaidSource(source));
});
