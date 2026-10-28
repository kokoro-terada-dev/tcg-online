const { test } = require('node:test');
const assert = require('node:assert/strict');
const { io } = require('socket.io-client');
const { startLocalEffectServer } = require('../dist/test/localEffects.js');
const recipe = { name: 'Local', leaderCardId: 'LOCAL-LEADER', mainDeck: Array(50).fill('LOCAL-CARD'), donDeck: Array(10).fill('LOCAL-DON'), cardTypes: { 'LOCAL-CARD': 'character' }, leaderLifeCount: 5 };
const request = (s, event, ...args) => new Promise((resolve, reject) => s.timeout(3000).emit(event, ...args, (error, result) => error ? reject(error) : resolve(result)));
const once = (s, event) => new Promise((resolve, reject) => { const callback = value => { clearTimeout(timer); resolve(value); }; const timer = setTimeout(() => { s.off(event, callback); reject(Error(event)); }, 3000); s.once(event, callback); });
test('local fixture binds loopback and completes the public UI command sequence', async t => {
  const service = await startLocalEffectServer(0), clients = [];
  t.after(async () => { clients.forEach(s => s.disconnect()); await new Promise(resolve => service.io.close(resolve)); });
  assert.equal(service.http.address().address, '127.0.0.1');
  for (let i = 0; i < 2; i++) { const s = io(service.url, { autoConnect: false, reconnection: false }); clients.push(s); const connected = once(s, 'connect'); s.connect(); await connected; }
  const [host, guest] = clients, roomEvent = once(host, 'test-room:state'); await request(host, 'test-room:create'); const room = await roomEvent;
  await request(guest, 'test-room:join', room.roomId); for (const s of clients) await request(s, 'test-room:deck', recipe); for (const s of clients) await request(s, 'test-room:ready', true);
  const initial = once(host, 'test-effect:state'); assert.equal((await request(host, 'test-match:start')).ok, true); let view = await initial;
  const before = view.movement.players[0].deck.length;
  for (const [index, kind] of ['beginCosts', 'answerCosts', 'commitCosts', 'advance'].entries()) {
    const c = { kind, matchId: view.matchId, resolutionId: view.effect.resolutionId, requestId: `request-${index}`, expectedMovementRevision: view.movement.revision, expectedProgressionRevision: view.progression.revision };
    if (kind === 'answerCosts') { c.selectionId = view.selection.selectionId; c.tokens = [view.selection.candidates[0].token]; }
    const result = await request(host, 'test-effect:command', c); assert.equal(result.ok, true); view = result.view;
  }
  assert.equal(view.effect.status, 'completed'); assert.equal(view.movement.players[0].hand.length, 5); assert.equal(view.movement.players[0].trash.length, 1); assert.equal(view.movement.players[0].deck.length, before - 1);
  const other = await request(guest, 'test-effect:sync'); assert.equal(other.view.movement.players[0].hand.every(c => c.cardId === null), true);
});
test('local fixture refuses production and invalid listen ports', async () => {
  const old = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
  try { await assert.rejects(startLocalEffectServer(0), /disabled in production/); }
  finally { if (old === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = old; }
  await assert.rejects(startLocalEffectServer(-1), /Invalid local/); await assert.rejects(startLocalEffectServer(65536), /Invalid local/);
});
