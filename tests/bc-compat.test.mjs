import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
    checkPatchPatterns, collectHookedFunctions, compare, crc32, fingerprint, hashSource, loadBcFunctions, scanSource,
} from '../scripts/check-bc-compat.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/check-bc-compat.mjs', import.meta.url));
const PROJECT = fileURLToPath(new URL('../', import.meta.url));

function workspace() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lce-bc-hooks-'));
    const write = (file, text) => {
        const target = path.join(dir, file);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, text);
    };
    return { dir, write, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('crc32 equals ModSDK originalHash (LF and CRLF sources)', () => {
    assert.equal(crc32('123456789'), 'CBF43926');
    const sdkText = fs.readFileSync(new URL('../src/modsdk.js', import.meta.url), 'utf8').match(/^var bcModSdk=.*\}\(\);$/m)?.[0];
    assert.ok(sdkText, 'bundled ModSDK source is found');
    const sandbox = vm.createContext({ TextEncoder, console, alert() {} });
    vm.runInContext(`var window = globalThis; ${sdkText}`, sandbox);
    vm.runInContext('function SampleLf(a) {\r\n  return a + "é";\r\n}\nfunction SampleCrlf(b) { return b; }', sandbox);
    // ModSDK 一被問到某函式就會把全域換成 router，所以先讀原始碼。
    const originals = Object.fromEntries(['SampleLf', 'SampleCrlf'].map(name => [name, vm.runInContext(`${name}.toString()`, sandbox)]));
    const api = vm.runInContext('bcModSdk.registerMod({name: "hash-test", fullName: "hash-test", version: "1"})', sandbox);
    for (const [name, source] of Object.entries(originals)) assert.equal(api.getOriginalHash(name), hashSource(source), name);
});

test('scanSource finds every LCE hook style and ignores wrappers and comments', () => {
    const found = scanSource([
        "const hook = createHook('x');",
        "// hook('InComment', 1, f);",
        "hook('Alpha', 10, f);",
        "registerHook('Beta', 10, f);",
        "modApi.hookFunction(`Gamma`, 10, f);",
        "modApi.callOriginal('Delta', args);",
        "createHook('inline')('Ns.method', 10, f);",
        "patch('Epsilon', { 'a b': 'c', plain: 'd', 'gone': null });",
        "function patch(name, patches) { modApi.patchFunction(name, patches); }",
        "const wrap = (name, prio, fn) => modApi.hookFunction(name, prio, fn);",
        "const ALTS = ['AltOne', 'AltTwo'];",
        "for (const fn of ['PoseA', 'PoseB']) hook(fn, 5, f);",
        "for (const fn of ALTS) hook(fn, 5, f);",
        "const runtimeName = compute(); hook(runtimeName, 1, f);",
        "hook('not a function name', 1, f);",
    ].join('\n'), 'src/sample.js');
    assert.equal(found.parseError, undefined);
    const names = found.names.map(item => item.name).sort();
    assert.deepEqual(names, ['Alpha', 'AltOne', 'AltTwo', 'Beta', 'Delta', 'Epsilon', 'Gamma', 'Ns.method', 'PoseA', 'PoseB']);
    assert.equal(found.names.find(item => item.name === 'Alpha').location, 'src/sample.js:3');
    assert.equal(found.names.find(item => item.name === 'PoseA').group, found.names.find(item => item.name === 'PoseB').group);
    assert.equal(found.names.find(item => item.name === 'AltOne').group, found.names.find(item => item.name === 'AltTwo').group);
    assert.deepEqual(found.dynamic, ['src/sample.js:14'], 'only the genuinely runtime-built name is dynamic');
    assert.deepEqual(found.patches.map(item => item.pattern).sort(), ['a b', 'plain']);
    assert.match(scanSource('function (((', 'src/bad.js').parseError, /src\/bad\.js/);
});

