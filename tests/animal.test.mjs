import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runtime } from './helpers/runtime.mjs';

function makeItem(name, extra = {}) {
    return { Asset: { Name: name, Group: { Name: 'HairAccessory2' } }, Color: 'Default', ...extra };
}

async function animalRuntime({ player: playerOverride, sent, updates, globals: extraGlobals } = {}) {
    const timers = [];
    const refreshes = [];
    const remote = { MemberNumber: 7, Appearance: [makeItem('Orig', { Property: { Keep: 1 } })] };
    const player = playerOverride ?? { MemberNumber: 1, Appearance: [] };
    const rt = runtime({ append: { 'src/features/animal/index.js': 'export { triggerAnimation };' }, globals: {
        Player: player, CurrentScreen: 'ChatRoom', ServerSend: (...a) => sent?.push(a), ChatRoomData: {}, ChatRoomCharacterItemUpdate: (c, g) => updates?.push([c.MemberNumber, g]), ChatRoomCharacter: [player, remote],
        setTimeout: fn => { timers.push(fn); return fn; },
        clearTimeout: fn => { const i = timers.indexOf(fn); if (i >= 0) timers.splice(i, 1); },
        AssetGet: (_g, _slot, name) => (['A', 'B', 'Orig'].includes(name) ? { Name: name } : null),
        CharacterRefresh: c => refreshes.push(c.MemberNumber),
        InventoryWear: (char, name, slot, color) => {
            const item = makeItem(name, { Color: color });
            char.Appearance = char.Appearance.filter(i => i.Asset.Group.Name !== slot).concat(item);
            return item;
        },
        ...extraGlobals,
    } });
    const settings = await rt.load('src/core/feature-settings.js');
    settings.setFeature('animalEars', true);
    rt.settings = settings;
    const mod = await rt.load('src/features/animal/index.js');
    const run = () => { while (timers.length) timers.shift()(); };
    return { rt, mod, remote, player, timers, refreshes, run };
}

const packet = (state1, state2, extra = {}) => ({
    Type: 'Hidden', Sender: 7, Content: 'LCEAnimalAnim_Ears',
    Dictionary: [{ type: 'Ears', state1, state2, delay: 200, cycles: 2, ...extra }],
});

test('remote animation keeps ordinary object properties and appearance extension fields', async () => {
    const { mod, remote, timers, run } = await animalRuntime();
    mod.onAnimalMessage(packet(
        { Name: 'A', Color: ['#fff'], Property: { Type: 'x', Nested: { a: [1, 2] } }, Rotate: 15, Layer: { Top: 1 }, Bogus: 1 },
        { Name: 'B', Property: { Type: 'y' }, Craft: { Name: 'n' }, Difficulty: 2 }));
    // 第一個畫面是 state2（B）、第二個才是 state1（A）
    assert.equal(remote.Appearance[0].Asset.Name, 'B');
    assert.deepEqual(remote.Appearance[0].Craft, { Name: 'n' });
    assert.equal(remote.Appearance[0].Difficulty, 2);
    timers.shift()();
    const item = remote.Appearance[0];
    assert.equal(item.Asset.Name, 'A');
    assert.deepEqual(item.Property.Nested, { a: [1, 2] });
    assert.equal(item.Rotate, 15);
    assert.deepEqual(item.Layer, { Top: 1 });
    assert.equal('Bogus' in item, false, 'keys outside the whitelist are dropped');
    run();   // finish remaining cycles
    assert.equal(remote.Appearance[0].Asset.Name, 'A', 'playback ends on A (resting pose), not on the previous item');
    assert.equal(remote.Appearance[0].Rotate, 15);
    assert.equal('Keep' in remote.Appearance[0].Property, false, 'leftover properties of the previous item are cleaned');
});

test('own dangerous keys are rejected recursively without rejecting normal objects', async () => {
    const { rt } = await animalRuntime();
    const { sanitizeAnimalState } = await rt.load('src/features/animal/actions.js');
    const evil = JSON.parse('{"Name":"A","Property":{"x":{"__proto__":{"polluted":1}}}}');
    assert.equal('Property' in sanitizeAnimalState(evil), false);
    const evilTop = JSON.parse('{"Name":"A","Property":{"constructor":{"a":1}}}');
    assert.equal('Property' in sanitizeAnimalState(evilTop), false);
    assert.equal(JSON.stringify(sanitizeAnimalState({ Name: 'A', Property: { ok: { deep: true } } }).Property), '{"ok":{"deep":true}}');
    assert.equal('Property' in sanitizeAnimalState({ Name: 'A', Property: () => 1 }), false);
    assert.equal('Property' in sanitizeAnimalState({ Name: 'A', Property: { big: 'x'.repeat(1001) } }), false);
    assert.equal(({}).polluted, undefined);
});

