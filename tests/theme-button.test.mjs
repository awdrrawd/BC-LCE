import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from './helpers/runtime.mjs';

test('themed buttons keep icons at their original inset while fitting oversized images', async () => {
    const images = [];
    const rt = runtime({
        globals: {
            DrawRect() {}, DrawEmptyRect() {}, DrawTextFit() {},
            MouseHovering: () => false,
            DrawGetImage: () => ({ complete: true, width: 100, height: 100 }),
            RectMakeRect: (...frame) => frame,
            DrawingResizeMode: { ShowFullOriginalRatio: 1 },
            RectFitIntoRect: (source, target) => {
                const scale = Math.min(target[2] / source[2], target[3] / source[3]);
                const w = source[2] * scale, h = source[3] * scale;
                return [source, [target[0] + (target[2] - w) / 2, target[1] + (target[3] - h) / 2, w, h]];
            },
            DrawImageResize: (...args) => images.push(args),
        },
        mocks: { 'src/features/theme/theme-colors.js': {
            plainColors: { main: '#222222', accent: '#777777', text: '#eeeeee' },
            specialColors: {}, composeColors() {}, composeRootCss: () => '',
            getHexComputed: v => v, lighten: v => v, darken: v => v, isDark: () => true,
        } },
    });
    const settings = await rt.load('src/core/feature-settings.js');
    settings.initGlobalFeatures();
    const theme = await rt.load('src/features/theme/index.js');
    theme.installThemeEngine();
    settings.setFeature('themeEnabled', true);
    const draw = rt.hooks.get('DrawButton');
    const original = () => assert.fail('Active theme should draw the button');
    // BCX-style wide menu, square toolbar, and tall button: neither axis may move.
    for (const [w, h] of [[400, 90], [65, 65], [65, 100]]) {
        draw([100, 200, w, h, 'Menu', 'White', 'icon.png'], original);
        const size = Math.min(w, h) - 4;
        assert.deepEqual(images.pop(), ['icon.png', 102, 202, size, size]);
    }
    draw([100, 200, 400, 90, 'Menu', 'White', ''], original);
    assert.equal(images.length, 0);
    settings.setFeature('themeEnabled', false);
    const args = [100, 200, 400, 90, 'Menu', 'White', 'icon.png'];
    let forwarded;
    draw(args, values => { forwarded = values; });
    assert.equal(forwarded, args);
    assert.equal(images.length, 0);
});