test('collectHookedFunctions skips the SDK and hook wrapper files', () => {
    const ws = workspace();
    try {
        ws.write('src/a.js', "hook('Alpha', 1, f);\n");
        ws.write('src/nested/b.js', "hook('Alpha', 2, f); hook('Beta', 1, f);\n");
        ws.write('src/modsdk.js', "hookFunction('Ignored', 1, f);\n");
        ws.write('src/core/hooks.js', "modApi.hookFunction(name, 1, f);\n");
        const hooked = collectHookedFunctions(path.join(ws.dir, 'src'), ws.dir);
        assert.deepEqual([...hooked.names.keys()].sort(), ['Alpha', 'Beta']);
        assert.deepEqual(hooked.names.get('Alpha').locations, ['src/a.js:1', 'src/nested/b.js:1']);
        assert.deepEqual(hooked.dynamic, []);
    } finally { ws.cleanup(); }
});

test('loadBcFunctions indexes hookable targets, including `new class` singletons', () => {
    const ws = workspace();
    try {
        const alpha = 'function Alpha(a) {\n  return a + 1;\n}';
        ws.write('bc/Scripts/Game.js', 'var GameVersion = "R999";\n');
        ws.write('bc/Scripts/A.js', `${alpha}\nasync function Beta() { return 2; }\nvar Gamma = function () { return 3; };\nconst Hidden = () => 0;\nfunction Outer() { function Inner() {} }\n`);
        ws.write('bc/Scripts/Toasts.js', 'var ToastManager = new class { _process() { return 1; } static skip() {} };\nclass Panel { static create() { return 1; } }\nvar Util = { run: function () { return 3; }, value: 5 };\nfunction ExtendedHook() {}\n');
        ws.write('bc/Screens/Room/Broken.js', 'function (((\n');
        const bc = loadBcFunctions(path.join(ws.dir, 'bc'));
        assert.equal(bc.gameVersion, 'R999');
        assert.deepEqual([...bc.functions.keys()].sort(), ['Alpha', 'Beta', 'ExtendedHook', 'Gamma', 'Outer', 'Panel.create', 'ToastManager._process', 'Util.run']);
        assert.equal(bc.functions.get('Alpha').hash, hashSource(alpha));
        assert.equal(bc.parseErrors.length, 1);
        const hooked = { names: new Map(['ToastManager._process', 'Extended', 'Util.value', 'Nope'].map(name => [name, { locations: [] }])) };
        const print = fingerprint(hooked, bc);
        assert.deepEqual(Object.keys(print.functions).sort(), ['Extended', 'ToastManager._process']);
        assert.equal(print.functions.Extended.via, 'Hook');
        assert.deepEqual(print.missing.sort(), ['Nope', 'Util.value']);
    } finally { ws.cleanup(); }
});

test('either-or hook groups only count as missing when no alternative exists', () => {
    const bc = { functions: new Map([['PoseSetActive', { hash: 'AAAAAAAA', file: 'x.js', source: '' }]]) };
    const names = new Map([
        ['CharacterSetActivePose', { locations: [], groups: ['g1'] }],
        ['PoseSetActive', { locations: [], groups: ['g1'] }],
        ['Lonely', { locations: [], groups: ['g2'] }],
    ]);
    const print = fingerprint({ names }, bc);
    assert.deepEqual(print.optional, ['CharacterSetActivePose']);
    assert.deepEqual(print.missing, ['Lonely']);
});

test('patch patterns that vanished from BC are reported', () => {
    const bc = { functions: new Map([['Draw', { source: 'function Draw() {\n  DrawText(a, b);\n}', file: 'Scripts/D.js' }]]) };
    const hooked = { patches: [
        { name: 'Draw', pattern: 'DrawText(a, b)', location: 'src/x.js:1' },
        { name: 'Draw', pattern: 'DrawImage(a, b)', location: 'src/x.js:2' },
        { name: 'Removed', pattern: 'anything', location: 'src/x.js:3' },
    ] };
    const misses = checkPatchPatterns(hooked, bc);
    assert.deepEqual(misses.map(item => item.pattern), ['DrawImage(a, b)'], 'unknown functions are left to the missing-function report');
    const current = { functions: {}, missing: [] };
    assert.equal(compare({ functions: {} }, current, misses).drift, true);
    assert.equal(compare({ functions: {} }, current, []).drift, false);
});