test('cycles are capped at 20 in settings, sender clamp and receiver', async () => {
    const { rt, mod, remote, timers, refreshes, run } = await animalRuntime();
    const schema = await rt.load('src/core/settings-schema.js');
    const actions = await rt.load('src/features/animal/actions.js');
    for (const t of ['Ears', 'Tails', 'Wings']) assert.equal(schema.DEFAULT_FEATURE_SETTINGS[`animal${t}Cycles`].max, 20);
    assert.equal(actions.clampCycles(40), 20);
    assert.equal(actions.clampCycles(21 + 1), 20);
    assert.equal(actions.clampDelay(5), 100);
    mod.onAnimalMessage(packet({ Name: 'A' }, { Name: 'B' }, { cycles: 40 }));
    run();
    // 20 cycles = 40 frames, ending on A
    assert.equal(refreshes.filter(id => id === 7).length, 40);
    assert.equal(remote.Appearance[0].Asset.Name, 'A');
    assert.equal(timers.length, 0);
});

test('a user swap is never overwritten by restoring the old snapshot', async () => {
    const { mod, remote, timers, run } = await animalRuntime();
    mod.onAnimalMessage(packet({ Name: 'A' }, { Name: 'B' }, { cycles: 5 }));
    timers.shift()();
    remote.Appearance = [makeItem('UserPick')];       // user swapped the item
    globalThis.CurrentScreen = 'x';
    run();
    assert.equal(remote.Appearance[0].Asset.Name, 'UserPick');
});

test('leaving the screen freezes on A when the animation still owns the slot', async () => {
    const { rt, mod, remote, timers, run } = await animalRuntime();
    mod.onAnimalMessage(packet({ Name: 'A' }, { Name: 'B' }, { cycles: 5 }));
    rt.context.CurrentScreen = 'Online';
    run();
    assert.equal(remote.Appearance[0].Asset.Name, 'A');
});

test('uncloneable third-party fields do not break saving a pose', async () => {
    const { rt, player } = await animalRuntime();
    const { saveAnimalPose } = await rt.load('src/features/animal/actions.js');
    player.Appearance = [makeItem('A', { Property: { a: 1 }, Rotate: 3 })];
    player.Appearance[0].Layer = { fn() {} };         // structuredClone throws on functions
    const draft = {};
    assert.equal(saveAnimalPose('Ears', 1, draft), true);
    assert.equal(draft.animalEarsState1.Rotate, 3);
    assert.equal('Layer' in draft.animalEarsState1, false);
});

test('animal settings use three top tabs with one column each', async () => {
    const rt = runtime({ mocks: {
        'src/settings/pickers.js': { langFlag() {}, openLanguageDropdown() {}, openFontPicker() {}, promptInput() {}, openColorPicker() {} },
        'src/settings/storage-manager.js': { openStorageManager() {}, closeStorageManager() {}, closeStorageManagerLayer: () => false, isStorageManagerOpen: () => false, positionStorageManager() {} },
        'src/settings/trusted-domain-manager.js': { openTrustedDomainManager() {}, closeTrustedDomainManager() {}, isTrustedDomainManagerOpen: () => false, positionTrustedDomainManager() {} },
    }, append: { 'src/settings/settings-page.js': `
        export function testAnimal(section) { currentCategory = 'animal'; currentSection = section; return { sections: computeSections('animal').length, rows: settingLayouts(), labels: SECTION_LABELS.animal }; }
    ` } });
    const view = await rt.load('src/settings/settings-page.js');
    for (const [i, type] of ['Ears', 'Tails', 'Wings'].entries()) {
        const { sections, rows, labels } = view.testAnimal(i);
        assert.equal(sections, 3);
        assert.equal(rows.length, 7);
        assert.ok(rows.every(r => r.entry[0].startsWith(`animal${type}`)));
        assert.equal(new Set(rows.map(r => r.x)).size, 1);
        assert.equal(labels.length, 3);
    }
});

test('playback ignores whatever is currently equipped', async () => {
    const { mod, remote, timers, run } = await animalRuntime();
    remote.Appearance = [makeItem('Other')];
    mod.onAnimalMessage(packet({ Name: 'A' }, { Name: 'B' }, { cycles: 2 }));
    assert.equal(remote.Appearance[0].Asset.Name, 'B');
    run();
    assert.equal(remote.Appearance[0].Asset.Name, 'A');
    assert.equal(timers.length, 0);
});

