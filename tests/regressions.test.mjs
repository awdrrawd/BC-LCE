import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime, documentFixture, Element } from './helpers/runtime.mjs';

test('cache controls yield dynamically to WCE and cancel a waiting automatic clear', async () => {
    const wce = { manualCacheClear: true, automateCacheClear: true };
    let interval, retry, refreshes = 0;
    const player = { FBC: '6.3.19', MemberNumber: 1, IsOnline: () => true };
    const rt = runtime({ globals: { Player: player, FBC_VERSION: '6.3.19', fbcSettingValue: key => wce[key],
        Character: [player], ChatRoomCharacter: [player], CurrentScreen: 'ChatRoom', CurrentCharacter: null,
        CharacterRefresh: () => refreshes++, CharacterDelete: () => assert.fail('player removed'),
        ChatRoomMenuButtons: ['Cut', 'clearCache', 'lceClearCache'],
        setInterval: callback => { interval = callback; return 1; }, setTimeout: callback => { retry = callback; return 2; } } });
    rt.document.hasFocus = () => true;
    const settings = await rt.load('src/core/feature-settings.js');
    settings.setFeature('manualCacheClear', true); settings.setFeature('automateCacheClear', true);
    const textures = await rt.load('src/features/performance/textures.js'); textures.installTexturePerformance();
    const build = rt.hooks.get('ChatRoomMenuBuild'); build([], () => {});
    assert.deepEqual(Array.from(rt.context.ChatRoomMenuButtons), ['Cut', 'clearCache']);
    interval(); assert.equal(refreshes, 0);
    wce.manualCacheClear = false; build([], () => {});
    assert.equal(rt.context.ChatRoomMenuButtons.filter(x => x === 'lceClearCache').length, 1);
    wce.automateCacheClear = false; interval(); assert.equal(refreshes, 1);
    rt.context.CurrentScreen = 'Preference'; interval(); assert.equal(typeof retry, 'function');
    wce.automateCacheClear = true; rt.context.CurrentScreen = 'ChatRoom'; retry(); assert.equal(refreshes, 1);
});

test('whisper reset yields to WCE even if WCE takes ownership after the timer starts', async () => {
    let wceEnabled = false, callback, resets = 0;
    const rt = runtime({ globals: { Player: { FBC: '6.3.19' }, FBC_VERSION: '6.3.19',
        fbcSettingValue: key => key === 'whisperTargetFixes' && wceEnabled,
        ChatRoomTargetMemberNumber: 2, ChatRoomSetTarget: () => resets++,
        setTimeout: cb => { callback = cb; return 1; } } });
    const settings = await rt.load('src/core/feature-settings.js'); settings.setFeature('whisperTargetReset', true);
    const feature = await rt.load('src/features/chat/whisper-target.js'); feature.installWhisperTarget();
    rt.hooks.get('ChatRoomMessageDisplay')([{ Type: 'Action', Sender: 2, Content: 'ServerLeave' }], () => {});
    wceEnabled = true; callback(); assert.equal(resets, 0);
    wceEnabled = false;
    rt.hooks.get('ChatRoomMessageDisplay')([{ Type: 'Action', Sender: 2, Content: 'ServerLeave' }], () => {});
    callback(); assert.equal(resets, 1);
});

test('hook registration exposes failures and clears them after successful retry', async () => {
    let fail = true;
    const rt = runtime({ mocks: { 'src/modsdk.js': { default: { hookFunction() {
        if (fail) throw Error('missing target'); return () => {};
    } } } } });
    const { createHook } = await rt.load('src/core/hooks.js');
    const hook = createHook('test');
    assert.equal(typeof hook('Missing', 1, () => {}), 'function');
    assert.equal(hook.getFailures()[0].name, 'Missing');
    fail = false; hook('Missing', 1, () => {}); assert.equal(hook.getFailures().length, 0);
});

test('IM history read failure blocks writes and can retry without erasing saved history', async () => {
    let fail = true, writes = 0;
    const rt = runtime({ mocks: { idb: { openDB: async () => ({
        get: async () => { if (fail) throw Error('read failed'); return { saved: true }; },
        put: async () => { writes++; },
    }) } } });
    const { createHistoryRepository } = await rt.load('src/features/messenger/history.js');
    const repo = createHistoryRepository(() => 'alice');
    await assert.rejects(repo.restore(() => assert.fail('must not render empty history')), /read failed/);
    assert.equal(await repo.save({}), false); assert.equal(writes, 0);
    fail = false; let restored;
    await repo.restore(value => { restored = value; }); assert.equal(restored.saved, true);
    assert.equal(await repo.save(restored), true); assert.equal(writes, 1);
});

test('settings report local persistence and action failures instead of success', async () => {
    const rt = runtime({ globals: { LogAdd() { throw Error('denied'); } } });
    const settings = await rt.load('src/core/feature-settings.js'); settings.initGlobalFeatures();
    assert.equal(settings.runSettingAction('grantWardrobe'), false);
    rt.context.localStorage.setItem = () => { throw Error('quota'); };
    assert.equal(settings.setFeature('themeMainColor', '#123456'), false);
    assert.equal(settings.getFeature('themeMainColor'), '#123456'); // Applied in memory, not falsely rolled back.
});