test('compare classifies changed, added, stale and missing hooks', () => {
    const current = { functions: { Alpha: { hash: '11111111', file: 'a' }, Beta: { hash: '22222222', file: 'b' }, New: { hash: '33333333', file: 'n' } }, missing: ['Gone'] };
    const result = compare({ functions: { Alpha: { hash: '00000000' }, Beta: { hash: '22222222' }, Old: { hash: '44444444' } } }, current);
    assert.deepEqual(result.changed.map(item => item.name), ['Alpha']);
    assert.deepEqual([result.added, result.stale, result.missing], [['New'], ['Old'], ['Gone']]);
    assert.equal(result.drift, true);
});

test('CLI exit codes against a fixture BC that defines every function LCE hooks', () => {
    const ws = workspace();
    try {
        const real = collectHookedFunctions(path.join(PROJECT, 'src'), PROJECT);
        assert.ok(real.names.size > 50, 'LCE hooks many BC functions');
        assert.deepEqual(real.dynamic, [], 'every LCE hook name is statically checkable (annotate or refactor new dynamic ones)');
        // 每個被 patch 的函式，fixture 內放入它所有 pattern，讓 pattern 檢查能通過。
        const patchBody = name => real.patches.filter(item => item.name === name).map(item => item.pattern).join('\n');
        const functionText = name => `function ${name}() { return '${name}'; /*${patchBody(name)}*/ }\n`;
        const topLevel = [...real.names.keys()].filter(name => !name.includes('.'));
        const namespaced = [...new Set([...real.names.keys()].filter(name => name.includes('.')).map(name => name.split('.')[0]))];
        const body = (changedName) => [
            ...topLevel.map(name => name === changedName ? `function ${name}() { return 'changed'; /*${patchBody(name)}*/ }\n` : functionText(name)),
            ...namespaced.map(ns => `var ${ns} = { ${[...real.names.keys()].filter(name => name.startsWith(`${ns}.`)).map(name => `${name.split('.')[1]}() { return '${name}'; /*${patchBody(name)}*/ }`).join(', ')} };\n`),
        ].join('');
        ws.write('fixture/Scripts/Game.js', 'var GameVersion = "R-test";\n');
        ws.write('fixture/Scripts/All.js', body());
        const run = (...args) => {
            const env = { ...process.env };
            delete env.BC_DIR;
            return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env });
        };
        const baseline = path.join(ws.dir, 'baseline.json');
        const fixture = path.join(ws.dir, 'fixture');
        assert.equal(run('--nonsense').status, 2, 'unknown arguments are rejected');
        assert.equal(run('--bc-dir', fixture, '--baseline', baseline).status, 2, 'a missing baseline is a usage error');
        const update = run('--bc-dir', fixture, '--baseline', baseline, '--update');
        assert.equal(update.status, 0, update.stdout + update.stderr);
        assert.equal(run('--bc-dir', fixture, '--baseline', baseline).status, 0, 'unchanged source is in sync');

        const victim = topLevel[0];
        ws.write('fixture/Scripts/All.js', body(victim));
        const report = path.join(ws.dir, 'report.md');
        assert.equal(run('--bc-dir', fixture, '--baseline', baseline, '--report', report).status, 1, 'a changed hooked function is drift');
        assert.match(fs.readFileSync(report, 'utf8'), new RegExp(`- ${victim} \\(Scripts/All\\.js\\)`));

        ws.write('fixture/Scripts/All.js', body().replace(topLevel.map(name => functionText(name))[1], ''));
        assert.equal(run('--bc-dir', fixture, '--baseline', baseline).status, 1, 'a removed BC function is drift');
    } finally { ws.cleanup(); }
});

test('the committed baseline lists the functions LCE currently hooks', () => {
    const baseline = JSON.parse(fs.readFileSync(path.join(PROJECT, 'scripts', 'bc-compat-baseline.json'), 'utf8'));
    const real = collectHookedFunctions(path.join(PROJECT, 'src'), PROJECT);
    const known = new Set(Object.keys(baseline.functions));
    // 基準只放 BC 裡真的存在的函式；擇一組的缺席成員與 BC 版本專屬的函式可以不在。
    const unknown = [...real.names.keys()].filter(name => !known.has(name) && !(real.names.get(name).groups?.length));
    assert.deepEqual(unknown, [], 'run `npm run check:bc -- --bc-dir <BC> --update` after adding a hook');
    assert.match(baseline.gameVersion, /^R\d+/);
});
