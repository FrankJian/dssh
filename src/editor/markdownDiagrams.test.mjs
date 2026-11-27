import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limitMermaidDiagrams } from './markdownDiagrams.ts';
test('Markdown budgets include nested and aliased diagrams while preserving ordinary code and source values', () => {
  const nodes = Array.from({length: 35}, (_, i) => ({ type:'code', lang:i % 2 ? 'mermaid':'mamerid', value:'graph LR\nA-->B' }));
  const ordinary = { type:'code', lang:'js', value:'console.log(1)' };
  limitMermaidDiagrams()({ type:'root', children:[ordinary, {type:'blockquote', children:nodes}] });
  assert.equal(nodes.filter(n=>/^(mermaid|mamerid)$/.test(n.lang)).length,32);
  assert.equal(nodes[32].lang,'dssh-mermaid-limit'); assert.equal(nodes[33].lang,'text');
  assert.equal(ordinary.lang,'js'); assert.ok(nodes.every(n=>n.value==='graph LR\nA-->B'));
});