test('pose selection also resolves conflicts below the highest priority', async () => {
    const { resolvePoseConflicts } = await runtime().load('src/features/expressions/calculations.js');
    const result = resolvePoseConflicts({ BodyUpper: { Priority: 3, Id: 3 },
        BodyLower: { Priority: 2, Id: 2 }, BodyAddon: { Priority: 1, Id: 1 } },
        { BodyUpper: { Conflicts: ['BodyFull'] }, BodyLower: { Conflicts: ['BodyFull', 'BodyAddon'] } });
    assert.deepEqual(Object.keys(result), ['BodyUpper', 'BodyLower']);
});

test('pose conflicts prefer priority, then newest ID, without mutating selection', async () => {
    const { resolvePoseConflicts } = await runtime().load('src/features/expressions/calculations.js');
    const categories = { BodyFull: { Conflicts: ['BodyUpper', 'BodyLower'] },
        BodyUpper: { Conflicts: ['BodyFull'] }, BodyLower: { Conflicts: ['BodyFull'] } };
    const original = { BodyFull: { Priority: 2, Id: 1 }, BodyUpper: { Priority: 1, Id: 9 }, BodyLower: { Priority: 1, Id: 10 } };
    assert.deepEqual(Object.keys(resolvePoseConflicts(original, categories)), ['BodyFull']);
    assert.equal(Object.keys(original).length, 3);
    const tied = { ...original, BodyUpper: { Priority: 2, Id: 9 } };
    assert.deepEqual(Object.keys(resolvePoseConflicts(tied, categories)), ['BodyUpper', 'BodyLower']);
    assert.deepEqual(Object.keys(resolvePoseConflicts({}, categories)), []);
    const custom = { Custom: { Priority: 3, Id: 1 } };
    assert.deepEqual(Object.keys(resolvePoseConflicts(custom, categories)), ['Custom']);
});

test('expression timeline handles boundaries, zero steps and indefinite holds consistently', async () => {
    const { activeStepIndex, isEventActive } = await runtime().load('src/features/expressions/calculations.js');
    const steps = [{ Duration: 0 }, { Duration: 100 }, { Duration: 200 }, { Duration: -1 }];
    assert.equal(activeStepIndex(steps, 0), 1);
    assert.equal(activeStepIndex(steps, 99), 1);
    assert.equal(activeStepIndex(steps, 100), 2);
    assert.equal(activeStepIndex(steps, 300), 3);
    assert.equal(activeStepIndex(steps, 999999), 3);
    assert.equal(activeStepIndex(steps.slice(0, 3), 300), -1);
    assert.equal(activeStepIndex([], 0), -1);
    assert.equal(isEventActive({ At: 100, Until: 200 }, 199), true);
    assert.equal(isEventActive({ At: 100, Until: 200 }, 200), false);
    assert.equal(isEventActive({ At: 100, Until: 99 }, 999999), true);
});

test('expression events isolate templates, mirror eyes and preserve timing and explicit priorities', async () => {
    const { prepareExpressionEvent } = await runtime().load('src/features/expressions/calculations.js');
    let id = 0;
    const source = { Type: 'Activity', Duration: 1000, Priority: 0,
        Expression: { Eyes: [{ Expression: 'Closed', Priority: 0 }] }, Poses: [{ Pose: 'Kneel' }] };
    const event = prepareExpressionEvent(source, 500, () => ++id);
    assert.equal(event.At, 500); assert.equal(event.Until, 1500); assert.equal(event.Priority, 0);
    assert.equal(event.Expression.Eyes2[0].Expression, 'Closed');
    assert.equal(event.Expression.Eyes[0].Duration, 1000); assert.equal(event.Expression.Eyes[0].Priority, 0);
    assert.equal(event.Poses[0].Priority, 1);
    assert.equal(new Set([event.Id, event.Expression.Eyes[0].Id, event.Expression.Eyes2[0].Id, event.Poses[0].Id]).size, 4);
    event.Expression.Eyes2[0].Expression = 'Open';
    assert.equal(event.Expression.Eyes[0].Expression, 'Closed');
    assert.equal(source.Expression.Eyes2, undefined); assert.equal(source.Expression.Eyes[0].Id, undefined);
    for (const patch of [{ SingleEye: true }, { Type: 'ManualOverride' }, { Type: 'AutomatedByArousal' }]) {
        const single = prepareExpressionEvent({ ...source, ...patch, Duration: -1 }, 500, () => ++id);
        assert.equal(single.Expression.Eyes2, undefined); assert.equal(single.Expression.Eyes[0].Duration, -1);
    }
});

test('transform completion ignores child events, runs once, and supports timeout and cancellation', async () => {
    const timers = new Map(); let id = 0, completed = 0;
    const rt = runtime({ globals: { setTimeout: callback => { timers.set(++id, callback); return id; },
        clearTimeout: key => timers.delete(key) } });
    const { finishTransform } = await rt.load('src/ui/transition.js');
    const track = new Element('div'); const child = new Element('div');
    finishTransform(track, () => completed++);
    track.dispatchEvent({ type: 'transitionend', target: child, propertyName: 'transform' });
    track.dispatchEvent({ type: 'transitionend', target: track, propertyName: 'opacity' });
    assert.equal(completed, 0);
    track.dispatchEvent({ type: 'transitionend', target: track, propertyName: 'transform' });
    assert.equal(completed, 1); assert.equal(timers.size, 0);
    track.dispatchEvent({ type: 'transitioncancel', target: track, propertyName: 'transform' });
    assert.equal(completed, 1);
    finishTransform(track, () => completed++); [...timers.values()][0]();
    assert.equal(completed, 2); assert.equal(timers.size, 0);
    const cancel = finishTransform(track, () => completed++); const late = [...timers.values()][0];
    cancel(); late(); assert.equal(completed, 2); assert.equal(timers.size, 0);
});

