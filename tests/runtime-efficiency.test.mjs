import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from './helpers/runtime.mjs';

test('cache cleanup keeps room members and offline characters while deletion mutates Character', async () => {
    let reads = 0;
    const room = Array.from({ length: 50 }, (_, MemberNumber) => ({
        get MemberNumber() { reads++; return MemberNumber; },
    }));
    const characters = Array.from({ length: 100 }, (_, MemberNumber) => ({ MemberNumber, IsOnline: () => true }));
    const offline = { MemberNumber: 200, IsOnline: () => false };
    characters.push(offline);
    const deleted = [], refreshed = [];
    const rt = runtime({ globals: {
        Character: characters, ChatRoomCharacter: room,
        CharacterDelete: c => { deleted.push(c.MemberNumber); characters.splice(characters.indexOf(c), 1); },
        CharacterRefresh: c => refreshed.push(c.MemberNumber),
    } });
    const { doClearCaches } = await rt.load('src/features/performance/textures.js');
    doClearCaches();
    assert.equal(reads, room.length, 'room IDs are read once, not for every cached character');
    assert.deepEqual(deleted, Array.from({ length: 50 }, (_, i) => i + 50));
    assert.deepEqual(refreshed, Array.from({ length: 50 }, (_, i) => i));
    assert.ok(characters.includes(offline));
    assert.equal(rt.warnings.length, 0);
});

test('chat mutation processing does not traverse detached message subtrees', async () => {
    let notify;
    const rt = runtime({ globals: { MutationObserver: class {
        constructor(callback) { notify = callback; }
        observe() {} disconnect() {}
    } } });
    const log = rt.document.createElement('div'); log.id = 'TextAreaChatLog'; rt.document.body.append(log);
    const detached = rt.document.createElement('div');
    detached.closest = detached.querySelectorAll = () => assert.fail('detached subtree was traversed');
    const { registerChatProcessor } = await rt.load('src/ui/chat/pipeline.js');
    const stop = registerChatProcessor({ selector: '.ChatMessage', enabled: () => true, process: () => assert.fail('detached message processed') });
    notify([{ type: 'childList', target: log, addedNodes: [detached] }]);
    stop();
});

test('released face state cannot mutate the next capture and public reads stay isolated', async () => {
    const { FaceCache, captureFace, releaseCachedFace } = await runtime().load('src/features/expressions/face-cache.js');
    captureFace(() => 'Happy', { Eyes: 'Closed' });
    const snapshot = FaceCache.get(); snapshot.original.Eyes = 'Changed';
    assert.equal(FaceCache.get().original.Eyes, 'Happy');
    const released = releaseCachedFace();
    assert.equal(FaceCache.isEmpty(), true);
    captureFace(() => 'Open', { Eyes: 'Closed' });
    released.original.Eyes = 'Changed';
    assert.equal(FaceCache.get().original.Eyes, 'Open');
});

test('expression ticks avoid JSON work when debug is off and send poses only on change', async () => {
    let serializations = 0;
    const sent = [];
    const player = {
        MemberNumber: 1, IsPlayer: () => true,
        Appearance: ['Eyes', 'Eyes2'].map(Name => ({ Asset: { Group: { Name } }, Property: { Expression: null } })),
        AppearanceLayers: [], ActivePose: ['BaseUpper', 'BaseLower'], ArousalSettings: { Progress: 0 },
    };
    const rt = runtime({ globals: {
        Player: player, CurrentScreen: 'ChatRoom', CurrentTime: 0, addEventListener() {},
        PoseFemale3DCG: [{ Name: 'BaseUpper', Category: 'BodyUpper' }, { Name: 'BaseLower', Category: 'BodyLower' }],
        DialogSelfMenuSelected: '', CharacterRefresh() {}, CharacterSetFacialExpression() {}, ServerAppearanceBundle: x => x,
        ServerSend: (...args) => sent.push(args),
        JSON: { parse: JSON.parse, stringify: (...args) => { serializations++; return JSON.stringify(...args); } },
    }, append: { 'src/features/expressions/index.js': 'export { customArousalExpression };' } });
    const settings = await rt.load('src/core/feature-settings.js');
    settings.setFeature('animationEngine', true);
    settings.setFeature('activityExpressions', true);
    settings.setFeature('autoArousalExpression', false);
    const ex = await rt.load('src/features/expressions/index.js');
    ex.installExpressions();
    ex.pushEvent({ Type: 'Activity', Duration: 1000, Expression: { Eyes: [{ Expression: 'Closed' }] } });
    serializations = 0;
    ex.customArousalExpression();
    assert.equal(player.Appearance[0].Property.Expression, 'Closed');
    assert.equal(serializations, 0);
    assert.equal(sent.filter(([kind]) => kind === 'ChatRoomCharacterPoseUpdate').length, 0);
    player.ActivePose = ['UnknownPose'];
    ex.customArousalExpression();
    ex.customArousalExpression();
    assert.deepEqual(Array.from(player.ActivePose), ['BaseUpper', 'BaseLower']);
    assert.equal(sent.filter(([kind]) => kind === 'ChatRoomCharacterPoseUpdate').length, 1);
    assert.equal(serializations, 0);
});