test('automatic triggers do not put back an item the user took off', async () => {
    const sent = [];
    const player = { MemberNumber: 1, Appearance: [] };
    const { rt, mod } = await animalRuntime({ player, sent });
    rt.settings.updateSettings({ animalEarsState1: { Name: 'A' }, animalEarsState2: { Name: 'B' } });
    mod.triggerAnimation('Ears', { auto: true });
    assert.equal(sent.length, 0);
    assert.equal(player.Appearance.length, 0);
});


test('own animation sends one item update per frame and no Hidden trigger packet, so non-LCE players see it too', async () => {
    const sent = [], updates = [];
    const player = { MemberNumber: 1, Appearance: [makeItem('Other')] };
    const { rt, mod, run, refreshes } = await animalRuntime({ player, sent, updates });
    rt.settings.updateSettings({ animalEarsState1: { Name: 'A' }, animalEarsState2: { Name: 'B' } });
    mod.triggerAnimation('Ears');
    assert.equal(sent.length, 0, 'no Hidden trigger packet any more');
    assert.equal(updates.length, 1, 'first frame is sent immediately');
    run();
    assert.equal(player.Appearance[0].Asset.Name, 'A', 'ends on the resting pose');
    assert.equal(updates.length, refreshes.length, 'exactly one update per frame, no extra duplicate at the end');
    assert.ok(updates.every(u => u[0] === 1 && u[1] === 'HairAccessory2'));

    // starting already on A: frames are still sent (viewers need to see the motion)
    updates.length = 0; refreshes.length = 0;
    mod.triggerAnimation('Ears');
    run();
    assert.equal(player.Appearance[0].Asset.Name, 'A');
    assert.equal(updates.length, refreshes.length);
    assert.ok(updates.length >= 2);
});

test('receiving an animation does not depend on the local setting (the setting only controls whether I animate)', async () => {
    const { rt, mod, remote, run } = await animalRuntime();
    rt.settings.setFeature('animalEars', false);
    mod.onAnimalMessage(packet({ Name: 'A' }, { Name: 'B' }, { cycles: 1 }));
    assert.equal(remote.Appearance[0].Asset.Name, 'B', 'plays even though my own ear animation is off');
    run();
    assert.equal(remote.Appearance[0].Asset.Name, 'A');
});

test('remote characters never send updates', async () => {
    const updates = [];
    const { mod, remote, run } = await animalRuntime({ updates });
    remote.Appearance = [makeItem('Other')];
    mod.onAnimalMessage(packet({ Name: 'A' }, { Name: 'B' }, { cycles: 1 }));
    run();
    assert.equal(updates.length, 0);
});

test('manual trigger (*wag* etc.) plays without equipment; random trigger needs equipment', async () => {
    const sent = [], updates = [];
    const player = { MemberNumber: 1, Appearance: [] };
    const { rt, mod, run } = await animalRuntime({ player, sent, updates });
    rt.settings.updateSettings({ animalEarsState1: { Name: 'A' }, animalEarsState2: { Name: 'B' } });
    mod.triggerAnimation('Ears', { auto: true });
    assert.equal(sent.length, 0);
    assert.equal(player.Appearance.length, 0);
    mod.triggerAnimation('Ears');
    assert.equal(sent.length, 0);
    assert.equal(player.Appearance[0].Asset.Name, 'B');
    run();
    assert.equal(player.Appearance[0].Asset.Name, 'A');
    assert.ok(updates.length >= 2, 'every frame is sent');
});

// ───────────────────────── 設定頁右側擺動預覽 ─────────────────────────

async function previewRuntime({ states = {}, settings = {} } = {}) {
    let time = 0;
    const calls = { refresh: 0, draws: [] };
    const player = { Name: 'Me', AssetFamily: 'Female3DCG', ActivePose: ['Kneel'], Appearance: [makeItem('Other', { Property: { x: 1 } })] };
    const preview = {};
    const rt = runtime({ globals: {
        Player: player,
        CharacterLoadSimple: () => preview,
        CharacterRefresh: (c) => { assert.equal(c, preview); calls.refresh++; },
        DrawCharacter: (...a) => calls.draws.push(a),
        InventoryWear(c, name, slot, color) { const item = makeItem(name); c.Appearance = c.Appearance.filter(i => i.Asset.Group.Name !== slot); c.Appearance.push(item); item.Asset.Group.Name = slot; item.Color = color; return item; },
    } });
    const feature = await rt.load('src/core/feature-settings.js');
    feature.initGlobalFeatures();
    rt.settings = feature;
    feature.updateSettings({ animalEarsState1: { Name: 'A' }, animalEarsState2: { Name: 'B' }, animalEarsCycles: 2, animalEarsDelay: 100, ...states, ...settings });
    const { createAnimalPreview } = await rt.load('src/features/animal/preview.js');
    const ctl = createAnimalPreview(() => time);
    return { rt, ctl, player, preview, calls, tick: ms => { time = ms; ctl.update(); } };
}

