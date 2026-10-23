import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runtime, Element } from './helpers/runtime.mjs';

// ───────── i18n loadScript：只能執行自家來源的腳本 ─────────
async function loadEngine(fetchImpl) {
    const rt = runtime({ globals: { fetch: fetchImpl, Function: globalThis.Function } });
    await rt.load('src/core/i18n-engine.js');
    return { rt, api: rt.window.Liko.__Sys_i18n__ };
}

test('loadScript refuses scripts from origins outside the allow-list without fetching them', async () => {
    const fetched = [];
    const { api, rt } = await loadEngine(async url => { fetched.push(url); return { ok: true, text: async () => '' }; });
    for (const url of [
        'https://evil.example/x.js',
        'http://awdrrawd.github.io/x.js',                       // 非 https
        'https://awdrrawd.github.io.evil.example/x.js',         // 網域後綴偽裝
        'https://awdrrawd.github.io@evil.example/x.js',         // userinfo 偽裝
        'https://cdn.jsdelivr.net/gh/someone-else/repo@main/x.js', // jsDelivr 但不是自家 repo
        '/relative/path.js',
        'javascript:alert(1)',
        'data:text/javascript,alert(1)',
    ]) {
        assert.equal(await api.loadScript(url), false, url);
    }
    assert.deepEqual(fetched, [], 'blocked URLs must never be fetched');
    assert.ok(rt.warnings.some(w => String(w[0]).includes('blocked')));
});

test('loadScript still runs scripts from the project origins', async () => {
    const urls = [
        'https://awdrrawd.github.io/BC-LCE/lang.js',
        'https://cdn.jsdelivr.net/gh/awdrrawd/liko-Plugin-Repository@main/Plugins/expand/x.js',
    ];
    const fetched = [];
    const { api } = await loadEngine(async url => { fetched.push(url); return { ok: true, text: async () => '/* noop */' }; });
    for (const url of urls) assert.equal(await api.loadScript(url), true, url);
    assert.equal(fetched.length, 2);
});

// ───────── relogin：快照用節點複本，不再把字串重新當 HTML 解析 ─────────
test('chat snapshot restore clones nodes and never parses HTML strings', async () => {
    const log = new Element('div'); log.id = 'TextAreaChatLog';
    const mk = (text, extra = {}) => {
        const el = new Element('div', '', true); el.className = 'ChatMessage'; el.append(text);
        Object.assign(el.attributes, extra); return el;
    };
    const first = mk('hello', { onclick: 'alert(1)' }), second = mk('world');
    log.append(first, second);

    class FakeObserver { observe() {} disconnect() {} }
    const rt = runtime({
        globals: { MutationObserver: FakeObserver, ServerSocket: { connected: true, on() {}, off() {}, disconnect() {} },
                   Player: { AccountName: 'A', MemberNumber: 1 } },
        mocks: {
            'src/core/feature-settings.js': { getFeature: key => key === 'relogin' },
            'src/core/wce-compat.js': { shouldLceHandle: () => true },
            'src/storage/reconnect-credentials.js': {
                cacheReconnectPassword: () => true, getReconnectPassword: () => null, warmReconnectPassword: async () => null,
            },
        },
    });
    rt.document.body.append(log);
    const relog = await rt.load('src/features/safety/relogin.js');
    relog.installRelogin();

    rt.hooks.get('ServerDisconnect')(['ServerDisconnect', false], args => args);
    assert.equal(relog.debugRelogSnapshot().snapshotCount, 2);

    first.remove(); second.remove();   // BC 重建 ChatLog 時清空
    rt.hooks.get('ChatRoomSync')([], args => args);

    const restored = log.querySelectorAll('.ChatMessage');
    assert.equal(restored.length, 2);
    assert.deepEqual(restored.map(n => n.textContent), ['hello', 'world']);
    assert.ok(restored.every(n => n !== first && n !== second), 'restored nodes must be fresh clones');
    assert.ok(restored.every(n => n.dataset.lceRelogRestored), 'restored nodes are tagged');
    assert.equal(rt.warnings.length, 0, JSON.stringify(rt.warnings));
});

test('relogin source no longer reparses snapshot HTML', () => {
    const src = fs.readFileSync('src/features/safety/relogin.js', 'utf8');
    assert.ok(!/\.innerHTML\s*=\s*snap/.test(src));
    assert.ok(!/outerHTML/.test(src.replace(/\/\/.*$/gm, '')));
});

// ───────── 建置：app chunk 必須有內容 hash ─────────
test('vite config hashes JS chunk file names while keeping the entry name stable', () => {
    const cfg = fs.readFileSync('vite.config.js', 'utf8');
    assert.match(cfg, /entryFileNames:\s*'assets\/\[name\]\.js'/);
    assert.match(cfg, /chunkFileNames:\s*'assets\/\[name\]-\[hash\]\.js'/);
});

// ───────── pending-messages：房內其他玩家控制的 Dictionary 不能進 CSS 選擇器 ─────────
test('pending messages only look up purely numeric nonces, never attacker-supplied selector text', async () => {
    const rt = runtime({ mocks: { 'src/core/wce-compat.js': { shouldLceHandle: () => true } } });
    const selectors = [];
    rt.document.querySelector = selector => { selectors.push(selector); return null; };
    const { installPendingMessages } = await rt.load('src/features/chat/pending-messages.js');
    installPendingMessages();
    const chatRoomMessage = rt.hooks.get('ChatRoomMessage');
    assert.ok(chatRoomMessage, 'ChatRoomMessage hook installed');
    const message = text => ({ Content: 'hi', Type: 'Chat', Dictionary: [{ Tag: 'lce_nonce', Text: text }] });
    for (const hostile of [
        "']", "'],#TextAreaChatLog,[x='", "1'] , body > * , [a='", '1\n2', '', 'abc', '12345678901234567', -1, { toString: () => "'],*,['" },
    ]) chatRoomMessage.call(null, [message(hostile)], () => undefined);
    assert.deepEqual(selectors.filter(s => s.includes('data-nonce')), [], 'hostile nonce text must never reach querySelector');
    chatRoomMessage.call(null, [message('42')], () => undefined);
    assert.deepEqual(selectors.filter(s => s.includes('data-nonce')), ["[data-nonce='42']"], 'our own numeric nonce still works');
});

// ───────── chat-augments：聊天室裡的外部連結不可洩漏 Referer ─────────
test('chat links to external sites open with rel=noopener noreferrer', async () => {
    const rt = runtime({ mocks: {
        'src/core/wce-compat.js': { shouldLceHandle: () => true },
        'src/features/trusted-domains.js': { isTrustedOrigin: () => false, requestOriginTrust: async () => 'cancel', sessionCustomOrigins: new Map() },
        'src/ui/chat/pipeline.js': { registerChatProcessor() {} },
    } });
    const { processChatAugmentsForLine } = await rt.load('src/features/chat/chat-augments.js');
    const line = rt.document.createElement('div');
    line.append(rt.document.createTextNode('see https://example.org/page now'));
    processChatAugmentsForLine(line, () => {}, false);
    const link = line.querySelector('a');
    assert.ok(link, 'URL was turned into a link');
    assert.equal(link.target, '_blank');
    assert.equal(link.rel, 'noopener noreferrer');
});
