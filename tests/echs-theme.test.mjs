import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from './helpers/runtime.mjs';

// ECHS（HypnosisAddon）設定頁：左側分頁按鈕染色 + 右側 MainCanvas.fillText 文字染色

const PALETTE = { main: '#202020', element: '#2e2e2e', elementHover: '#4a4a4a', elementDisabled: '#1a1a1a',
    accent: '#440171', accentHover: '#5a0194', accentDisabled: '#2e014d', text: '#cccccc', textDisabled: '#a3a3a3' };
const NAMED = { white: '#ffffff', black: '#000000', gray: '#808080', grey: '#808080' };
const toHex = c => {
    if (typeof c !== 'string') return null;
    const k = c.trim().toLowerCase();
    if (NAMED[k]) return NAMED[k];
    if (/^#[0-9a-f]{6}$/.test(k)) return k;
    if (/^#[0-9a-f]{3}$/.test(k)) return '#' + [...k.slice(1)].map(x => x + x).join('');
    return null;
};

function fakeCanvas() {
    const calls = [];
    const proto = { fillText(text) { calls.push({ text, style: this.fillStyle }); } };
    const ctx = Object.create(proto);
    ctx.fillStyle = '#000000'; ctx.measureText = () => ({ width: 1 });
    return { ctx, calls, proto };
}

async function setup({ screen = 'Preference', echsOpen = true } = {}) {
    const { ctx, calls } = fakeCanvas();
    const echs = { id: 'echs' };
    const rt = runtime({
        globals: {
            MainCanvas: ctx, CurrentScreen: screen,
            PreferenceExtensionsCurrent: echsOpen ? echs : { id: 'other' },
            PreferenceExtensionsSettings: { HypnosisAddon: echs },
            DrawRect() {}, DrawEmptyRect() {}, DrawTextFit() {}, MouseIn: () => false, MouseHovering: () => false,
        },
        mocks: { 'src/features/theme/theme-colors.js': {
            plainColors: PALETTE, specialColors: {}, composeColors() {}, composeRootCss: () => '',
            getHexComputed: toHex, lighten: v => v, darken: v => v, isDark: () => true,
        } },
    });
    const settings = await rt.load('src/core/feature-settings.js');
    settings.initGlobalFeatures();
    const theme = await rt.load('src/features/theme/index.js');
    theme.installThemeEngine();
    settings.setFeature('themeEnabled', true);
    const rects = [];
    const drawRect = (color) => { rt.hooks.get('DrawRect').call(null, [0, 0, 10, 10, color], a => rects.push(a[4])); return rects.at(-1); };
    // DrawButton hook 會 ensure() 包住 MainCanvas.fillText（真實遊戲裡 ECHS 一定先畫了按鈕）
    rt.hooks.get('DrawButton').call(null, [0, 0, 10, 10, 'x', '#d8d8d8'], () => {});
    return { rt, ctx, calls, settings, drawRect };
}

test('ECHS 左側分頁按鈕色 #d8d8d8 在 ECHS 畫面被染成主題元素色（含 hover/disabled 狀態前綴）', async () => {
    const { drawRect } = await setup();
    assert.equal(drawRect('@~#d8d8d8'), PALETTE.element);
    assert.equal(drawRect('@-#d8d8d8'), PALETTE.element); // lighten 在此測試被 mock 成恆等
    assert.equal(drawRect('@=#d8d8d8'), PALETTE.element);
});

test('#d8d8d8 只在 ECHS 畫面染色，其他畫面不受影響', async () => {
    const other = await setup({ echsOpen: false });
    assert.equal(other.drawRect('@~#d8d8d8'), '#d8d8d8');
    const chat = await setup({ screen: 'ChatRoom' });
    assert.equal(chat.drawRect('@~#d8d8d8'), '#d8d8d8');
});

test('通用對照表不受影響（#dddddd 仍染成元素色）', async () => {
    const { drawRect } = await setup({ echsOpen: false });
    assert.equal(drawRect('@~#dddddd'), PALETTE.element);
});

test('ECHS 右側 fillText：黑字→#CCCCCC，灰字→停用文字色，白字/有色字不動', async () => {
    const { ctx, calls } = await setup();
    for (const style of ['#000000', '#222222', '#808080', '#555555', '#777777', '#ffffff', '#a00000', '#5c3d00']) {
        ctx.fillStyle = style;
        ctx.fillText('t');
    }
    assert.deepEqual(calls.map(c => c.style), [
        '#cccccc', '#cccccc', '#a3a3a3', '#a3a3a3', '#a3a3a3', '#ffffff', '#a00000', '#5c3d00',
    ]);
    assert.equal(ctx.fillStyle, '#5c3d00', '呼叫後 fillStyle 要還原，不影響 ECHS 後續繪圖');
});

test('fillText 染色不洩漏到非 ECHS 畫面，也不洩漏到 ECHS 以外的偏好設定', async () => {
    for (const opts of [{ echsOpen: false }, { screen: 'ChatRoom' }]) {
        const { ctx, calls } = await setup(opts);
        ctx.fillStyle = '#000000'; ctx.fillText('t');
        assert.equal(calls[0].style, '#000000');
    }
});

test('主題關閉時 fillText 完全 passthrough', async () => {
    const { ctx, calls, settings } = await setup();
    settings.setFeature('themeEnabled', false);
    ctx.fillStyle = '#000000'; ctx.fillText('t');
    assert.equal(calls[0].style, '#000000');
});

test('與其他模組（如翻譯補丁）疊在同一個 fillText 上時鏈結正常，且只包一次', async () => {
    const { rt, ctx, calls } = await setup();
    const mine = ctx.fillText;
    const outer = function (...a) { return mine.apply(this, a); };
    ctx.fillText = outer; // 翻譯補丁疊在上面
    rt.hooks.get('DrawButton').call(null, [0, 0, 10, 10, 'x', '#d8d8d8'], () => {}); // 重複 ensure 不得再包一層
    assert.equal(ctx.fillText, outer);
    ctx.fillStyle = '#000000'; ctx.fillText('t');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].style, '#cccccc');
});

test('漸層/圖樣 fillStyle（非字串）直接放行', async () => {
    const { ctx, calls } = await setup();
    const gradient = { addColorStop() {} };
    ctx.fillStyle = gradient; ctx.fillText('t');
    assert.equal(calls[0].style, gradient);
});