test('room cards render text safely and resolve replaced native join buttons at click time', async () => {
    const document = documentFixture(true);
    let oldClicks = 0, newClicks = 0, fallback = 0;
    const rt = runtime({ globals: { document, ChatSearchClickRoom: () => { fallback++; } },
        mocks: { 'src/features/vertical/relations.js': { getRoomRelations: () => [] } } });
    const old = document.createElement('button'); old.id = 'chat-search-room-join-button-7'; old.click = () => { oldClicks++; };
    document.body.append(old);
    const view = await rt.load('src/features/vertical/room-view.js');
    const card = view.buildRoomCard({ Order: 7, Name: '<img src=x>', Description: '<b>room</b>', CanJoin: true });
    assert.equal(card.querySelector('.lce-csh-card-name').textContent, '<img src=x>');
    assert.equal(card.querySelector('img'), null);
    old.remove();
    const replacement = document.createElement('button'); replacement.id = old.id; replacement.click = () => { newClicks++; };
    document.body.append(replacement);
    card.dispatchEvent({ type: 'click' }); assert.equal(oldClicks, 0); assert.equal(newClicks, 1);
    replacement.remove(); card.dispatchEvent({ type: 'click' }); assert.equal(fallback, 1);
    card.querySelector('.lce-csh-card-info').dispatchEvent({ type: 'click', stopPropagation() {} });
    assert.ok(document.getElementById('lce-csh-info-backdrop'));
    view.cshCloseRoomInfo(); assert.equal(document.getElementById('lce-csh-info-backdrop'), null);
});

test('frame performance skips only game frames and restores canvas state after a drawing failure', async () => {
    let scheduled = 0;
    const ctx = { textAlign: 'original', textBaseline: 'alphabetic', font: '36px sans-serif' };
    const rt = runtime({ globals: { TimerLastTime: 100, requestAnimationFrame: () => { scheduled++; return 7; },
        CommonGetFont: () => '26px sans-serif', DrawText: () => { throw Error('draw failed'); } } });
    rt.window.MainCanvas = { getContext: () => ctx };
    const settings = await rt.load('src/core/feature-settings.js'); settings.initGlobalFeatures();
    const frames = await rt.load('src/features/performance/frames.js'); frames.installFramePerformance();
    settings.setFeature('lowFrameRateFpsEnabled', true);
    let runs = 0; const next = () => { runs++; return 'drawn'; };
    rt.hooks.get('GameRun')([110], next); assert.equal(runs, 0); assert.equal(scheduled, 1);
    assert.equal(rt.hooks.get('GameRun')([150], next), 'drawn');
    settings.setFeature('showFpsEnabled', true);
    rt.hooks.get('DrawProcess')([100], next); rt.hooks.get('DrawProcess')([120], next);
    assert.equal(ctx.textAlign, 'original'); assert.equal(ctx.textBaseline, 'alphabetic');
    assert.equal(ctx.font, '36px sans-serif');
    assert.equal(rt.hooks.get('DrawTextFit')(['50', 15, 12, 30], next), undefined);
    settings.setFeature('showFpsEnabled', false);
    assert.equal(rt.hooks.get('DrawTextFit')(['50', 15, 12, 30], next), 'drawn');
});

test('performance entry installs independent subsystems once and preserves cache API', async () => {
    let intervals = 0;
    const rt = runtime({ globals: { setInterval: () => ++intervals } });
    const entry = await rt.load('src/features/performance/index.js');
    const textures = await rt.load('src/features/performance/textures.js');
    entry.installPerformance(); const count = rt.hooks.size; entry.installPerformance();
    assert.equal(rt.hooks.size, count); assert.equal(intervals, 1);
    for (const name of ['GameRun', 'DrawProcess', 'ChatRoomSync', 'GLDrawBingImageToTextureInfo']) assert.ok(rt.hooks.has(name));
    assert.equal(entry.doClearCaches, textures.doClearCaches);
});

test('theme actions restore only theme keys and reject malformed snapshots atomically', async () => {
    const rt = runtime();
    const settings = await rt.load('src/core/feature-settings.js'); settings.initGlobalFeatures();
    settings.setFeature('themeEnabled', true);
    settings.setFeature('themeMainColor', '#123456'); settings.runSettingAction('saveThemeSlot');
    settings.setFeature('themeMainColor', '#abcdef'); settings.runSettingAction('loadThemeSlot');
    assert.equal(settings.getFeature('themeMainColor'), '#123456');
    settings.setFeature('themeSlots', [{ themeMainColor: '#654321', themeAccentColor: 123, animationEngine: true }, null, null]);
    assert.equal(settings.runSettingAction('loadThemeSlot'), false);
    assert.equal(settings.getFeature('themeMainColor'), '#123456');
    assert.equal(settings.getFeature('animationEngine'), false);
    settings.runSettingAction('resetTheme');
    assert.equal(settings.getFeature('themeMainColor'), '#202020');
    assert.equal(settings.getFeature('themeEnabled'), true);
});

