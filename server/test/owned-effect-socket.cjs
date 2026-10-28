const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { Server } = require('socket.io');
const { io: client } = require('socket.io-client');
const { createMatch, applyCommand } = require('../dist/test/game.js');
const { createProgression } = require('../dist/test/progression/state.js');
const { applySystemEvent } = require('../dist/test/progression/transitions.js');
const { EffectMatchOwner } = require('../dist/test/effects/effectMatchOwner.js');
const { OwnedEffectEndpoint } = require('../dist/test/effects/ownedEffectEndpoint.js');
const { bindEffectSocket } = require('../dist/test/effects/effectSocket.js');
const rules = { status: 'certifiedNone' };
const recipe = () => ({ name: 'Test', leaderCardId: 'LEADER', mainDeck: Array(50).fill('CHAR'), donDeck: Array(10).fill('DON'), cardTypes: { CHAR: 'character' }, leaderLifeCount: 5 });
const once = (socket, name) => new Promise((resolve, reject) => {
  const listener = value => { clearTimeout(timer); resolve(value); };
  const timer = setTimeout(() => { socket.off(name, listener); reject(Error(`Missing ${name}`)); }, 3000); socket.once(name, listener);
});
const request = (socket, name, ...args) => new Promise((resolve, reject) => socket.timeout(3000).emit(name, ...args, (error, result) => error ? reject(error) : resolve(result)));
const sync = socket => request(socket, 'test-effect:sync');
async function setup(t, actor = 0) {
  const match = createMatch(recipe(), recipe()), owner = new EffectMatchOwner(match); let p = createProgression(actor);
  while (true) { p = applySystemEvent(p, p.revision, { kind: 'settlePhase', phaseToken: p.phaseToken }); if (p.phase === 'main') break; p = applySystemEvent(p, p.revision, { kind: 'advancePhase', phaseToken: p.phaseToken }); }
  owner.adopt(p); const endpoint = new OwnedEffectEndpoint(owner), http = createServer(), io = new Server(http, { transports: ['websocket'] }), members = new Map(), clients = [];
  io.on('connection', socket => bindEffectSocket(io, socket, id => members.get(id) ?? null));
  t.after(async () => { clients.forEach(c => c.disconnect()); await new Promise(resolve => io.close(resolve)); });
  await new Promise((resolve, reject) => { http.once('error', reject); http.listen(0, '127.0.0.1', resolve); });
  for (let seat = 0; seat < 2; seat++) {
    const c = client(`http://127.0.0.1:${http.address().port}`, { transports: ['websocket'], autoConnect: false, reconnection: false }); clients.push(c);
    const connected = once(c, 'connect'); c.connect(); await connected;
  }
  const socketIds = clients.map(c => c.id); for (const seat of [0, 1]) members.set(clients[seat].id, { host: endpoint, actor: seat, socketIds });
  function open(id, actions = [], guard = rules, source) {
    owner.openEffect({ resolutionId: id, actor, source: source ?? { instanceId: match.players[actor].zones.leader[0].id, generation: 0 } },
      { dslVersion: 1, effectId: 'test', cardId: source ? 'CHAR' : 'LEADER', trigger: { kind: 'activate', window: 'main' }, costs: [], actions }, guard);
  }
  function command(view, kind, id) {
    const value = { kind, requestId: id, matchId: view.matchId, resolutionId: view.effect.resolutionId,
      expectedMovementRevision: view.movement.revision, expectedProgressionRevision: view.progression.revision };
    if (kind === 'answerEffect') { value.selectionId = view.selection.selectionId; value.tokens = [view.selection.candidates[0].token]; }
    return value;
  }
  async function send(kind, id) {
    const before = await sync(clients[actor]); assert.equal(before.ok, true);
    const updates = clients.map(c => once(c, 'test-effect:state'));
    const input = command(before.view, kind, id), response = await request(clients[actor], 'test-effect:command', input);
    const views = await Promise.all(updates); return { response, views, input };
  }
  return { owner, endpoint, match, clients, actor, open, send, command };
}
const select = zone => ({ kind: 'select', saveAs: 'selected', selector: { kind: 'cards', chooser: 'SELF', owner: 'SELF', zones: [zone], min: 1, max: 1, mode: 'SELECT' } });
const move = zone => ({ kind: 'move', cards: { kind: 'ref', from: 'VARIABLE', name: 'selected' }, destination: { owner: 'SELF', zone, position: zone === 'character' ? 'firstEmpty' : 'append', visibility: 'faceUp' }, cause: 'EFFECT_MOVE' });

