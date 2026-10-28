const { test } = require('node:test');
const assert = require('node:assert/strict');
const { io } = require('socket.io-client');
const { createTestServer } = require('../dist/test/server.js');
const { EffectMatchOwner } = require('../dist/test/effects/effectMatchOwner.js');
const { createProgression } = require('../dist/test/progression/state.js');
const { applySystemEvent } = require('../dist/test/progression/transitions.js');
const recipe = { name: 'Test', leaderCardId: 'LEADER', mainDeck: Array(50).fill('CHAR'), donDeck: Array(10).fill('DON'), cardTypes: { CHAR: 'character' }, leaderLifeCount: 5 };
const request = (socket, name, ...args) => new Promise((resolve, reject) => socket.timeout(3000).emit(name, ...args, (error, result) => error ? reject(error) : resolve(result)));
const once = (socket, name) => new Promise((resolve, reject) => {
  const listener = value => { clearTimeout(timer); resolve(value); };
  const timer = setTimeout(() => { socket.off(name, listener); reject(Error(`Missing ${name}`)); }, 3000); socket.once(name, listener);
});
async function setup(t, actor = 0, shouldFail = () => false) {
  const owners = [], matches = [], clients = [];
  const service = createTestServer({ effectFactory(match) {
    if (shouldFail()) throw Error('SECRET-factory-error');
    let p = createProgression(actor);
    while (true) { p = applySystemEvent(p, p.revision, { kind: 'settlePhase', phaseToken: p.phaseToken }); if (p.phase === 'main') break; p = applySystemEvent(p, p.revision, { kind: 'advancePhase', phaseToken: p.phaseToken }); }
    const owner = new EffectMatchOwner(match); owner.adopt(p);
    owner.openEffect({ resolutionId: 'r', actor, source: { instanceId: match.players[actor].zones.leader[0].id, generation: 0 } },
      { dslVersion: 1, effectId: 'fixture-draw', cardId: 'LEADER', trigger: { kind: 'activate', window: 'main' }, costs: [], actions: [{ kind: 'draw', player: 'SELF', amount: 1 }] }, { status: 'certifiedNone' });
    owners.push(owner); matches.push(match); return owner;
  } });
  t.after(async () => { clients.forEach(c => c.disconnect()); await new Promise(resolve => service.io.close(resolve)); });
  await new Promise((resolve, reject) => { service.http.once('error', reject); service.http.listen(0, '127.0.0.1', resolve); });
  for (let i = 0; i < 3; i++) { const c = io(`http://127.0.0.1:${service.http.address().port}`, { autoConnect: false, reconnection: false, transports: ['websocket'] }); clients.push(c); const ready = once(c, 'connect'); c.connect(); await ready; }
  const [host, guest, outsider] = clients, room = once(host, 'test-room:state');
  await request(host, 'test-room:create'); const code = (await room).roomId; await request(guest, 'test-room:join', code);
  for (const c of [host, guest]) assert.equal((await request(c, 'test-room:deck', recipe)).ok, true);
  for (const c of [host, guest]) assert.equal((await request(c, 'test-room:ready', true)).ok, true);
  async function start() {
    const updates = [once(host, 'test-effect:state'), once(guest, 'test-effect:state')];
    assert.equal((await request(host, 'test-match:start')).ok, true); return Promise.all(updates);
  }
  return { service, host, guest, outsider, owners, matches, code, start, actor };
}
function command(view, kind, id) { return { kind, requestId: id, matchId: view.matchId, resolutionId: view.effect.resolutionId,
  expectedMovementRevision: view.movement.revision, expectedProgressionRevision: view.progression.revision }; }
