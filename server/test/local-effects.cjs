const { test } = require('node:test');
const assert = require('node:assert/strict');
const { io } = require('socket.io-client');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { startLocalEffectServer } = require('../dist/test/localEffects.js');
const recipe = { name: 'Local', leaderCardId: 'LOCAL-LEADER', mainDeck: Array(50).fill('LOCAL-CARD'), donDeck: Array(10).fill('LOCAL-DON'), cardTypes: { 'LOCAL-CARD': 'character' }, leaderLifeCount: 5 };
const request = (s, event, ...args) => new Promise((resolve, reject) => s.timeout(3000).emit(event, ...args, (error, result) => error ? reject(error) : resolve(result)));
const once = (s, event) => new Promise((resolve, reject) => { const callback = value => { clearTimeout(timer); resolve(value); }; const timer = setTimeout(() => { s.off(event, callback); reject(Error(event)); }, 3000); s.once(event, callback); });
async function playFixture(t, expectUnknownMaster = false, deck = recipe, cancelFirst = false) {
  const service = await startLocalEffectServer(0), clients = [];
  t.after(async () => { clients.forEach(s => s.disconnect()); await new Promise(resolve => service.io.close(resolve)); });
  assert.equal(service.http.address().address, '127.0.0.1');
  for (let i = 0; i < 2; i++) { const s = io(service.url, { autoConnect: false, reconnection: false }); clients.push(s); const connected = once(s, 'connect'); s.connect(); await connected; }
  const [host, guest] = clients, roomEvent = once(host, 'test-room:state'); await request(host, 'test-room:create'); const room = await roomEvent;
  await request(guest, 'test-room:join', room.roomId); for (const s of clients) await request(s, 'test-room:deck', deck); for (const s of clients) await request(s, 'test-room:ready', true);
  const initial = once(host, 'test-effect:state'); assert.equal((await request(host, 'test-match:start')).ok, true); let view = await initial;
  if (expectUnknownMaster) assert.equal(view.effect.masterVersion, null);
  assert.equal(view.effect.status, 'idle'); assert.equal(view.selection, null);
  const idleId = view.effect.resolutionId;
  const denied = await request(host, 'test-effect:command', { kind: 'start', matchId: view.matchId, resolutionId: idleId, requestId: 'idle-start', expectedMovementRevision: view.movement.revision, expectedProgressionRevision: view.progression.revision });
  assert.equal(denied.ok, false); assert.equal(denied.view.effect.status, 'idle');
  const before = view.movement.players[0].deck.length;
  async function activate(requestId) {
    const catalog = await request(host, 'test-effect:catalog', { matchId: view.matchId, expectedMovementRevision: view.movement.revision, expectedProgressionRevision: view.progression.revision, source: view.movement.players[0].leader[0].ref });
    assert.equal(catalog.ok, true); assert.equal(catalog.catalog.activationEnabled, true);
    const c = { kind: 'activateRegistered', matchId: view.matchId, resolutionId: view.effect.resolutionId, requestId, expectedMovementRevision: view.movement.revision, expectedProgressionRevision: view.progression.revision, source: catalog.catalog.source, catalogVersion: catalog.catalog.catalogVersion, effectId: catalog.catalog.effects[0].effectId };
    const updated = once(guest, 'test-effect:state'), result = await request(host, 'test-effect:command', c);
    assert.equal(result.ok, true); view = result.view; assert.equal(view.effect.status, 'waitingForCostSelection');
    assert.equal((await updated).effect.resolutionId, view.effect.resolutionId);
    assert.equal((await request(host, 'test-effect:command', c)).replayed, true);
    return c;
  }
  if (cancelFirst) {
    await activate('cancel-activation');
    const cancelled = await request(host, 'test-effect:command', { kind: 'cancelCosts', matchId: view.matchId, resolutionId: view.effect.resolutionId, requestId: 'cancel', expectedMovementRevision: view.movement.revision, expectedProgressionRevision: view.progression.revision });
    assert.equal(cancelled.ok, true); view = cancelled.view; assert.equal(view.effect.status, 'idle'); assert.notEqual(view.effect.resolutionId, idleId);
    assert.equal(view.movement.players[0].hand.length, 5); assert.equal(view.movement.players[0].trash.length, 0);
  }
  const lastActivation = await activate('activation');
  for (const [index, kind] of ['answerCosts', 'commitCosts', 'advance'].entries()) {
    const c = { kind, matchId: view.matchId, resolutionId: view.effect.resolutionId, requestId: `request-${index}`, expectedMovementRevision: view.movement.revision, expectedProgressionRevision: view.progression.revision };
    if (kind === 'answerCosts') { c.selectionId = view.selection.selectionId; c.tokens = [view.selection.candidates[0].token]; }
    const result = await request(host, 'test-effect:command', c); assert.equal(result.ok, true); view = result.view;
  }
  assert.equal(view.effect.status, 'idle'); assert.notEqual(view.effect.resolutionId, idleId); assert.equal(view.movement.players[0].hand.length, 5); assert.equal(view.movement.players[0].trash.length, 1); assert.equal(view.movement.players[0].deck.length, before - 1);
  const other = await request(guest, 'test-effect:sync'); assert.equal(other.view.movement.players[0].hand.every(c => c.cardId === null), true); assert.equal(other.view.effect.resolutionId, view.effect.resolutionId);
  const old = view; assert.equal((await request(host, 'test-match:end')).ok, true);
  assert.equal((await request(guest, 'test-effect:sync')).ok, false);
  for (const s of clients) assert.equal((await request(s, 'test-room:ready', true)).ok, true);
  const restarted = once(host, 'test-effect:state'); assert.equal((await request(host, 'test-match:start')).ok, true); view = await restarted;
  assert.equal(view.effect.status, 'idle'); assert.notEqual(view.matchId, old.matchId); assert.notEqual(view.effect.resolutionId, old.effect.resolutionId);
  assert.equal(view.movement.players[0].trash.length, 0);
  const late = await request(host, 'test-effect:command', lastActivation); assert.equal(late.ok, false); assert.equal(late.view.effect.resolutionId, view.effect.resolutionId);
}

test('local fixture binds loopback and completes the public UI command sequence', t => playFixture(t));
test('local fixture returns to synchronized idle after unpaid cancellation', t => playFixture(t, false, recipe, true));

test('local fixture can run independently of inconsistent real card master types', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'local-effect-master-')), file = join(directory, 'card-master.json');
  writeFileSync(file, JSON.stringify({ schemaVersion: 2, cards: { 'LOCAL-CARD': { type: 'event' }, 'OP16-080': { type: 'leader' } } }));
  const old = process.env.TEST_CARD_MASTER_PATH; process.env.TEST_CARD_MASTER_PATH = file;
  try { await playFixture(t, true, { ...recipe, leaderCardId: 'OP16-080' }); }
  finally {
    if (old === undefined) delete process.env.TEST_CARD_MASTER_PATH; else process.env.TEST_CARD_MASTER_PATH = old;
    rmSync(directory, { recursive: true, force: true });
  }
});
test('local fixture refuses production and invalid listen ports', async () => {
  const old = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
  try { await assert.rejects(startLocalEffectServer(0), /disabled in production/); }
  finally { if (old === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = old; }
  await assert.rejects(startLocalEffectServer(-1), /Invalid local/); await assert.rejects(startLocalEffectServer(65536), /Invalid local/);
});
