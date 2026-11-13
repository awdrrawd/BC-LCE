import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from './helpers/runtime.mjs';
import { fakeClock } from './helpers/clock.mjs';

async function presenceFixture(style = 'bubble') {
    const clock = fakeClock();
    const handlers = new Map();
    const queries = [], sounds = [], locals = [], displayed = [];
    const manager = {
        queue: [], blocked: false,
        info(text, options) { this.queue.push({ text, ...options }); this._process(); },
        _process() { if (!this.blocked) displayed.push(...this.queue.splice(0)); },
    };
    const rt = runtime({ globals: {
        ...clock.globals, CurrentScreen: 'ChatRoom', ServerIsConnected: true,
        ServerSocket: { connected: true, on: (name, fn) => handlers.set(name, fn), off: name => handlers.delete(name) },
        ServerSend: (event, data) => queries.push({ event, query: data.Query, at: clock.globals.Date.now() }),
        ToastManager: manager, AudioPlayInstantSound: (...args) => sounds.push(args),
        ChatRoomSendLocal: (...args) => locals.push(args),
    }, append: { 'src/features/social/friend-presence.js': '\nexport const pendingCount = () => pendingChanges.size;' }, mocks: {
        'src/core/feature-settings.js': { getFeature: key => key.endsWith('Notify') ? style : true },
        'src/core/wce-compat.js': { isWceFeatureEnabled: key => key === 'instantMessenger' },
        'src/core/i18n.js': { T: key => `${key}: {list}` },
    } });
    const presence = await rt.load('src/features/social/friend-presence.js');
    presence.installFriendPresence();
    const receive = ids => handlers.get('AccountQueryResult')({ Query: 'OnlineFriends',
        Result: ids.map(MemberNumber => ({ MemberNumber, MemberName: `Friend${MemberNumber}` })) });
    return { rt, clock, manager, queries, sounds, locals, displayed, receive, pendingCount: presence.pendingCount };
}


test('presence confirms stable changes, cancels flapping and batches each direction without slowing polling', async () => {
    const { rt, clock, queries, receive, displayed, pendingCount } = await presenceFixture();
    receive([1, 4]); // Initial list is a baseline, not a mass login event.
    clock.advance(1000);
    const round = ids => { clock.advance(20000); receive(ids); };
    round([1, 2, 3, 4]);
    receive([1, 2, 3, 4]); // An extra reply in the same round is not confirmation.
    assert.equal(displayed.length, 0);
    round([2, 3, 4]);
    assert.deepEqual(displayed.map(c => c.text), ['friend_now_online: Friend2 (2), Friend3 (3)']);
    round([1, 2, 3, 4, 5]); // Friend1 reconnects before offline confirmation.
    round([1, 2, 3, 4]); // Friend5 disconnects before online confirmation.
    assert.equal(displayed.length, 1);
    assert.equal(pendingCount(), 0, 'cancelled transient logins leave no retained candidate');
    round([2, 3, 6, 7]);
    round([2, 3, 6, 7]);
    assert.deepEqual(displayed.slice(1).map(c => c.text), [
        'friend_now_online: Friend6 (6), Friend7 (7)',
        'friend_now_offline: Friend1 (1), Friend4 (4)',
    ]);
    receive([2, 3, 6, 7]);
    assert.equal(displayed.length, 3);
    assert.deepEqual(queries.map(q => q.at), [20000, 40000, 60000, 80000, 100000, 120000]);
    assert.ok(queries.every(q => q.event === 'AccountQuery' && q.query === 'OnlineFriends'));
    // A skipped screen must not silently consume a logout and produce another login.
    rt.context.CurrentScreen = 'FriendList';
    receive([]);
    rt.context.CurrentScreen = 'ChatRoom';
    round([2, 3, 6, 7]); round([2, 3, 6, 7]);
    assert.equal(displayed.length, 3);
    round([]); round([]);
    assert.match(displayed.at(-1).text, /^friend_now_offline:/);
    rt.context.CurrentScreen = 'Relog';
    clock.advance(3600000); receive([2]);
    rt.context.CurrentScreen = 'ChatRoom';
    round([2]); round([2]);
    assert.equal(displayed.at(-1).text, 'friend_now_online: Friend2 (2)');
    round([2, 99]);
    assert.equal(pendingCount(), 1);
    clock.advance(40000);
    assert.equal(pendingCount(), 0, 'unanswered candidates expire after two polling rounds');
});

test('confirmed background notifications survive a busy native queue without replay or deleting other cards', async () => {
    const { rt, manager, receive, clock, displayed, sounds, locals, queries } = await presenceFixture('both');
    receive([]);
    manager.blocked = true;
    manager.queue.push({ text: 'other', category: 'private-message' });
    rt.document.hidden = true; rt.document.dispatchEvent({ type: 'visibilitychange' });
    const round = ids => { clock.advance(20000); receive(ids); };
    round([1]); round([1]); round([2]); round([2]);
    clock.advance(15000);
    assert.equal(manager.queue.length, 4);
    assert.equal(sounds.length, 3); assert.equal(locals.length, 3);
    rt.document.hidden = false; rt.document.dispatchEvent({ type: 'visibilitychange' });
    assert.equal(queries.length, 4, 'focus changes do not create extra queries');
    manager.blocked = false; manager._process();
    receive([2]);
    assert.equal(displayed.length, 4);
    assert.equal(displayed[0].category, 'private-message');
});

test('missing replies and disconnections cannot confirm stale changes or stop subsequent polling', async () => {
    const { rt, clock, queries, receive, displayed, manager } = await presenceFixture();
    receive([]);
    clock.advance(20000); receive([1]);
    clock.advance(20000); // Missing reply: do not confirm using the old candidate.
    clock.advance(20000); receive([1]);
    assert.equal(displayed.length, 0);
    rt.context.ServerIsConnected = false;
    clock.advance(20000);
    rt.context.ServerIsConnected = true;
    rt.context.ServerSocket.connected = false;
    clock.advance(20000);
    rt.context.ServerSocket.connected = true;
    clock.advance(20000); receive([1]);
    assert.equal(displayed.length, 0);
    clock.advance(20000); receive([1]);
    assert.equal(displayed.length, 1);
    assert.deepEqual(queries.map(q => q.at), [20000, 40000, 60000, 120000, 140000]);
    const info = manager.info;
    manager.info = () => { throw Error('temporary display failure'); };
    clock.advance(20000); receive([]);
    clock.advance(20000); receive([]);
    assert.equal(displayed.length, 1);
    manager.info = info;
    for (let i = 0; i < 2; i++) { clock.advance(20000); receive([]); }
    assert.equal(displayed.at(-1).text, 'friend_now_offline: Friend1 (1)');
    for (let i = 0; i < 2; i++) { clock.advance(20000); receive([1]); }
    assert.deepEqual(displayed.map(c => c.text), [
        'friend_now_online: Friend1 (1)', 'friend_now_offline: Friend1 (1)', 'friend_now_online: Friend1 (1)',
    ]);
});