test('preview plays B, A, B, A on its own copy, ends on A, and never touches the player', async () => {
    const { ctl, player, preview, calls, tick } = await previewRuntime();
    const original = player.Appearance[0];
    assert.equal(ctl.rebuild(), true);
    assert.deepEqual(preview.ActivePose, ['Kneel']);
    assert.notEqual(preview.Appearance[0], original, 'appearance is copied');
    assert.equal(ctl.play('Ears'), true);
    const ears = () => preview.Appearance.find(i => i.Asset.Group.Name === 'HairAccessory2')?.Asset.Name;
    assert.equal(ears(), 'B');                // 第一格就動
    tick(99);  assert.equal(ears(), 'B');
    tick(100); assert.equal(ears(), 'A');
    tick(200); assert.equal(ears(), 'B');
    tick(300); assert.equal(ears(), 'A');
    assert.equal(ctl.isPlaying(), true);
    tick(400); assert.equal(ears(), 'A');     // 2 個循環 = 4 格，之後停在 A
    assert.equal(ctl.isPlaying(), false);
    const refreshes = calls.refresh;
    tick(900); assert.equal(calls.refresh, refreshes, 'idle after finish: no more rebuilds');
    assert.equal(player.Appearance.length, 1);
    assert.equal(player.Appearance[0], original);
    assert.equal(original.Asset.Name, 'Other');
});

test('preview needs both poses; clear stops drawing; draw forwards to DrawCharacter without height scaling', async () => {
    const { ctl, calls } = await previewRuntime({ states: { animalEarsState2: null } });
    ctl.rebuild();
    assert.equal(ctl.hasAnimation('Ears'), false);
    assert.equal(ctl.play('Ears'), false);
    ctl.draw(1490, 180, 0.6);
    assert.equal(calls.draws.length, 1);
    assert.deepEqual(calls.draws[0].slice(1), [1490, 180, 0.6, false]);
    ctl.clear();
    ctl.draw(1490, 180, 0.6);
    assert.equal(calls.draws.length, 1);
});

test('preview only plays the part of the current tab, and does not require it to be worn', async () => {
    const { ctl, player, preview, tick } = await previewRuntime({ states: { animalTailsState1: { Name: 'T1' }, animalTailsState2: { Name: 'T2' }, animalTailsCycles: 1, animalTailsDelay: 300 } });
    const name = slot => preview.Appearance.find(i => i.Asset.Group.Name === slot)?.Asset.Name;
    assert.equal(player.Appearance.some(i => i.Asset.Group.Name === 'TailStraps'), false, 'player wears no tail');
    ctl.rebuild();
    assert.equal(ctl.play('Ears'), true);
    assert.equal(name('HairAccessory2'), 'B');
    assert.equal(name('TailStraps'), undefined, 'ears tab never touches the tail');
    ctl.rebuild();
    assert.equal(ctl.play('Tails'), true);          // manual-trigger semantics: wearing not required
    assert.equal(name('TailStraps'), 'T2');
    assert.equal(name('HairAccessory2'), 'Other', 'tails tab leaves the ears as they were');
    tick(300); assert.equal(name('TailStraps'), 'T1');
    assert.equal(ctl.play('Wings'), false, 'unsaved part is not playable');
});

test('animal page: preview block sits at X1480 Y180 W320 and the settings panel narrows to make room', async () => {
    const layout = await runtime().load('src/settings/layout.js');
    assert.deepEqual([layout.ANIMAL_SIDE_X, layout.ANIMAL_SIDE_W, layout.ANIMAL_PANEL_W, layout.ANIMAL_CHAR_H, layout.ANIMAL_BTN_H], [1480, 320, 1260, 600, 50]);
    assert.equal(layout.PANEL_X + layout.ANIMAL_PANEL_W + layout.ANIMAL_SIDE_GAP, layout.ANIMAL_SIDE_X);
    assert.equal(layout.ANIMAL_CHAR_H + layout.ANIMAL_BTN_H, layout.PANEL_H);
});

