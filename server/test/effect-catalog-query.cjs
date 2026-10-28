const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { Server } = require('socket.io');
const { io: client } = require('socket.io-client');
const { createMatch } = require('../dist/test/game.js');
const { createProgression } = require('../dist/test/progression/state.js');
const { applySystemEvent } = require('../dist/test/progression/transitions.js');
const { EffectCatalog } = require('../dist/test/effects/effectCatalog.js');
const { EffectMatchOwner } = require('../dist/test/effects/effectMatchOwner.js');
const { OwnedEffectEndpoint } = require('../dist/test/effects/ownedEffectEndpoint.js');
const { bindEffectSocket } = require('../dist/test/effects/effectSocket.js');
const definition = { dslVersion: 1, effectId: 'LEADER.main', cardId: 'LEADER', trigger: { kind: 'activate', window: 'main' }, costs: [], actions: [{ kind: 'draw', player: 'SELF', amount: 1 }] };
function fixture(actor = 0, missing = false, faceDown = false) {
  const recipe = { name: 'Test', leaderCardId: 'LEADER', mainDeck: Array(50).fill('CHAR'), donDeck: Array(10).fill('DON'), cardTypes: { CHAR: 'character' }, leaderLifeCount: 5 };
  const match = createMatch(recipe, recipe); match.players[actor].zones.leader[0].faceUp = !faceDown;
  const catalog = new EffectCatalog([definition, { ...structuredClone(definition), effectId: 'LEADER.counter', trigger: { kind: 'activate', window: 'counter' } }, { ...structuredClone(definition), effectId: 'LEADER.onPlay', trigger: { kind: 'event', event: 'onPlay' } }]);
  const owner = new EffectMatchOwner(match, missing ? null : catalog); let p = createProgression(actor);
  while (true) { p = applySystemEvent(p, p.revision, { kind: 'settlePhase', phaseToken: p.phaseToken }); if (p.phase === 'main') break; p = applySystemEvent(p, p.revision, { kind: 'advancePhase', phaseToken: p.phaseToken }); }
  owner.adopt(p); const source = { instanceId: match.players[actor].zones.leader[0].id, generation: 0 };
  owner.openEffect({ resolutionId: 'r', actor, source }, definition, { status: 'certifiedNone' });
  const endpoint = new OwnedEffectEndpoint(owner);
  function query(ref = source) { const v = owner.effectViewFor(actor); return { matchId: v.matchId, expectedMovementRevision: v.movement.revision, expectedProgressionRevision: v.progression.revision, source: ref }; }
  return { owner, endpoint, match, catalog, source, query };
}
test('own face-up board queries return pinned summaries and timing only, without mutating state', () => {
  for (const actor of [0, 1]) {
    const s = fixture(actor), before = s.owner.snapshot(), result = s.endpoint.catalogFor(actor, s.query());
    assert.equal(result.catalogVersion, s.catalog.version); assert.equal(result.effects.length, 3);
    assert.equal(result.effects.find(e => e.effectId === 'LEADER.main').timingAvailable, true);
    assert.equal(result.effects.find(e => e.effectId === 'LEADER.counter').timingAvailable, false);
    assert.equal(result.effects.find(e => e.effectId === 'LEADER.onPlay').timingAvailable, false);
    assert.ok(result.effects.every(e => e.status === 'schemaOnly')); assert.equal(Object.isFrozen(result.effects), true);
    assert.equal(JSON.stringify(result).includes('actions'), false); assert.equal(JSON.stringify(result).includes('costs'), false);
    assert.equal(s.owner.snapshot().movement, before.movement); assert.equal(s.owner.snapshot().progression, before.progression);
  }
});
test('opponent, off-board, unknown and stale sources cannot disclose registered metadata', () => {
  const s = fixture();
  for (const ref of [{ instanceId: s.match.players[1].zones.leader[0].id, generation: 0 }, { instanceId: s.match.players[0].zones.hand[0].id, generation: 0 }, { instanceId: 'unknown', generation: 0 }, { ...s.source, generation: 1 }]) assert.throws(() => s.endpoint.catalogFor(0, s.query(ref)));
  assert.throws(() => s.endpoint.catalogFor(1, s.query()));
});
test('both revisions and Match context are checked on queries', () => {
  const s = fixture();
  for (const patch of [{ matchId: 'other' }, { expectedMovementRevision: 99 }, { expectedProgressionRevision: 99 }]) assert.throws(() => s.endpoint.catalogFor(0, { ...s.query(), ...patch }));
});
test('invalid facedown field card is rejected before catalog access', () => {
  assert.throws(() => fixture(0, false, true), /invalid-field-card/);
});
test('missing catalog stays explicit rather than claiming that the card has no effects', () => {
  const s = fixture(0, true), result = s.endpoint.catalogFor(0, s.query()); assert.equal(result.catalogVersion, null); assert.deepEqual(result.effects, []);
});
test('malformed input rejects actor spoofing and accessors before reading them', () => {
  const s = fixture(); assert.throws(() => s.endpoint.catalogFor(0, { ...s.query(), actor: 0 }));
  let reads = 0; const q = s.query(); Object.defineProperty(q.source, 'generation', { enumerable: true, get() { reads++; return 0; } });
  assert.throws(() => s.endpoint.catalogFor(0, q)); assert.equal(reads, 0);
});
test('a pending resolution marks the window unavailable but does not claim full legality', () => {
  const s = fixture(), v = s.owner.effectViewFor(0);
  s.owner.handleEffect(0, { kind: 'start', matchId: v.matchId, resolutionId: 'r', requestId: 'start', expectedMovementRevision: v.movement.revision, expectedProgressionRevision: v.progression.revision });
  assert.ok(s.endpoint.catalogFor(0, s.query()).effects.every(e => e.timingAvailable === false));
});
test('socket queries return only to the authenticated requester and clean up on disconnect', async t => {
  const s = fixture(), http = createServer(), io = new Server(http), clients = [], members = new Map();
  io.on('connection', socket => bindEffectSocket(io, socket, id => members.get(id) ?? null));
  t.after(async () => { clients.forEach(c => c.disconnect()); await new Promise(resolve => io.close(resolve)); });
  await new Promise((resolve, reject) => { http.once('error', reject); http.listen(0, '127.0.0.1', resolve); });
  const once = (socket, name) => new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error(name)), 3000); socket.once(name, x => { clearTimeout(timer); resolve(x); }); });
  const request = (socket, payload) => new Promise((resolve, reject) => socket.timeout(3000).emit('test-effect:catalog', payload, (err, result) => err ? reject(err) : resolve(result)));
  for (let i = 0; i < 3; i++) { const c = client(`http://127.0.0.1:${http.address().port}`, { autoConnect: false, reconnection: false }); clients.push(c); const connected = once(c, 'connect'); c.connect(); await connected; }
  const ids = clients.slice(0, 2).map(c => c.id); for (const actor of [0, 1]) members.set(ids[actor], { host: s.endpoint, actor, socketIds: ids });
  let broadcasts = 0; clients.forEach(c => c.on('test-effect:state', () => broadcasts++));
  const result = await request(clients[0], s.query()); assert.equal(result.ok, true); assert.equal(result.catalog.effects.length, 3);
  assert.deepEqual(await request(clients[1], s.query()), { ok: false, code: 'query_rejected' });
  assert.deepEqual(await request(clients[2], s.query()), { ok: false, code: 'not_available' });
  assert.equal(broadcasts, 0); const serverSocket = io.sockets.sockets.get(ids[0]), disconnected = once(serverSocket, 'disconnect'); clients[0].disconnect(); await disconnected;
  assert.equal(serverSocket.listeners('test-effect:catalog').length, 0);
});