test('owned socket: a real Match supports successive effects without resetting generation or overwriting legacy state', async t => {
  for (const actor of [0, 1]) {
    const s = await setup(t, actor), original = structuredClone(s.match); s.open('first', [select('hand'), move('character')]);
    await s.send('start', 'a'); const selection = await s.send('advance', 'b');
    assert.equal(selection.views[1 - actor].selection, null); await s.send('answerEffect', 'c');
    const placed = await s.send('advance', 'd'); const card = placed.views[actor].movement.players[actor].character[0];
    assert.equal(card.ref.generation, 1); s.owner.finishEffect();
    s.open('second', [select('character'), move('trash')], rules, card.ref);
    await s.send('start', 'a'); await s.send('advance', 'b'); await s.send('answerEffect', 'c'); const removed = await s.send('advance', 'd');
    assert.equal(removed.views[actor].movement.players[actor].trash[0].ref.generation, 2);
    assert.equal(removed.response.view.effect.status, 'completed'); s.owner.finishEffect(); assert.deepEqual(s.match, original);
  }
});
test('owned socket: previous-resolution commands are rejected after switching through the same endpoint', async t => {
  const s = await setup(t); s.open('first'); const first = await s.send('start', 'same-request'); s.owner.finishEffect(); s.open('second');
  const stale = await request(s.clients[0], 'test-effect:command', first.input);
  assert.equal(stale.code, 'wrong_context'); assert.equal(stale.view.effect.resolutionId, 'second');
  const second = await s.send('start', 'same-request'); assert.equal(second.response.ok, true); assert.equal(second.response.replayed, false);
});
test('owned socket: close and the gap between resolutions expose no stale view', async t => {
  const s = await setup(t); s.open('first'); await s.send('start', 'start'); s.owner.finishEffect();
  assert.deepEqual(await sync(s.clients[0]), { ok: false, code: 'not_available' });
  s.open('second'); assert.equal((await sync(s.clients[1])).ok, true);
  s.owner.close(); assert.deepEqual(await sync(s.clients[0]), { ok: false, code: 'not_available' });
  assert.deepEqual(await sync(s.clients[1]), { ok: false, code: 'not_available' }); assert.throws(() => JSON.stringify(s.endpoint), /server-only/);
});
test('owned socket: bypassed legacy changes cause a closed boundary rather than competing updates', async t => {
  const s = await setup(t); s.open('first');
  applyCommand(s.match, 0, { kind: 'draw', matchId: s.match.id, requestId: 'bypass', expectedRevision: 0 });
  assert.deepEqual(await sync(s.clients[0]), { ok: false, code: 'not_available' }); assert.equal(s.owner.snapshot().mode, 'faulted');
  assert.deepEqual(await sync(s.clients[1]), { ok: false, code: 'not_available' }); assert.equal(s.owner.snapshot().movement.revision, 0);
});
test('owned socket: conflicts during effect execution retain actual state but do not deliver obsolete responses', async t => {
  const s = await setup(t); s.open('first', [{ kind: 'draw', player: 'SELF', amount: 1 }], { status: 'evaluate', check() {
    applyCommand(s.match, 0, { kind: 'draw', matchId: s.match.id, requestId: 'bypass', expectedRevision: 0 }); return { kind: 'allow' };
  } });
  await s.send('start', 'start'); const current = (await sync(s.clients[0])).view;
  const response = await request(s.clients[0], 'test-effect:command', s.command(current, 'advance', 'draw'));
  assert.deepEqual(response, { ok: false, code: 'not_available' }); assert.equal(s.owner.snapshot().mode, 'faulted');
  assert.equal(s.owner.snapshot().movement.revision, 2); assert.equal(s.match.revision, 1);
});