test('animal / preview strings exist in all 7 languages and are translated (not English fallbacks)', async () => {
    const fs = await import('node:fs');
    const load = c => JSON.parse(fs.readFileSync(new URL(`../Translation/${c}.json`, import.meta.url), 'utf8'));
    const en = load('EN');
    const mine = k => /^(s_animal|sd_animal|animal_preview|settings_tab_animal|cat_animal|settings_reset_animal|s_msg_anim|s_btn_(clear_anim|save_pose)|s_staggerCharacterBuild|sd_staggerCharacterBuild)/.test(k);
    const keys = Object.keys(en).filter(mine);
    assert.ok(keys.length > 50);
    const sameWord = new Set(['DE:animal_preview_test']);   // 德文也叫 Test
    for (const code of ['TW', 'CN', 'DE', 'FR', 'RU', 'UA']) {
        const table = load(code);
        for (const k of keys) {
            assert.ok(typeof table[k] === 'string' && table[k], `${code} missing ${k}`);
            if (!sameWord.has(`${code}:${k}`)) assert.notEqual(table[k], en[k], `${code} ${k} is still English`);
        }
    }
    assert.equal(load('TW').animal_preview_none, '目前尚無保存外觀，無法測試');
});

test('animal part list is one source: tab order matches it, and re-saving a pose is picked up by the preview', async () => {
    const actions = await runtime().load('src/features/animal/actions.js');
    assert.deepEqual([...actions.ANIMAL_TYPES], ['Ears', 'Tails', 'Wings']);
    assert.deepEqual(['Ears', 'Tails', 'Wings'].map(actions.fallbackCycles), [9, 9, 3]);
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../src/settings/settings-page.js', import.meta.url), 'utf8');
    assert.match(src, /animal: \['settings_tab_animal_ears', 'settings_tab_animal_tails', 'settings_tab_animal_wings'\]/);

    const { ctl, preview, tick, rt } = await previewRuntime();
    const ears = () => preview.Appearance.find(i => i.Asset.Group.Name === 'HairAccessory2')?.Asset.Name;
    ctl.rebuild(); ctl.play('Ears'); assert.equal(ears(), 'B');
    rt.settings.updateSettings({ animalEarsState2: { Name: 'B2' } });   // 重新儲存姿勢：快取必須失效
    ctl.rebuild(); ctl.play('Ears'); assert.equal(ears(), 'B2');
});

test('a repeated trigger while playing restarts from the beginning (latest one wins)', async () => {
    const { mod, remote, timers, refreshes, run } = await animalRuntime();
    mod.onAnimalMessage(packet({ Name: 'A' }, { Name: 'B' }, { cycles: 3 }));
    timers.shift()();                                   // frame 1: now on A
    assert.equal(remote.Appearance[0].Asset.Name, 'A');
    const before = refreshes.length;
    mod.onAnimalMessage(packet({ Name: 'A' }, { Name: 'B' }, { cycles: 2 }));
    assert.equal(remote.Appearance[0].Asset.Name, 'B', 'restarted on the first frame (B)');
    assert.equal(timers.length, 1, 'the old timer was cleared, only one is pending');
    run();
    assert.equal(refreshes.length - before, 4, 'the new run plays its own 2 cycles');
    assert.equal(remote.Appearance[0].Asset.Name, 'A');
});

test('the 20-renderer cap does not block a restart of an existing one', async () => {
    const { rt, mod, remote, timers } = await animalRuntime();
    mod.onAnimalMessage(packet({ Name: 'A' }, { Name: 'B' }, { cycles: 3 }));
    for (let n = 100; n < 125; n++) {
        rt.context.ChatRoomCharacter.push({ MemberNumber: n, Appearance: [] });
        mod.onAnimalMessage({ ...packet({ Name: 'A' }, { Name: 'B' }), Sender: n });
    }
    timers.shift()();
    mod.onAnimalMessage(packet({ Name: 'A' }, { Name: 'B' }, { cycles: 3 }));
    assert.equal(remote.Appearance[0].Asset.Name, 'B');
});

test('removing the item mid-play stops the animation without putting it back', async () => {
    const { mod, remote, timers, run } = await animalRuntime();
    mod.onAnimalMessage(packet({ Name: 'A' }, { Name: 'B' }, { cycles: 5 }));
    timers.shift()();
    remote.Appearance = [];
    run();
    assert.equal(remote.Appearance.length, 0);
    assert.equal(timers.length, 0);
});

