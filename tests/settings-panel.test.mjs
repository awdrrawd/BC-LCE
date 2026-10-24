import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from './helpers/runtime.mjs';

async function setup() {
    const state = { storageOpen: false, modalOpen: false, domainOpen: false, mouse: { x: 0, y: 0 } };
    const log = [];
    const rt = runtime({
        globals: {
            get MouseX() { return state.mouse.x; }, get MouseY() { return state.mouse.y; },
            MouseIn: (x, y, w, h) => state.mouse.x >= x && state.mouse.x <= x + w && state.mouse.y >= y && state.mouse.y <= y + h,
        },
        mocks: {
            'src/settings/pickers.js': { langFlag() {}, openLanguageDropdown() {}, openFontPicker() {}, promptInput() {}, openColorPicker() {} },
            'src/settings/storage-manager.js': {
                openStorageManager() {}, positionStorageManager() {},
                isStorageManagerOpen: () => state.storageOpen,
                closeStorageManager: () => { log.push('closeStorage'); state.storageOpen = false; },
                closeStorageManagerLayer: () => { if (!state.modalOpen) return false; state.modalOpen = false; log.push('closeModal'); return true; },
            },
            'src/settings/trusted-domain-manager.js': {
                openTrustedDomainManager() {}, positionTrustedDomainManager() {},
                isTrustedDomainManagerOpen: () => state.domainOpen,
                closeTrustedDomainManager: () => { log.push('closeDomain'); state.domainOpen = false; },
            },
        },
        append: { 'src/settings/settings-page.js': `
            export const t = {
                layouts(category, section) { currentCategory = category; currentSection = section; return settingLayouts(); },
                setCategory(c) { currentCategory = c; },
                category: () => currentCategory,
                key: (e) => keyHandler(e),
                wheel: (e) => onGlobalWheel(e),
            };
        ` },
    });
    const settings = await rt.load('src/core/feature-settings.js');
    settings.initGlobalFeatures();
    const view = await rt.load('src/settings/settings-page.js');
    return { rt, state, log, settings, t: view.t };
}

const keyEvent = (key) => ({ key, stopped: false, prevented: false, stopPropagation() { this.stopped = true; }, preventDefault() { this.prevented = true; } });
const wheelEvent = (deltaY, extra = {}) => ({ deltaY, ctrlKey: false, shiftKey: false, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...extra });

test('canvas panels share the unified frame: X200 Y180 W1600, 7 rows per column (special cases aside)', async () => {
    const layout = await runtime().load('src/settings/layout.js');
    assert.deepEqual([layout.PANEL_X, layout.PANEL_Y, layout.PANEL_W], [200, 180, 1600]);
    assert.equal(layout.PANEL_H, 650);
    assert.equal(layout.PANEL_OVERLAY_H, 750);
    assert.equal(layout.PANEL_TAB_H, 65);
    assert.equal(layout.PANEL_ROWS, 7);

    const { t } = await setup();
    const sections = { ui: 2, theme: 3, immersion: 3, animal: 3 };
    for (const [category, count] of Object.entries(sections)) for (let section = 0; section < count; section++) {
        const rows = t.layouts(category, section);
        const specialRows = category === 'theme' && section === 0 ? 5 : 7;
        // Map.groupBy 需要 Node 21+；不依賴這個較新的內建，所以手動分欄
        const byColumn = new Map();
        for (const row of rows) byColumn.set(row.x, [...(byColumn.get(row.x) ?? []), row]);
        for (const [x, column] of byColumn) {
            assert.ok(x >= 200 && x < 1800, `${category}/${section} column x ${x} inside panel`);
            assert.ok(column.length <= specialRows || category === 'immersion', `${category}/${section} column has ${column.length} rows`);
        }
        for (const row of rows) {
            assert.ok(row.x + row.width <= 1800, `${row.entry[0]} stays inside the 1600-wide panel`);
            assert.ok(row.y + 65 <= 830, `${row.entry[0]} stays inside the 650-high panel`);
            assert.ok(row.y >= 245, `${row.entry[0]} sits below the 65px tab row`);
        }
    }
});