test('animation settings preserve dependent features on initialization and disable them on manual shutdown', async () => {
    const player = { ArousalSettings: { AffectExpression: true } };
    const rt = runtime({ globals: { Player: player } });
    const { applyAnimationEngineSetting } = await rt.load('src/game/setting-effects.js');
    const draft = { autoArousalExpression: true, activityExpressions: true };
    applyAnimationEngineSetting(false, true, draft);
    assert.equal(draft.activityExpressions, true); assert.equal(draft.autoArousalExpression, true);
    applyAnimationEngineSetting(true, false, draft); assert.equal(player.ArousalSettings.AffectExpression, false);
    applyAnimationEngineSetting(false, false, draft);
    assert.equal(draft.activityExpressions, false); assert.equal(draft.autoArousalExpression, false);
    const absent = await runtime().load('src/game/setting-effects.js');
    assert.doesNotThrow(() => absent.applyAnimationEngineSetting(true, true, draft));
});

test('IM codec preserves interoperable metadata, shorthand and multiline text', async () => {
    const codec = await runtime().load('src/features/messenger/codec.js');
    for (const [input, text, type] of [
        ['hello\nworld', 'hello\nworld', 'Message'], ['/me waves', ' waves', 'Emote'],
        ["/me 's hat", "'s hat", 'Emote'], ['*waves', ' waves', 'Emote'],
        ['/action door opens', 'door opens', 'Action'], ['**door opens', 'door opens', 'Action'],
    ]) {
        const wire = codec.composeMessage(input, '#123456');
        const decoded = codec.decodeMessage(wire);
        assert.equal(decoded.messageText, text); assert.equal(decoded.messageType, type);
        assert.equal(decoded.messageColor, '#123456');
        assert.equal(wire, `${text}\n\n${JSON.stringify({ messageType: type, messageColor: '#123456' })}`);
        assert.equal(codec.stripBeepMetadata(wire), text.trimEnd());
    }
    for (const metadata of ['null', 'false', '{broken', '{"messageType":"unexpected","messageColor":{}}']) {
        const result = codec.decodeMessage(`hello\n${metadata}`);
        assert.equal(result.messageText, 'hello'); assert.equal(result.messageType, 'Message');
        assert.equal(result.messageColor, '#ffffff');
    }
});

test('IM message view renders untrusted names and text without HTML interpretation', async () => {
    const rt = runtime({ globals: { document: documentFixture(true) }, mocks: { idb: { openDB: async () => ({}) } }, append: { 'src/features/messenger/index.js': '\nexport { renderMessage };' } });
    const { renderMessage } = await rt.load('src/features/messenger/index.js');
    const base = { messageText: '<img src=x>', messageColor: '#123456', author: '<b>name</b>',
        sent: false, createdAt: new Date(0) };
    const normal = renderMessage({ ...base, messageType: 'Message' });
    assert.equal(normal.textContent, '<b>name</b>: <img src=x>'); assert.equal(normal.querySelector('img'), null);
    assert.equal(normal.querySelector('span').style.color, '#123456');
    assert.equal(renderMessage({ ...base, messageType: 'Action' }).textContent, '*<img src=x>*');
    assert.equal(renderMessage({ ...base, messageType: 'Emote' }).textContent, '*<b>name</b><img src=x>*');
});

test('chat pipeline processes only changed messages and rescans on enable or log replacement', async () => {
    const observers = []; let tick; let intervals = 0; let cleared = 0;
    class Observer {
        constructor(callback) { this.callback = callback; observers.push(this); }
        observe(root) { this.root = root; }
        disconnect() { this.disconnected = true; }
    }
    const rt = runtime({ globals: { MutationObserver: Observer,
        setInterval: callback => { tick = callback; return ++intervals; }, clearInterval: () => { cleared++; } } });
    const log = rt.document.createElement('div'); log.id = 'TextAreaChatLog'; rt.document.body.append(log);
    const old = rt.document.createElement('div'); old.className = 'ChatMessage'; log.append(old);
    const { registerChatProcessor } = await rt.load('src/ui/chat/pipeline.js');
    const seen = []; let enabled = true;
    const stop = registerChatProcessor({ selector: '.ChatMessage', enabled: () => enabled, process: node => seen.push(node) });
    assert.deepEqual(seen, [old]); seen.length = 0;
    tick(); tick(); assert.equal(seen.length, 0);
    const added = rt.document.createElement('div'); added.className = 'ChatMessage'; log.append(added);
    observers[0].callback([{ type: 'childList', target: log, addedNodes: [added, added] }]);
    assert.deepEqual(seen, [added]); seen.length = 0;
    enabled = false; tick();
    observers[0].callback([{ type: 'childList', target: added, addedNodes: [] }]); assert.equal(seen.length, 0);
    enabled = true; tick(); assert.deepEqual(seen, [old, added]); seen.length = 0;
    log.remove();
    const replacement = rt.document.createElement('div'); replacement.id = 'TextAreaChatLog';
    const restored = rt.document.createElement('div'); restored.className = 'ChatMessage'; replacement.append(restored);
    rt.document.body.append(replacement); tick(); assert.deepEqual(seen, [restored]);
    assert.equal(observers[0].disconnected, true);
    const stopSecond = registerChatProcessor({ selector: '.ChatMessage', enabled: () => true, process() {} });
    assert.equal(intervals, 1); stop(); assert.equal(cleared, 0);
    stopSecond(); assert.equal(cleared, 1); assert.equal(observers[1].disconnected, true);
});

