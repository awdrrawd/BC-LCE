import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';

const html = readFileSync(new URL('../docs/lce-architecture.html', import.meta.url), 'utf8');
const scriptMatch = html.match(/<script\b[^>]*>([\s\S]*?)<\/script\b[^>]*>/i);
assert.ok(scriptMatch, 'architecture page should contain an inline <script> block');
const script = scriptMatch[1];

// 互動式架構圖會被 vite.config.js 輸出到 dist/ 並經 Pages 發布，
// 這幾項檢查避免它悄悄過時、失效或重新引入 DOM XSS（CodeQL js/xss-through-dom）。

test('architecture page only references source files that exist', () => {
    const data = eval(`(${script.match(/const D = (\[[\s\S]*?\n\]);/)[1]})`);
    const files = new Set(data.flatMap(feature => feature[2].flatMap(branch => branch[2].split(','))));
    assert.ok(files.size > 50, 'diagram should list the project files');
    const missing = [...files].filter(f => !f.includes('*') && !existsSync(new URL(`../src/${f}`, import.meta.url)));
    assert.deepEqual(missing, []);
});

test('architecture page renders without innerHTML so DOM text is never reparsed as HTML', () => {
    assert.equal(/innerHTML|insertAdjacentHTML|outerHTML|document\.write/.test(script), false);
});

test('architecture page has no relative links that would 404 on GitHub Pages', () => {
    const relative = [...html.matchAll(/href="(?!https?:|#)([^"]+)"/g)].map(m => m[1]);
    assert.deepEqual(relative, []);
});

test('vite build emits the architecture page next to the loader', () => {
    const config = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');
    assert.match(config, /fileName: 'lce-architecture\.html'/);
    assert.match(config, /plugins: \[[^\]]*emitArchitecturePagePlugin\(\)/);
});