test('ESC in storage/domain panels closes only the panel (modal first), never leaves LCE', async () => {
    const { state, log, t } = await setup();
    t.setCategory(null);
    state.storageOpen = true; state.modalOpen = true;
    let e = keyEvent('Escape'); t.key(e);
    assert.deepEqual(log, ['closeModal']);
    assert.equal(state.storageOpen, true);
    assert.ok(e.stopped && e.prevented, 'event is consumed so BC does not run exit()');
    e = keyEvent('Escape'); t.key(e);
    assert.deepEqual(log, ['closeModal', 'closeStorage', 'closeDomain']);
    assert.equal(state.storageOpen, false);
    assert.ok(e.stopped && e.prevented);

    state.domainOpen = true; log.length = 0;
    e = keyEvent('Escape'); t.key(e);
    assert.deepEqual(log, ['closeStorage', 'closeDomain']);
    assert.ok(e.stopped && e.prevented);

    // nothing open on the LCE home page: ESC is left to BC (leaves LCE)
    e = keyEvent('Escape'); t.key(e);
    assert.equal(e.stopped, false);
});

test('mouse wheel adjusts bars only while hovering them, respects step, bounds, Shift and disabled state', async () => {
    const { settings, state, t } = await setup();
    settings.updateSettings({ animalEars: true });
    const rows = t.layouts('animal', 0);
    const bar = rows.find(row => row.entry[0] === 'animalEarsInterval');
    assert.ok(bar, 'animal ears interval bar is on the first animal tab');
    const delay = rows.find(row => row.entry[0] === 'animalEarsDelay');
    const over = row => { state.mouse.x = row.controlX + 10; state.mouse.y = row.y + 10; };

    over(bar);
    let e = wheelEvent(-100); t.wheel(e);
    assert.equal(settings.getFeature('animalEarsInterval'), 31);
    assert.ok(e.prevented && e.stopped);
    t.wheel(wheelEvent(100)); t.wheel(wheelEvent(100));
    assert.equal(settings.getFeature('animalEarsInterval'), 29);
    t.wheel(wheelEvent(-100, { shiftKey: true }));
    assert.equal(settings.getFeature('animalEarsInterval'), 39);

    over(delay); // step 10
    const before = settings.getFeature('animalEarsDelay');
    t.wheel(wheelEvent(-100));
    assert.equal(settings.getFeature('animalEarsDelay'), before + 10);

    for (let i = 0; i < 200; i++) { over(bar); t.wheel(wheelEvent(-100, { shiftKey: true })); }
    assert.equal(settings.getFeature('animalEarsInterval'), 999, 'clamped to max');

    // not over a bar → untouched and not swallowed
    state.mouse.x = 0; state.mouse.y = 0;
    e = wheelEvent(-100); t.wheel(e);
    assert.equal(e.prevented, false);

    // disabled bar ignores the wheel
    settings.updateSettings({ animalEars: false });
    over(bar);
    const frozen = settings.getFeature('animalEarsInterval');
    t.wheel(wheelEvent(-100));
    assert.equal(settings.getFeature('animalEarsInterval'), frozen);

    // overlay panels keep native scrolling
    settings.updateSettings({ animalEars: true });
    state.storageOpen = true; over(bar);
    e = wheelEvent(-100); t.wheel(e);
    assert.equal(e.prevented, false);
});

test('animal rows and tabs stay left of the preview block (right edge ≤ 1460)', async () => {
    const { t } = await setup();
    for (let section = 0; section < 3; section++) {
        for (const row of t.layouts('animal', section)) {
            assert.ok(row.x + row.width <= 1460, `${row.entry[0]} ends at ${row.x + row.width}`);
        }
    }
});

test('tab hover and row hover share one game-colour overlay (no hard-coded hover colour for tabs)', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../src/settings/settings-page.js', import.meta.url), 'utf8');
    assert.ok(!src.includes('#e8f1fb'), 'tab hover must not use its own colour');
    assert.equal((src.match(/drawHoverOverlay\(/g) || []).length, 3, 'definition + tab + row');
    assert.match(src, /function drawHoverOverlay[\s\S]*?globalAlpha = 0\.14[\s\S]*?'Cyan'/);
});

test('hovered tab label lights up like the active one', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../src/settings/settings-page.js', import.meta.url), 'utf8');
    assert.match(src, /active \|\| hover \? 'Black' : '#555555'/);
});
