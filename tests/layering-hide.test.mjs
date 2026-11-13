import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime, Element } from './helpers/runtime.mjs';

async function setup({ self = true, capable = false, hide = [], propertyHide = [] } = {}) {
    const character = { IsPlayer: () => self, BCECapabilities: capable ? ['layeringHide'] : [] };
    const layering = { Character: character, Asset: { Hide: hide }, Item: { Property: { Hide: propertyHide } }, ID: { root: 'layering' }, _CharacterRefresh() {} };
    const rt = runtime({
        globals: { Player: {}, Layering: layering, CurrentScreen: 'Appearance', GameVersion: 'R133' },
        mocks: {
            'src/core/feature-settings.js': { getFeature: () => true },
            'src/core/wce-compat.js': { isWceFeatureEnabled: () => false, shouldLceHandle: () => true },
            'src/core/util.js': { injectStyle() {}, removeStyle() {} },
        },
    });
    const create = options => {
        if (options instanceof Element) return options;
        if (typeof options === 'string') return options;
        const element = new Element(options.tag);
        for (const [key, value] of Object.entries(options.attributes ?? {})) {
            if (key === 'id') element.id = value;
            element.setAttribute(key, value);
        }
        element.classList.add(...(options.classList ?? []));
        element.append(...(options.children ?? []).map(create));
        return element;
    };
    Object.assign(rt.context, {
        ElementCreate: create,
        ElementCheckbox: { Create: (id, change, options) => {
            const input = new Element('input'); input.id = id;
            Object.assign(input, options); input.change = change;
            return input;
        } },
        ElementButton: { Create: (id, click) => {
            const button = new Element('button'); button.id = id; button.click = click;
            return button;
        } },
    });
    const root = create({ tag: 'div', attributes: { id: 'layering' }, children: [
        { tag: 'div', children: [{ tag: 'button', attributes: { id: 'layering-tab-rotate' } }] },
        { tag: 'div', attributes: { id: 'layering-content-container' } },
    ] });
    const rotate = root.querySelector('#layering-tab-rotate');
    rotate.after = node => rotate.parentElement.append(node);
    rt.document.body.append(root);
    (await rt.load('src/features/wardrobe/layering-hide.js')).installLayeringHide();
    await rt.hooks.get('Layering.Load')([], async () => {});
    return { rt, root, layering };
}

test('R133 self layering adds a Hide tab for property-based hiding without a remote capability', async () => {
    const { rt, root } = await setup({ propertyHide: ['Bra', 'Panties'] });
    root.querySelector('#layering-tab-lce-hide').click();
    assert.equal(root.querySelectorAll('input').length, 2);
    const contents = rt.hooks.get('Layering._GetTabContents')(['lce-hide'], () => { throw Error('unknown native tab'); });
    assert.equal(contents.length, 1);
    assert.equal(contents[0].querySelectorAll('input').length, 2);
    assert.deepEqual(rt.warnings, []);
});

test('hide choices combine asset and property slots without duplicates', async () => {
    const { root } = await setup({ hide: ['Bra'], propertyHide: ['Bra', 'Panties'] });
    root.querySelector('#layering-tab-lce-hide').click();
    assert.deepEqual(root.querySelectorAll('input').map(input => input.value), ['Bra', 'Panties']);
});

test('other characters still require capabilities and non-hiding items have no Hide tab', async () => {
    for (const options of [{ self: false, hide: ['Bra'] }, {}]) {
        const { root } = await setup(options);
        assert.equal(root.querySelector('#layering-tab-lce-hide'), null);
    }
    const { root } = await setup({ self: false, capable: true, hide: ['Bra'] });
    assert.ok(root.querySelector('#layering-tab-lce-hide'));
});