test('final sync also notices a change that is only in appearance extension fields', async () => {
    const updates = [];
    const player = { MemberNumber: 1, Appearance: [makeItem('A', { Rotate: 0 })] };
    const { rt, mod, run } = await animalRuntime({ player, updates });
    rt.settings.updateSettings({ animalEarsState1: { Name: 'A', Rotate: 15 }, animalEarsState2: { Name: 'B' } });
    mod.triggerAnimation('Ears');
    run();
    assert.equal(player.Appearance[0].Rotate, 15);
    assert.ok(updates.length >= 2 && updates.every(u => u[0] === 1 && u[1] === 'HairAccessory2'), 'frames are synced, ending on A with Rotate 15');
});

test('item signature follows every whitelisted field', async () => {
    const { rt } = await animalRuntime();
    const { animalItemSignature, ANIMAL_STATE_KEYS } = await rt.load('src/features/animal/actions.js');
    const base = makeItem('A');
    for (const key of ANIMAL_STATE_KEYS) {
        assert.notEqual(animalItemSignature({ ...base, [key]: key === 'Difficulty' ? 2 : { x: 1 } }), animalItemSignature(base), key);
    }
});

// ───────────────────────── 七種語言的文字觸發詞 ─────────────────────────

test('every trigger word in all 7 languages maps to its own part, with no cross-part collisions', async () => {
    const rt = runtime();
    const { ANIMAL_TRIGGER_WORDS, ANIMAL_TRIGGER_LANGS, getAnimTypeFromMsg } = await rt.load('src/features/animal/triggers.js');
    for (const type of ['Ears', 'Tails', 'Wings']) {
        for (const lang of ANIMAL_TRIGGER_LANGS) {
            const words = ANIMAL_TRIGGER_WORDS[type][lang];
            assert.ok(words?.length >= 3, `${type}/${lang} has trigger words`);
            for (const w of words) assert.equal(getAnimTypeFromMsg(`*${w}*`), type, `${lang}: *${w}*`);
        }
    }
});

test('trigger matching ignores case, accents, extra spaces and accepts full-width asterisks', async () => {
    const rt = runtime();
    const { getAnimTypeFromMsg } = await rt.load('src/features/animal/triggers.js');
    assert.equal(getAnimTypeFromMsg('*WIGGLE*'), 'Ears');
    assert.equal(getAnimTypeFromMsg('*  wags   tail  *'), 'Tails');
    assert.equal(getAnimTypeFromMsg('*bat des AILES*'), 'Wings');
    assert.equal(getAnimTypeFromMsg('*frétille de la queue*'), 'Tails');
    assert.equal(getAnimTypeFromMsg('*fretille de la queue*'), 'Tails', 'accents optional');
    assert.equal(getAnimTypeFromMsg('*flattert mit den flugeln*'), 'Wings', 'umlaut optional');
    assert.equal(getAnimTypeFromMsg('*шевелит ушами*'), 'Ears');
    assert.equal(getAnimTypeFromMsg('＊搖尾巴＊'), 'Tails', 'full-width asterisks from CJK input');
    assert.equal(getAnimTypeFromMsg(' *摇耳朵* '), 'Ears', 'surrounding spaces');
});

test('closing asterisk is optional, as BC treats any message starting with * as an emote', async () => {
    const rt = runtime();
    const { getAnimTypeFromMsg } = await rt.load('src/features/animal/triggers.js');
    assert.equal(getAnimTypeFromMsg('*wiggle'), 'Ears');
    assert.equal(getAnimTypeFromMsg('*wiggle*'), 'Ears');
    assert.equal(getAnimTypeFromMsg('*  Wags   Tail  '), 'Tails');
    assert.equal(getAnimTypeFromMsg('＊搖尾巴'), 'Tails', 'full-width, no closing star');
    assert.equal(getAnimTypeFromMsg('*шевелит ушами'), 'Ears');
    assert.equal(getAnimTypeFromMsg('wiggle*'), null, 'the opening asterisk is still required');
    assert.equal(getAnimTypeFromMsg('wiggle'), null);
});

test('trigger text must be the whole message and exactly a keyword', async () => {
    const rt = runtime();
    const { getAnimTypeFromMsg } = await rt.load('src/features/animal/triggers.js');
    for (const bad of ['搖尾巴', '*搖尾巴*啊', '我 *搖尾巴*', '*慢慢搖尾巴*', '*remue la queue de son chat*', '**', '*', '', '*wag*wag*', '*wag**', '*慢慢搖尾巴']) {
        assert.equal(getAnimTypeFromMsg(bad), null, bad);
    }
    assert.equal(getAnimTypeFromMsg(null), null);
    assert.equal(getAnimTypeFromMsg(42), null);
});

