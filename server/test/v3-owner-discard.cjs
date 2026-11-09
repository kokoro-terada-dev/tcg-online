const { test } = require('node:test');
const assert = require('node:assert/strict');
const { io } = require('socket.io-client');
const { setup: fixture, finish, id, always } = require('./helpers/v3-observed.cjs');
const { V3SyntheticMatchCoordinator } = require('../dist/test/effects/v3/matchCoordinator.js');
const sessions = require('../dist/test/effects/v3/sessionFixtures.js');
const { startLocalV3Server } = require('../dist/test/effects/v3/localServer.js');

const discard = count => ({ type: 'DISCARD_BY_OWNER', player: 'OPPONENT', chooser: 'OPPONENT', count });
const draw = { type: 'DRAW', player: 'SELF', count: 1 };
const deck = { name: 'Fixture', leaderCardId: 'LEADER', mainDeck: Array(50).fill('CARD'), donDeck: Array(10).fill('DON'), cardTypes: { CARD: 'character' }, leaderLifeCount: 5 };
const state = c => c.snapshotForCoordinator().movement;
function setup({ count = 1, hand = 5, watcher = false, actor = 0 } = {}) {
  const { options } = fixture({ count: watcher ? 2 : 1, mutate(raw) {
    raw.schemaVersion = '3.0.0-subset.32';
    Object.assign(raw.effects[0], { kind: 'activated', timing: { type: 'MAIN' }, actions: [discard(count), draw] });
    if (watcher) Object.assign(raw.effects[1].timing, { event: 'CARD_MOVED', owner: 'OPPONENT', controller: 'OPPONENT', toZones: ['trash'] });
  }, mutateBoard(b) {
    const p = b.players[1 - actor];
    for (const card of p.hand.splice(hand)) { p.deck.push(card); b.cards[card].faceUp = false; }
    p.hand.forEach((card, i) => { b.cards[card].cardId = `PRIVATE-${p.hand.length - i}`; });
  } });
  const progression = { ...options.progression, activePlayer: actor };
  return new V3SyntheticMatchCoordinator({ ...options, progression });
}
const activate = (c, actor) => {
  const e = c.mainEffectsFor(actor)[0];
  return c.activateMain(actor, id(), c.context(), e.sourceToken, e.effectId);
};