test('pending chat messages are augmented after confirmation, without duplicate processing', async () => {
    let callback;
    const rt = runtime({ globals: { CurrentScreen: 'ChatRoom', ElementIsScrolledToEnd: () => false,
        MutationObserver: class { constructor(cb) { callback = cb; } observe() {} disconnect() {} } },
        mocks: { 'src/core/wce-compat.js': { shouldLceHandle: () => true } } });
    const log = rt.document.createElement('div'); log.id = 'TextAreaChatLog'; rt.document.body.append(log);
    const msg = rt.document.createElement('div'); msg.className = 'ChatMessage ChatMessageChat lce-pending';
    msg.append('https://example.com/page'); log.append(msg);
    const { installChatAugments } = await rt.load('src/features/chat/chat-augments.js'); installChatAugments();
    assert.equal(msg.getAttribute('data-lce-handled'), null); assert.equal(msg.querySelector('a'), null);
    msg.classList.remove('lce-pending'); callback([{ type: 'attributes', target: msg }]);
    const link = msg.querySelector('a'); assert.ok(link); assert.equal(msg.getAttribute('data-lce-handled'), 'true');
    callback([{ type: 'childList', target: msg, addedNodes: [link] }]);
    assert.equal(msg.querySelector('a'), link); assert.equal(msg.querySelectorAll('a').length, 1);
    msg.textContent = 'https://example.com/changed';
    callback([{ type: 'childList', target: msg, addedNodes: [...msg.childNodes] }]);
    assert.equal(msg.querySelector('a').href, 'https://example.com/changed');
});

test('room search shares native state, enforces gender restrictions and guards stale screens', async () => {
    const queries = [];
    const player = { ChatSearchSettings: { Space: '' }, GetGenders: () => ['F'] };
    const rt = runtime({ globals: { Player: player, ChatSearchSpace: 'X', CurrentScreen: 'ChatSearch',
        ChatSearchQuery: async query => { queries.push(query); } } });
    const search = await rt.load('src/game/room-search.js');
    assert.equal(search.getCurrentSpace(), 'X');
    assert.equal(await search.applySpace('', 'missing DOM'), false);
    const input = rt.document.createElement('input'); input.id = 'InputSearch'; rt.document.body.append(input);
    assert.equal(await search.applySpace(search.getToggleTargetSpace(), 'room name'), true);
    assert.equal(rt.context.ChatSearchSpace, ''); assert.equal(player.ChatSearchSettings.Space, '');
    player.GetGenders = () => ['M'];
    assert.equal(await search.applySpace('', 'restricted'), true);
    assert.equal(rt.context.ChatSearchSpace, 'X'); assert.equal(player.ChatSearchSettings.Space, 'X');
    assert.equal(await search.applySpace('invalid'), false);
    rt.context.CurrentScreen = 'ChatRoom';
    assert.equal(await search.applySpace('', 'late click'), false);
    assert.deepEqual(queries, ['room name', 'restricted']);
});

test('room search prefers the BC accessor and handles rejected queries', async () => {
    const rt = runtime({ globals: { ChatSearchSpace: 'X', ChatSearchGetSpace: () => '',
        CurrentScreen: 'ChatSearch', ChatSearchQuery: async () => { throw Error('offline'); } } });
    const search = await rt.load('src/game/room-search.js');
    assert.equal(search.getCurrentSpace(), '');
    const input = rt.document.createElement('input'); input.id = 'InputSearch'; rt.document.body.append(input);
    assert.equal(await search.applySpace('X'), false); assert.equal(rt.warnings.length, 1);
    const absent = await runtime().load('src/game/room-search.js');
    assert.equal(absent.getCurrentSpace(), 'X'); assert.equal(absent.playerHasMaleGender(), false);
});

test('horizontal region switching follows a preceding vertical switch instead of cached preference', async () => {
    const player = { ChatSearchSettings: { Space: 'X' }, ExtensionSettings: {}, GetGenders: () => ['F'] };
    let syncs = 0;
    const rt = runtime({ globals: { Player: player, ChatSearchSpace: 'X', CurrentScreen: 'ChatSearch',
        ChatSearchQuery: async () => {}, ServerPlayerExtensionSettingsSync: () => { syncs++; } },
        append: { 'src/features/region-switch.js': '\nexport { switchZone };' } });
    const search = await rt.load('src/game/room-search.js');
    const region = await rt.load('src/features/region-switch.js');
    const input = rt.document.createElement('input'); input.id = 'InputSearch'; rt.document.body.append(input);
    await search.applySpace(''); region.switchZone();
    assert.equal(rt.context.ChatSearchSpace, 'X'); assert.equal(player.ExtensionSettings.RegionSwitch, 'Mixed');
    region.switchZone();
    assert.equal(rt.context.ChatSearchSpace, ''); assert.equal(player.ExtensionSettings.RegionSwitch, 'FemaleOnly');
    assert.equal(syncs, 2);
});

test('chat markup treats quotes and HTML as text, preserves existing links, and is idempotent', async () => {
    const document = documentFixture(true);
    const rt = runtime({ globals: { document } });
    const { decorateChatText } = await rt.load('src/ui/chat/markup.js');
    const root = document.createElement('div');
    const payload = 'room" onmouseover="void(0)';
    root.append(document.createTextNode(`#${payload}# /help <img src=x>`));
    const existing = document.createElement('a'); existing.textContent = '#keep#'; root.append(existing);
    const find = key => key === 'help' ? { Description: '<b>plain</b>' } : null;
    decorateChatText(root, find); decorateChatText(root, find);
    const room = root.querySelector('.lceRoom');
    assert.equal(room.dataset.room, payload); assert.equal(room.getAttribute('onmouseover'), null);
    assert.equal(root.querySelectorAll('.lceRoom').length, 1);
    assert.equal(root.querySelector('.lceCmd').dataset.desc, '<b>plain</b>');
    assert.equal(existing.textContent, '#keep#'); assert.equal(root.querySelector('img'), null);
});

