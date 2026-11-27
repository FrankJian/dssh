import test from 'node:test';
import assert from 'node:assert/strict';
import { editorSymbolChain } from './documentSymbols.ts';
test('symbol breadcrumbs follow provider ranges and stop outside a nested scope', () => {
 const node = (name, startLineNumber, endLineNumber, children = []) => ({ name, range: { startLineNumber, startColumn: 1, endLineNumber, endColumn: 20 }, selection: { startLineNumber, startColumn: 1, endLineNumber: startLineNumber, endColumn: 2 }, children });
 const symbols = [node('class', 1, 20, [node('method', 3, 10, [node('inner', 5, 6)])])];
 assert.deepEqual(editorSymbolChain(symbols, 5, 8).map(symbol => symbol.name), ['class', 'method', 'inner']);
 assert.deepEqual(editorSymbolChain(symbols, 12, 1).map(symbol => symbol.name), ['class']); assert.deepEqual(editorSymbolChain(symbols, 21, 1), []);
});