test('trigger matching tolerates trailing mood marks but not extra words', async () => {
    const rt = runtime();
    const { getAnimTypeFromMsg } = await rt.load('src/features/animal/triggers.js');
    for (const [msg, type] of [['*搖尾巴~*', 'Tails'], ['*搖尾巴～', 'Tails'], ['*wag!', 'Tails'], ['*wag tail.*', 'Tails'],
        ['*拍翅膀！！*', 'Wings'], ['*wiggle...*', 'Ears'], ['*摇耳朵。', 'Ears']]) {
        assert.equal(getAnimTypeFromMsg(msg), type, msg);
    }
    for (const bad of ['*~*', '*!*', '*wag!*wag*', '*wag ok!*']) assert.equal(getAnimTypeFromMsg(bad), null, bad);
});

test('Chinese and English phrasing covers the verb x part grid, so the natural variants all hit', async () => {
    const rt = runtime();
    const { getAnimTypeFromMsg } = await rt.load('src/features/animal/triggers.js');
    const cases = {
        Ears: ['搖耳朵', '晃耳朵', '抖耳朵', '動耳朵', '甩耳朵', '搖搖耳朵', '擺動耳朵', '抖動耳朵', '摇耳朵', '甩耳朵', 'wiggling', 'twitch ear', 'flicks ears'],
        Tails: ['搖尾巴', '動尾巴', '晃尾巴', '擺擺尾巴', '搖動尾巴', '摇尾巴', '动尾巴', 'wagging tail', 'swishes tail'],
        Wings: ['擺動翅膀', '搖翅膀', '動翅膀', '拍拍翅膀', '振翅', '摆动翅膀', '扇动翅膀', 'flapping', 'flutters wings'],
    };
    for (const [type, words] of Object.entries(cases)) {
        for (const w of words) {
            assert.equal(getAnimTypeFromMsg(`*${w}*`), type, `*${w}*`);
            assert.equal(getAnimTypeFromMsg(`*${w}`), type, `*${w}`);
        }
    }
});

test('docs/animal-trigger-words.md lists every word that the code accepts', async () => {
    const rt = runtime();
    const { ANIMAL_TRIGGER_WORDS } = await rt.load('src/features/animal/triggers.js');
    const doc = fs.readFileSync('docs/animal-trigger-words.md', 'utf8');
    const missing = [];
    for (const langs of Object.values(ANIMAL_TRIGGER_WORDS)) for (const words of Object.values(langs)) for (const w of words) if (!doc.includes(`*${w}*`)) missing.push(w);
    assert.deepEqual(missing, [], 'add the missing words to docs/animal-trigger-words.md');
});

// ───────────────────────── 聊天送出 → 觸發（接線） ─────────────────────────
async function chatTriggerRuntime({ enabled = true, poses = true, extra = {} } = {}) {
    const updates = [];
    let input = '';
    const player = { MemberNumber: 1, Appearance: [] };
    const ctx = await animalRuntime({ player, updates, globals: { ElementValue: (_id, v) => (v === undefined ? input : (input = v)), ...extra } });
    ctx.rt.settings.setFeature('animalEars', enabled);
    if (poses) {
        ctx.rt.settings.setFeature('animalEarsState1', { Name: 'A' });
        ctx.rt.settings.setFeature('animalEarsState2', { Name: 'B' });
    }
    ctx.mod.installAnimalAnimations();
    let sentOriginal = 0;
    const send = msg => {
        input = msg; updates.length = 0; sentOriginal = 0;
        ctx.rt.hooks.get('ChatRoomSendChat')([], () => { sentOriginal++; input = ''; });
        return { played: updates.length > 0, sentOriginal };
    };
    return { ...ctx, send };
}

test('chat send hook: *wiggle and *wiggle* both play and the message is still sent exactly once', async () => {
    const { send } = await chatTriggerRuntime();
    for (const msg of ['*wiggle*', '*wiggle', '＊搖耳朵', '*搖耳朵~*']) assert.deepEqual(send(msg), { played: true, sentOriginal: 1 }, msg);
});

test('chat send hook: ordinary chat, other words, switch off, or missing poses do not play but never block the message', async () => {
    const ok = await chatTriggerRuntime();
    for (const msg of ['hello', '(wiggle)', '/wiggle', 'wiggle*', '*smiles*']) assert.deepEqual(ok.send(msg), { played: false, sentOriginal: 1 }, msg);
    const off = await chatTriggerRuntime({ enabled: false });
    assert.deepEqual(off.send('*wiggle*'), { played: false, sentOriginal: 1 });
    const noPose = await chatTriggerRuntime({ poses: false });
    assert.deepEqual(noPose.send('*wiggle*'), { played: false, sentOriginal: 1 });
});