test('settings reject invalid keys atomically, normalize bars, and preserve account data before load', async () => {
    const player = { AccountName: 'Alice', ExtensionSettings: { LCE: 'untouched' } };
    const rt = runtime({ globals: { Player: player } });
    const settings = await rt.load('src/core/feature-settings.js');
    settings.initGlobalFeatures();
    assert.equal(settings.getFeature('friendOnlineNotifySound'), true);
    assert.equal(settings.setFeature('textureQualitySound', true), false);
    assert.equal(settings.setFeature('themeEnabled', 'false'), false);
    assert.equal(settings.updateSettings({ themeEnabled: true, nonexistent: true }), false);
    assert.equal(settings.getFeature('themeEnabled'), false);
    settings.setFeature('scrollMaxMessages', -999);
    const schema = await rt.load('src/core/settings-schema.js');
    assert.equal(settings.getFeature('scrollMaxMessages'), schema.DEFAULT_FEATURE_SETTINGS.scrollMaxMessages.min);
    assert.equal(player.ExtensionSettings.LCE, 'untouched');
    settings.setFeature('themeFontEnabled', true);
    assert.equal(rt.events.at(-1).detail.key, 'themeFontEnabled');
    assert.equal(rt.events.at(-1).detail.ownerKey, 'themeFont');
});

test('settings preview emits a complete batch once per owner and commits only when requested', async () => {
    const rt = runtime(); const settings = await rt.load('src/core/feature-settings.js'); settings.initGlobalFeatures();
    const { settingChangeAffects } = await rt.load('src/core/settings-values.js');
    let applies = 0;
    rt.window.addEventListener('lce-setting-changed', e => { if (settingChangeAffects(e, ['themeMainColor', 'themeAccentColor'])) applies++; });
    settings.updateSettings({ themeMainColor: '#123456', themeAccentColor: '#654321' }, { persist: false });
    assert.equal(applies, 1); assert.equal(rt.storage.size, 0);
    settings.saveFeatureSettings(); assert.equal(JSON.parse(rt.storage.get('lce_settings')).features.themeMainColor, '#123456');
    settings.setFeature('themeEnabled', true);
    assert.equal(settings.runSettingAction('saveThemeSlot'), true);
    settings.setFeature('themeMainColor', '#abcdef');
    settings.runSettingAction('loadThemeSlot'); assert.equal(settings.getFeature('themeMainColor'), '#123456');
});

test('permanent image trust survives a fresh session but does not authorize music', async () => {
    const rt = runtime({ mocks: { 'src/core/modal-service.js': { openModalAsync: async () => ['cancel'] } } });
    const trust = await rt.load('src/features/trusted-domains.js');
    trust.addTrustedOrigin('https://images.example/a.svg'); trust.sessionCustomOrigins.clear();
    assert.equal(trust.isTrustedOrigin('https://images.example/b.svg'), true);
    assert.equal(trust.isTrustedOrigin('https://images.example/b.mp3', { persistent: false }), false);
    const settings = await rt.load('src/core/feature-settings.js'); settings.setFeature('customContentDomainCheck', true);
    const misc = await rt.load('src/features/misc.js'); misc.installMisc();
    let called = 0;
    rt.hooks.get('ChatAdminRoomCustomizationProcess')([{ ImageURL: 'https://images.example/a.svg', MusicURL: '' }], () => ++called);
    assert.equal(called, 1);
});

test('wardrobe restores Player and target descriptors when a downstream renderer throws', async () => {
    const real = { Canvas: 'playerCanvas' }, other = { VisualSettings: { Custom: true }, Canvas: 'otherCanvas' };
    const rt = runtime({ globals: { Player: real, CharacterAppearanceSelection: null }, append: {
        'src/features/wardrobe/index.js': 'export function prepare(target) { inCustomWardrobe = true; targetCharacter = target; }',
    } });
    const wardrobe = await rt.load('src/features/wardrobe/index.js'); wardrobe.installWardrobe(); wardrobe.prepare(other);
    const visual = other.VisualSettings;
    assert.throws(() => rt.hooks.get('WardrobeRun')([], () => { throw Error('renderer failed'); }), /renderer failed/);
    assert.equal(rt.context.Player, real); assert.equal(other.VisualSettings, visual); assert.equal(other.Canvas, 'otherCanvas');
    assert.equal(Object.hasOwn(other, 'CanvasBlink'), false);
});