test('effect room: real create/join/READY/start binds both seats and blocks legacy writes', async t => {
  for (const actor of [0, 1]) {
    const s = await setup(t, actor), initial = await s.start(), owner = actor === 0 ? s.host : s.guest;
    assert.equal(initial[actor].movement.players[actor].hand[0].cardId, 'CHAR'); assert.equal(initial[1 - actor].movement.players[actor].hand[0].cardId, null);
    const legacy = await request(owner, 'test-match:command', { kind: 'draw', matchId: initial[actor].matchId, expectedRevision: 0, requestId: 'manual' });
    assert.equal(legacy.ok, false); assert.equal(s.matches[0].revision, 0);
    assert.deepEqual(await request(s.outsider, 'test-effect:sync'), { ok: false, code: 'not_available' });
    const starting = [once(s.host, 'test-effect:state'), once(s.guest, 'test-effect:state')];
    const started = await request(owner, 'test-effect:command', command(initial[actor], 'start', 'start')); assert.equal(started.ok, true); await Promise.all(starting);
    const next = [once(s.host, 'test-effect:state'), once(s.guest, 'test-effect:state')];
    assert.equal((await request(owner, 'test-effect:command', command(started.view, 'advance', 'draw'))).ok, true);
    const views = await Promise.all(next); assert.equal(views[actor].movement.players[actor].hand.length, 6);
    assert.equal(views[1 - actor].movement.players[actor].hand[5].cardId, null); assert.equal(s.matches[0].players[actor].zones.hand.length, 5);
  }
});
test('effect room: ending closes the owner and restarting retains room code but rejects old match requests', async t => {
  const s = await setup(t), first = await s.start(), old = command(first[0], 'start', 'old');
  await request(s.host, 'test-match:end'); assert.equal(s.owners[0].snapshot().mode, 'closed');
  assert.deepEqual(await request(s.guest, 'test-effect:sync'), { ok: false, code: 'not_available' });
  const room = once(s.host, 'test-room:state'); await request(s.host, 'test-room:ready', true); assert.equal((await room).roomId, s.code);
  await request(s.guest, 'test-room:ready', true); const second = await s.start(); assert.notEqual(second[0].matchId, first[0].matchId);
  assert.equal((await request(s.host, 'test-effect:command', old)).code, 'wrong_context'); assert.equal(s.owners.length, 2);
});
test('effect room: guest leave or disconnect closes effects but preserves the host room', async t => {
  for (const disconnect of [false, true]) {
    const s = await setup(t); await s.start(); const ended = once(s.host, 'test-match:ended');
    if (disconnect) s.guest.disconnect(); else await request(s.guest, 'test-room:leave');
    await ended; assert.equal(s.owners[0].snapshot().mode, 'closed');
    assert.deepEqual(await request(s.host, 'test-effect:sync'), { ok: false, code: 'not_available' });
    const room = once(s.host, 'test-room:state'); await request(s.host, 'test-room:create'); const current = await room;
    assert.equal(current.roomId, s.code); assert.equal(current.guest, null); assert.equal(current.inMatch, false);
  }
});
test('effect room: host dissolution closes effects and removes access for all former members', async t => {
  const s = await setup(t); await s.start(); const closed = once(s.guest, 'test-room:closed');
  await request(s.host, 'test-room:leave'); await closed; assert.equal(s.owners[0].snapshot().mode, 'closed');
  assert.deepEqual(await request(s.guest, 'test-effect:sync'), { ok: false, code: 'not_available' });
  assert.equal((await request(s.outsider, 'test-room:join', s.code)).ok, false);
});
test('effect room: failed initialization does not create a partial match or leak diagnostics', async t => {
  let fail = true; const s = await setup(t, 0, () => fail);
  const rejected = await request(s.host, 'test-match:start'); assert.equal(rejected.ok, false); assert.equal(JSON.stringify(rejected).includes('SECRET'), false);
  assert.deepEqual(await request(s.host, 'test-effect:sync'), { ok: false, code: 'not_available' });
  assert.equal(s.owners.length, 0); fail = false; const views = await s.start(); assert.equal(views[0].effect.status, 'prepared');
});
