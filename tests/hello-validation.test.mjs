import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from './helpers/runtime.mjs';

// 招呼訊息來自房裡任何玩家：版本與能力清單必須先驗證型別與長度才能存進角色。
// 被測模組跑在 vm 的另一個 realm，陣列原型不同，deepStrictEqual 會誤判，所以比對前先轉成純資料。
const plain = value => JSON.parse(JSON.stringify(value));
async function setup() {
    const handlers = {};
    const sender = { MemberNumber: 7 };
    const rt = runtime({
        globals: {
            ServerSocket: { on: (event, handler) => { handlers[event] = handler; }, off() {} },
            Character: [sender],
            ChatRoomCharacter: [],
            Player: { MemberNumber: 1 },
        },
    });
    const hello = await rt.load('src/features/social/hello.js');
    hello.installHello();
    const send = (content, message) => handlers.ChatRoomMessage({
        Type: 'Hidden', Content: content, Sender: sender.MemberNumber,
        Dictionary: [{ message: { type: 'Hello', ...message } }],
    });
    return { hello, sender, send };
}

test('sanitizeVersion and sanitizeCapabilities only keep well-formed values', async () => {
    const { hello } = await setup();
    assert.equal(hello.sanitizeVersion('5.4.1'), '5.4.1');
    for (const bad of [123, {}, [], null, undefined, '', 'x'.repeat(33)]) assert.equal(hello.sanitizeVersion(bad), '0.0');
    assert.equal(hello.sanitizeVersion('x'.repeat(32)), 'x'.repeat(32));

    assert.deepEqual(plain(hello.sanitizeCapabilities(['a', 'b'])), ['a', 'b']);
    for (const bad of ['layering', 5, {}, null, undefined]) assert.deepEqual(plain(hello.sanitizeCapabilities(bad)), []);
    assert.deepEqual(plain(hello.sanitizeCapabilities(['ok', 1, null, {}, '', 'y'.repeat(65), 'fine'])), ['ok', 'fine']);
    assert.equal(hello.sanitizeCapabilities(Array.from({ length: 500 }, (_, i) => `c${i}`)).length, 32);
});

test('a WCE-style hello with malformed fields cannot plant non-string versions or non-array capabilities', async () => {
    const { sender, send } = await setup();
    send('BCEMsg', { version: 123, capabilities: 'layering' });
    assert.equal(sender.FBC, '0.0');
    assert.deepEqual(plain(sender.BCECapabilities), []);

    send('BCEMsg', { version: { split: 1 }, capabilities: { includes: 1 } });
    assert.equal(sender.FBC, '0.0');
    assert.deepEqual(plain(sender.BCECapabilities), []);

    send('BCEMsg', { version: '5.4.1', capabilities: ['layering', 7] });
    assert.equal(sender.FBC, '5.4.1');
    assert.deepEqual(plain(sender.BCECapabilities), ['layering']);
});

test('an LCE hello keeps valid versions and rejects malformed markers', async () => {
    const { sender, send } = await setup();
    send('BCEMsg', { lce: '2.0.1', version: '9.9', capabilities: ['layering'] });
    assert.equal(sender.LCE, '2.0.1');
    assert.equal(sender.FBC, undefined, 'the LCE marker must not touch the WCE badge field');
    assert.deepEqual(plain(sender.BCECapabilities), ['layering']);

    send('BCEMsg', { lce: {}, version: 5 });
    assert.equal(sender.LCE, '0.0');

    send('LCEMsg', { version: 'x'.repeat(100) });
    assert.equal(sender.LCE, '0.0');
});