test('IM receives both arrivals after exactly one pending history read', async () => {
    let release, reads = 0;
    const pending = new Promise(resolve => { release = resolve; });
    const rt = runtime({ globals: { Player: { MemberNumber: 1, AccountName: 'Alice', FriendNames: new Map() }, CharacterNickname: () => 'Alice' }, mocks: {
        idb: { openDB: async () => ({ get: () => { reads++; return pending; }, put: async () => {} }) },
        'src/features/chat/chat-augments.js': { processChatAugmentsForLine() {} },
    }, append: { 'src/features/messenger/index.js': 'export const inspectHistory = id => friendMessages.get(id)?.historyRaw;' } });
    const settings = await rt.load('src/core/feature-settings.js'); settings.setFeature('instantMessenger', true);
    const im = await rt.load('src/features/messenger/index.js'); await im.installInstantMessenger();
    const receive = rt.hooks.get('ServerAccountBeep');
    receive([{ Message: 'new one', MemberNumber: 2 }], () => {});
    receive([{ Message: 'new two', MemberNumber: 2 }], () => {});
    await new Promise(resolve => setImmediate(resolve)); assert.equal(reads, 1);
    release({ 2: { historyRaw: [{ message: 'old', authorId: 2, author: 'friend', createdAt: 1 }] } });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(Array.from(im.inspectHistory(2), h => h.message), ['old', 'new one', 'new two']);
});

test('socket binding handles reuse, replacement and disposal without touching other consumers', async () => {
    const { createSocketBinding } = await runtime().load('src/core/lifecycle.js');
    const makeSocket = () => { const e = new Element(); e.on = e.addEventListener; e.off = e.removeEventListener; return e; };
    const first = makeSocket(), second = makeSocket(); let ours = 0, theirs = 0;
    first.on('message', () => theirs++);
    const binding = createSocketBinding({ message: () => ours++ });
    binding.bind(first); binding.bind(first); first.dispatchEvent({ type: 'message' });
    assert.equal(ours, 1); assert.equal(theirs, 1);
    binding.bind(second); first.dispatchEvent({ type: 'message' }); second.dispatchEvent({ type: 'message' });
    assert.equal(ours, 2); assert.equal(theirs, 2);
    binding.dispose(); second.dispatchEvent({ type: 'message' }); assert.equal(ours, 2);
});

test('async installation errors are caught and later installers still execute', async () => {
    const rt = runtime(); const { runSafely } = await rt.load('src/core/lifecycle.js');
    await runSafely('failed', async () => { throw Error('failure after await'); });
    let ran = false; runSafely('next', () => { ran = true; });
    assert.equal(ran, true); assert.equal(rt.warnings.length, 1);
});

test('SVG exclusion normalizes ./ and query strings while external images remain excluded', async () => {
    const policy = await runtime().load('src/features/theme/image-policy.js');
    for (const path of ['Icons/Female.svg', './Icons/Female.svg', '././Icons/Female.svg?v=2', 'https://example.com/icon.svg', 'data:image/svg+xml,test']) {
        assert.equal(policy.doColorizeHTMLImage(path), false, path);
    }
    assert.equal(policy.doColorizeHTMLImage('./Icons/Custom.svg'), true);
    assert.equal(policy.doColorizeImage('data:image/png;base64,AAAA'), true);
    assert.equal(policy.doColorizeImage('blob:https://example.com/id'), true);
    assert.equal(policy.doColorizeHTMLImage('blob:https://example.com/id'), true);
    assert.equal(policy.doColorizeImage('https://example.com/icon.png'), false);
});

test('vertical uninstall removes hooks, events and delayed work, and supports reinstall', async () => {
    let active = false, applied = 0;
    const callbacks = new Map(); let timerId = 0;
    const noop = () => {};
    const rt = runtime({ globals: {
        CurrentScreen: 'ChatRoom', CurrentCharacter: null,
        setTimeout: fn => { callbacks.set(++timerId, fn); return timerId; },
        clearTimeout: id => callbacks.delete(id),
    }, mocks: {
        'src/features/vertical/chatroom.js': {
            crApply: () => { active = true; applied++; }, crRemove: () => { active = false; },
            crMaintain: noop, isCrActive: () => active, isFakeInputVisible: () => false,
            drApply: noop, drRemove: noop, drMaintain: noop, drMoveDomElements: noop, isDrActive: () => false,
            injectChatRoomStyles: noop, removeChatRoomStyles: noop,
        },
        'src/features/vertical/chatsearch.js': {
            csApply: noop, csRemove: noop, buildCsBg: noop, isCsActive: () => false,
            cshApply: noop, cshRemove: noop, renderCshList: noop, isCshActive: () => false,
            cshMarkNeedSync: noop, cshSyncIfNeeded: noop,
        },
    } });
    rt.window.innerWidth = 400; rt.window.innerHeight = 800;
    const settings = await rt.load('src/core/feature-settings.js'); settings.setFeature('verticalChatRoom', true);
    const vertical = await rt.load('src/features/vertical/index.js'); vertical.installVertical();
    rt.hooks.get('DrawProcess')([], noop); assert.equal(applied, 1);
    rt.window.dispatchEvent({ type: 'orientationchange' }); assert.equal(callbacks.size, 1);
    vertical.uninstallVertical(); assert.equal(active, false); assert.equal(rt.hooks.size, 0); assert.equal(callbacks.size, 0);
    rt.window.dispatchEvent({ type: 'resize' }); assert.equal(applied, 1);
    vertical.installVertical(); rt.hooks.get('DrawProcess')([], noop); assert.equal(applied, 2);
});