test('two sockets: only the hand owner sees candidates; the controller sees the committed discard and its trigger', async t => {
  const c = setup({ watcher: true }), initial = state(c), images = Object.fromEntries(initial.players[1].hand.map(instance => {
    const { cardId } = initial.cards[instance]; return [cardId, 'IMAGE-' + cardId];
  }));
  t.mock.method(sessions, 'createSyntheticSession', () => ({ matchId: initial.matchId, coordinator: c, imageAliases: images }));
  const service = await startLocalV3Server(), clients = [];
  t.after(async () => { clients.forEach(client => client.disconnect()); await new Promise(resolve => service.io.close(resolve)); });
  for (let i = 0; i < 3; i++) {
    const client = io(service.url, { autoConnect: false, reconnection: false }); clients.push(client);
    await new Promise((resolve, reject) => { client.once('connect', resolve); client.once('connect_error', reject); client.connect(); });
  }
  const [controller, owner, outsider] = clients, packets = [];
  controller.on('v3-session:state', view => packets.push(view));
  const call = (client, event, payload = null) => new Promise((resolve, reject) => client.timeout(3000).emit(event, payload, (err, reply) => err ? reject(err) : resolve(reply)));
  const created = new Promise(resolve => controller.once('v3-room:state', resolve));
  assert.equal((await call(controller, 'v3-room:create')).ok, true);
  assert.equal((await call(owner, 'v3-room:join', (await created).roomId)).ok, true);
  for (const client of [controller, owner]) {
    assert.equal((await call(client, 'v3-room:deck', deck)).ok, true);
    assert.equal((await call(client, 'v3-room:ready', true)).ok, true);
  }
  assert.equal((await call(controller, 'v3-session:start', { firstPlayer: 0 })).ok, true);
  const sync = async client => (await call(client, 'v3-session:sync')).sessionView;
  const command = (view, kind, extra = {}) => ({ matchId: view.matchId, context: view.context, kind, requestId: id(), ...extra });
  const send = (client, input) => call(client, 'v3-session:command', input);
  const ok = async (client, input) => { const reply = await send(client, input); assert.equal(reply.ok, true); return reply.sessionView; };
  const initialView = await sync(controller), source = initialView.effects[0];
  let a = await ok(controller, command(initialView, 'activate', { effectId: source.effectId, sourceToken: source.sourceToken }));
  a = await ok(controller, command(a, 'advance'));
  const b = await sync(owner), q = b.frame.choice, picked = q.options[1], other = q.options.filter(row => row !== picked);
  assert.equal(a.resolutionActor, 0); assert.equal(q.chooser, 1); assert.equal(q.purpose, 'ownerDiscard'); assert.equal(q.options.length, 5);
  assert.deepEqual(a.frame.choice.options, []);
  assert.equal(b.imageAliases[picked.cardId], images[picked.cardId]); assert.equal(a.imageAliases[picked.cardId], undefined);
  const assertPrivate = payload => {
    const serialized = JSON.stringify(payload);
    for (const candidate of q.options) { assert(!serialized.includes(candidate.cardId)); assert(!serialized.includes(candidate.token)); }
    for (const instance of initial.players[1].hand) assert(!serialized.includes(instance));
  };
  assertPrivate(a); assert.equal((await call(outsider, 'v3-session:sync')).sessionView, undefined);
  const details = { selectionId: q.selectionId, tokens: [picked.token] };
  const bad = await send(controller, command(a, 'answer', details));
  assert.equal(bad.ok, false); assertPrivate(bad);
  assert.equal((await send(owner, command(b, 'answer', { ...details, tokens: ['fake-token'] }))).ok, false);
  assert.equal((await send(owner, command({ ...b, context: { ...b.context, frameRevision: b.context.frameRevision - 1 } }, 'answer', details))).ok, false);
  const input = command(b, 'answer', details);
  const accepted = await ok(owner, input);
  assert.equal(accepted.frame.status, 'waitingForWork');
  await ok(owner, input);
  a = await sync(controller);
  assertPrivate(a); packets.forEach(assertPrivate);
  assert.deepEqual(state(c), initial);
  assert.equal((await send(owner, command(accepted, 'work'))).ok, false);
  const work = command(a, 'work');
  a = await ok(controller, work);
  await ok(controller, work);
  assert.equal(a.movement.players[1].trash.at(-1).cardId, picked.cardId);
  assert.equal(a.imageAliases[picked.cardId], images[picked.cardId]);
  assert(a.movement.players[1].hand.every(card => card.cardId === null && card.ref === null));
  for (const card of other) assert(!JSON.stringify(a).includes(card.cardId));
  assert.deepEqual(a.triggerChoices, []);
  const [event] = c.snapshotForCoordinator().active.movementEvents;
  assert.equal(event.cause.kind, 'EFFECT_MOVE'); assert.equal(event.cause.actor, 0); assert.equal(event.cause.effectController, 0);
  assert.equal(event.from.player, 1); assert.equal(event.isKO, false); assert.equal(event.after.generation, event.before.generation + 1);
  for (const kind of ['advance', 'work', 'advance']) a = await ok(controller, command(a, kind));
  assert.equal(a.triggerChoices[0].effectId, 'watch-1');
});

test('shortage requires only the available cards, empty hand skips, and relative seats are respected', () => {
  for (const hand of [0, 2]) {
    const c = setup({ actor: 1, hand, count: 3 }), before = state(c);
    activate(c, 1); finish(c, 1);
    if (hand) {
      const q = c.viewFor(0).frame.choice;
      assert.equal(q.chooser, 0); assert.equal(q.min, hand); assert.equal(q.max, hand);
      const tokens = q.options.map(card => card.token);
      for (const invalid of [[], [tokens[0]], [tokens[0], tokens[0]]]) assert.throws(() => c.answer(0, id(), c.context(), q.selectionId, invalid));
      c.answer(0, id(), c.context(), q.selectionId, tokens);
      assert.deepEqual(state(c), before);
      finish(c, 1);
    } else assert.equal(c.viewFor(1).frame.choice, null);
    assert.equal(state(c).players[0].hand.length, 0);
    assert.deepEqual(state(c).players[0].trash.map(id => state(c).cards[id].cardId), hand ? ['PRIVATE-1', 'PRIVATE-2'] : []);
    assert.equal(state(c).players[1].hand.length, before.players[1].hand.length + 1);
  }
});