// ───────────────────────── 自動觸發計時器 ─────────────────────────
test('auto-trigger timer runs only while at least one part is enabled', async () => {
    let started = 0, cleared = 0;
    const { rt, mod } = await animalRuntime({ globals: { setInterval: () => ++started, clearInterval: () => { cleared++; } } });
    rt.settings.setFeature('animalEars', false);
    mod.installAnimalAnimations();
    assert.equal(started, 0, 'nothing enabled → no timer at install');
    rt.settings.setFeature('animalTails', true);
    assert.equal(started, 1, 'enabling a part starts it');
    rt.settings.setFeature('animalWings', true);
    assert.equal(started, 1, 'enabling a second part does not start another timer');
    rt.settings.setFeature('animalTails', false);
    assert.equal(cleared, 0, 'one part is still on');
    rt.settings.setFeature('animalWings', false);
    assert.equal(cleared, 1, 'all parts off → timer cleared');
    rt.settings.setFeature('animalEars', true);
    assert.equal(started, 2, 're-enabling starts it again');
});

// ───────────────────────── 讓位給遠端玩家的外觀變更 ─────────────────────────
test('external item sync on Player immediately aborts ongoing animation without sending further updates', async () => {
    const sent = [], updates = [];
    const player = { MemberNumber: 1, Appearance: [makeItem('Other')] };
    const { rt, mod, timers } = await animalRuntime({ player, sent, updates });
    rt.settings.updateSettings({ animalEarsState1: { Name: 'A' }, animalEarsState2: { Name: 'B' } });
    mod.triggerAnimation('Ears');
    assert.equal(updates.length, 1, 'first frame is sent');
    assert.equal(timers.length, 1, 'timer is pending for next frame');

    // Remote player (7) changes an item on Player (1)
    mod.onSyncItem({ Source: 7, Item: { Target: 1, Group: 'Cloth' } });
    assert.equal(timers.length, 0, 'animation timer was cancelled');
    assert.equal(updates.length, 1, 'no further frames sent after abort');
});

test('external character sync on Player immediately aborts ongoing animation', async () => {
    const sent = [], updates = [];
    const player = { MemberNumber: 1, Appearance: [makeItem('Other')] };
    const { rt, mod, timers } = await animalRuntime({ player, sent, updates });
    rt.settings.updateSettings({ animalEarsState1: { Name: 'A' }, animalEarsState2: { Name: 'B' } });
    mod.triggerAnimation('Ears');
    assert.equal(updates.length, 1);
    assert.equal(timers.length, 1);

    // Remote player (7) exits wardrobe on Player (1)
    mod.onSyncCharacter({ SourceMemberNumber: 7, Character: { MemberNumber: 1 } });
    assert.equal(timers.length, 0, 'timer cancelled');
    assert.equal(updates.length, 1, 'no further updates sent');
});

test('external sync on a different character does not interrupt Player animation', async () => {
    const sent = [], updates = [];
    const player = { MemberNumber: 1, Appearance: [makeItem('Other')] };
    const { rt, mod, timers } = await animalRuntime({ player, sent, updates });
    rt.settings.updateSettings({ animalEarsState1: { Name: 'A' }, animalEarsState2: { Name: 'B' } });
    mod.triggerAnimation('Ears');
    assert.equal(timers.length, 1);

    // Remote player (7) changes an item on someone else (99)
    mod.onSyncItem({ Source: 7, Item: { Target: 99, Group: 'Cloth' } });
    assert.equal(timers.length, 1, 'Player animation continues');
});

test('concurrent animations on Player dynamically scale frame delay to stay within 10 packets/s', async () => {
    const scheduledDelays = [];
    const player = { MemberNumber: 1, Appearance: [makeItem('Other'), { Asset: { Name: 'TailOrig', Group: { Name: 'TailStraps' } } }] };
    const { rt, mod, timers } = await animalRuntime({
        player,
        globals: {
            setTimeout: (fn, delay) => { scheduledDelays.push(delay); timers.push(fn); return fn; }
        }
    });
    rt.settings.setFeature('animalTails', true);
    rt.settings.updateSettings({
        animalEarsState1: { Name: 'A' }, animalEarsState2: { Name: 'B' }, animalEarsDelay: 100,
        animalTailsState1: { Name: 'A' }, animalTailsState2: { Name: 'B' }, animalTailsDelay: 100,
    });
    mod.triggerAnimation('Ears');
    mod.triggerAnimation('Tails');
    assert.ok(scheduledDelays.some(d => d >= 200), 'delay scaled to protect rate limit when multiple parts run');
});