test('an old uploaded wallpaper read cannot replace a newer URL or allocate a stale object URL', async () => {
    let release, created = 0;
    const pending = new Promise(resolve => { release = resolve; });
    const settings = { bgMode: 'custom', bgCustomUrl: 'lce://uploaded' };
    class TestURL extends URL { static createObjectURL() { created++; return 'blob:test'; } static revokeObjectURL() {} }
    const rt = runtime({ globals: { URL: TestURL }, mocks: {
        'src/loginpage/state.js': { S: { settings } },
        'src/storage/wallpaper.js': { loadWallpaper: () => pending },
    } });
    const image = rt.document.createElement('img'); image.id = 'lce-bg-img'; rt.document.body.append(image);
    const background = await rt.load('src/loginpage/background.js');
    const old = background.applyBackground(); settings.bgCustomUrl = 'https://example.com/new.png';
    await background.applyBackground(); release(new Blob(['image'], { type: 'image/png' })); await old;
    assert.equal(image.src, 'https://example.com/new.png'); assert.equal(created, 0);
    background.disposeBackground();
});

test('credential writes wait for commit, reject aborts and allow retry without changing the ciphertext format', async () => {
    let fail = true, committed = null, transactions = 0;
    const db = {
        get: async () => null,
        transaction() {
            transactions++;
            let record;
            return {
                store: { get: async () => committed, put: async value => { record = value; } },
                get done() { return fail ? Promise.reject(Error('transaction aborted')) : Promise.resolve().then(() => { committed = record || committed; }); },
            };
        },
    };
    const rt = runtime({ mocks: { 'src/storage/databases.js': { openProfilesDB: async () => db } } });
    const credentials = await rt.load('src/storage/credentials.js');
    await assert.rejects(credentials.encryptPassword('example password'), /transaction aborted/);
    assert.equal(committed, null); fail = false;
    const encrypted = await credentials.encryptPassword('example password');
    assert.match(encrypted, /^[\w+/]+=*:[\w+/]+=*$/);
    assert.equal(await credentials.decryptPassword(encrypted), 'example password'); assert.equal(transactions, 2);
});

test('theme API changes apply and remove CSS without visiting the settings page', async () => {
    const rt = runtime({ mocks: { 'src/features/theme/theme-colors.js': {
        plainColors: { main: '#222222', accent: '#777777' }, specialColors: {}, composeColors() {},
        composeRootCss: () => ':root{--lce-main:#222222}', getHexComputed: v => v,
        lighten: v => v, darken: v => v, isDark: () => true,
    } } });
    const settings = await rt.load('src/core/feature-settings.js'); settings.initGlobalFeatures();
    const theme = await rt.load('src/features/theme/index.js'); theme.installThemeEngine();
    settings.setFeature('themeEnabled', true); assert.ok(rt.document.getElementById('lce-theme-style'));
    settings.setFeature('themeEnabled', false); assert.equal(rt.document.getElementById('lce-theme-style'), null);
});

test('trusting an embedded image preserves surrounding text and controls', async () => {
    const rt = runtime({ mocks: { 'src/core/modal-service.js': { openModalAsync: async () => ['submit'] } } });
    const { processChatAugmentsForLine } = await rt.load('src/features/chat/chat-augments.js');
    const line = rt.document.createElement('div');
    const control = rt.document.createElement('button'); control.textContent = 'existing control';
    line.append('before https://new.example/image.svg after ', control); rt.document.body.append(line);
    processChatAugmentsForLine(line, () => {});
    const prompt = line.querySelector('[data-lce-embed-url]'); assert.ok(prompt);
    rt.document.dispatchEvent({ type: 'click', target: prompt, preventDefault() {}, stopPropagation() {} });
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(line.querySelector('img')); assert.ok(line.textContent.includes('before')); assert.ok(line.textContent.includes('after'));
    assert.equal(line.querySelector('button'), control); assert.equal(line.querySelector('[data-lce-embed-url]'), null);
});

test('restored notification controls respond without per-node listeners', async () => {
    const rt = runtime({ globals: { Player: { MemberNumber: 1 }, ChatRoomAppendChat() {} }, mocks: {
        'src/features/chat/local-messages.js': { LOCAL_MARKER: 'lce-local' },
    } });
    const { lceChatNotify } = await rt.load('src/ui/chat/notification.js');
    lceChatNotify('install delegation', { collapsible: true });
    const restored = rt.document.createElement('div'); restored.className = 'lce-notification';
    const collapse = rt.document.createElement('button'); collapse.className = 'lce-notify-collapse';
    const close = rt.document.createElement('button'); close.className = 'lce-notify-close';
    restored.append(collapse, close); rt.document.body.append(restored);
    rt.document.dispatchEvent({ type: 'click', target: collapse, preventDefault() {} });
    assert.equal(restored.classList.contains('lce-collapsed'), true);
    rt.document.dispatchEvent({ type: 'click', target: close, preventDefault() {} }); assert.equal(restored.parentElement, null);
});

test('past profiles can be enabled after initial opt-out and retry a failed database open', async () => {
    let opens = 0;
    const rt = runtime({ mocks: {
        idb: { openDB: async () => { opens++; if (opens === 1) throw Error('unavailable'); return {}; } },
        'src/ui/chat/notification.js': { lceChatNotify() {} },
    } });
    const settings = await rt.load('src/core/feature-settings.js');
    const profiles = await rt.load('src/features/social/past-profiles.js'); await profiles.installPastProfiles(); assert.equal(opens, 0);
    settings.setFeature('pastProfiles', true); await new Promise(resolve => setImmediate(resolve)); assert.equal(opens, 1);
    settings.setFeature('pastProfiles', false); settings.setFeature('pastProfiles', true);
    await new Promise(resolve => setImmediate(resolve)); assert.equal(opens, 2);
    assert.ok(rt.hooks.has('OnlineProfileRun')); assert.ok(rt.window.Liko.LCE.pastProfiles);
});
