import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from './helpers/runtime.mjs';
import { themedButtonRuntime } from './helpers/themed-button.mjs';

// R133 changed DrawGetImage: it now returns an ImageBitmap (which has no
// `.complete`) or `undefined` while the image is still loading. R132 returned an
// <img> whose `.complete` is false until loaded. The themed button must draw its
// icon on every "loaded" shape and silently skip every "not loaded" shape.
async function themedDraw(getImage) {
    const { images, draw, original } = await themedButtonRuntime(getImage);
    return { images, run: () => draw([100, 200, 65, 65, 'Menu', 'White', 'icon.png'], original) };
}

test('themed buttons draw icons when DrawGetImage returns an R133 ImageBitmap (no .complete)', async () => {
    const { images, run } = await themedDraw(() => ({ width: 100, height: 100 }));
    run();
    assert.deepEqual(images, [['icon.png', 102, 202, 61, 61]]);
});

test('themed buttons skip the icon without throwing while R133 DrawGetImage returns undefined', async () => {
    const { images, run } = await themedDraw(() => undefined);
    assert.doesNotThrow(run);
    assert.equal(images.length, 0);
});

test('themed buttons still skip a not-yet-loaded R132 <img>', async () => {
    const { images, run } = await themedDraw(() => ({ complete: false, width: 0, height: 0 }));
    assert.doesNotThrow(run);
    assert.equal(images.length, 0);
});

test('R133 moved expression and activity icons under Icons/ but they must stay uncolored', async () => {
    const policy = await runtime().load('src/features/theme/image-policy.js');
    for (const path of ['Icons/Expressions/Eyes/Default.png', './Icons/Activity/Kiss.png', 'Assets/Female3DCG/Activity/Kiss.png']) {
        assert.equal(policy.doColorizeImage(path), false, path);
        assert.equal(policy.doColorizeHTMLImage(path), false, path);
    }
    // plain UI icons keep being themed
    assert.equal(policy.doColorizeImage('Icons/Range/1.png'), true);
});

test('map room scene images (Assets/Map/) must stay uncolored while UI icons keep being themed', async () => {
    const policy = await runtime().load('src/features/theme/image-policy.js');
    for (const path of ['Assets/Map/Objects/Statue/Default.png', './Assets/Map/Tiles/Water/Default.png', 'Assets/Map/Tiles/WallEffect/1.png', 'Assets/Map/Tiles/Fog/Full.png?v=2']) {
        assert.equal(policy.doColorizeImage(path), false, path);
        assert.equal(policy.doColorizeHTMLImage(path), false, path);
    }
    assert.equal(policy.doColorizeImage('Icons/Range/1.png'), true);
});
