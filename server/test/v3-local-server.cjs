const { test } = require('node:test');
const assert = require('node:assert/strict');
const { io } = require('socket.io-client');
const { startLocalV3Server } = require('../dist/test/effects/v3/localServer.js');
const deck = { name: 'Synthetic UI fixture', leaderCardId: 'LEADER', mainDeck: Array(50).fill('CARD'), donDeck: Array(10).fill('DON'), cardTypes: { CARD: 'character' }, leaderLifeCount: 5 };
const request = (socket, event, input = null) => new Promise((resolve, reject) => socket.timeout(3000).emit(event, input, (error, reply) => error ? reject(error) : resolve(reply)));
const once = (socket, event) => new Promise((resolve, reject) => { const callback = value => { clearTimeout(timer); resolve(value); }; const timer = setTimeout(() => { socket.off(event, callback); reject(Error(event)); }, 3000); socket.once(event, callback); });
const command = (v, kind, requestId, extra = {}) => ({ kind, requestId, matchId: v.matchId, resolutionId: v.frame.resolutionId, frameRevision: v.frame.revision, movementRevision: v.movement.revision, progressionRevision: v.progression.revision, ...extra });
async function setup(t) {
  const service = await startLocalV3Server(), clients = [];
  t.after(async () => { clients.forEach(socket => socket.disconnect()); await new Promise(resolve => service.io.close(resolve)); });
  assert.equal(service.http.address().address, '127.0.0.1');
  for (let i = 0; i < 3; i++) { const socket = io(service.url, { autoConnect: false, reconnection: false }); clients.push(socket); const ready = once(socket, 'connect'); socket.connect(); await ready; }
  const [host, guest] = clients, created = once(host, 'v3-room:state'); assert.equal((await request(host, 'v3-room:create')).ok, true); const room = await created;
  assert.equal((await request(guest, 'v3-room:join', room.roomId)).ok, true);
  for (const socket of [host, guest]) { assert.equal((await request(socket, 'v3-room:deck', deck)).ok, true); assert.equal((await request(socket, 'v3-room:ready', true)).ok, true); }
  return { service, clients, host, guest, code: room.roomId };
}
test('v3 local sockets isolate seats, keep hands private, and execute both synthetic cases for host and guest', async t => {
  const { clients, host, guest } = await setup(t), outsider = clients[2];
  assert.equal((await request(outsider, 'v3:sync')).ok, false);
  for (const actor of [0, 1]) {
    for (const scenario of ['bounce', 'payDraw']) {
      if (actor !== 0 || scenario !== 'bounce') for (const socket of [host, guest]) assert.equal((await request(socket, 'v3-room:ready', true)).ok, true);
      assert.equal((await request(guest, 'v3:start', { actor, scenario })).ok, false);
      assert.equal((await request(host, 'v3:start', { actor, scenario })).ok, true);
      const controller = clients[actor], other = clients[1 - actor];
      let v = (await request(controller, 'v3:sync')).view;
      assert.equal(v.localPlayerIndex, actor); assert.equal(v.actor, actor); assert.equal(v.imageAliases[`V3-FIXTURE-LEADER-${actor}`], 'LEADER');
      assert.equal(v.movement.players[actor].character.filter(Boolean).length, 2); assert.equal(v.movement.players[actor].activeDon.length, 2);
      assert.equal((await request(other, 'v3:command', command(v, 'advance', 'foreign'))).ok, false);
      const start = command(v, 'advance', `advance-${actor}-${scenario}`); const result = await request(controller, 'v3:command', start); assert.equal(result.ok, true); v = result.view;
      assert.equal((await request(controller, 'v3:command', start)).ok, true);
      assert.equal((await request(controller, 'v3:command', { ...start, actor: 1 - actor })).ok, false);
      if (scenario === 'bounce') {
        assert.equal(v.frame.status, 'waitingForChoice'); assert.equal(v.frame.choice.options.length, 2);
        const opposite = (await request(other, 'v3:sync')).view; assert.deepEqual(opposite.frame.choice.options, []);
        assert.equal(JSON.stringify(opposite).includes('definitionHash'), false);
        const answer = command(v, 'answer', `answer-${actor}`, { selectionId: v.frame.choice.selectionId, tokens: [v.frame.choice.options[0].token] });
        v = (await request(controller, 'v3:command', answer)).view;
        v = (await request(controller, 'v3:command', command(v, 'advance', `move-request-${actor}`))).view;
      } else {
        assert.equal(v.workType, 'PAY_COSTS'); v = (await request(controller, 'v3:command', command(v, 'work', `pay-${actor}`))).view;
        assert.equal(v.movement.players[actor].restDon.length, 1);
        v = (await request(controller, 'v3:command', command(v, 'advance', `draw-request-${actor}`))).view;
      }
      const work = command(v, 'work', `work-${actor}-${scenario}`); v = (await request(controller, 'v3:command', work)).view;
      assert.equal((await request(controller, 'v3:command', work)).view.movement.revision, v.movement.revision);
      v = (await request(controller, 'v3:command', command(v, 'advance', `finish-${actor}-${scenario}`))).view;
      assert.equal(v.frame.status, 'completed'); assert.equal(v.progression.gate, 'idle'); assert.equal(v.movement.players[actor].hand.length, 6);
      const peer = (await request(other, 'v3:sync')).view; assert.equal(peer.movement.revision, v.movement.revision); assert.equal(peer.movement.players[actor].hand.every(card => card.cardId === null && card.ref === null), true);
      assert.equal((await request(guest, 'v3:end')).ok, false); assert.equal((await request(host, 'v3:end')).ok, true);
      assert.equal((await request(controller, 'v3:command', work)).ok, false);
    }
  }
});
test('v3 room exit removes stale membership and guest loss invalidates the session', async t => {
  const { host, guest, code } = await setup(t);
  assert.equal((await request(host, 'v3:start', { actor: 0, scenario: 'bounce' })).ok, true);
  const updated = once(host, 'v3-room:state'); assert.equal((await request(guest, 'v3-room:leave')).ok, true); const room = await updated;
  assert.equal(room.matchId, null); assert.equal(room.guest, null); assert.equal((await request(host, 'v3:sync')).ok, false);
  assert.equal((await request(guest, 'v3-room:join', code)).ok, true);
  const closed = once(guest, 'v3-room:closed'); assert.equal((await request(host, 'v3-room:leave')).ok, true); await closed;
  assert.equal((await request(guest, 'v3-room:join', code)).ok, false);
});

for (const actor of [0, 1]) for (const scenario of ['ko', 'rest', 'active']) test(`v3 ${scenario} selection and resulting public board sync for controlling seat ${actor}`, async t => {
  const { host, clients } = await setup(t), controller = clients[actor], peer = clients[1 - actor];
  assert.equal((await request(host, 'v3:start', { actor, scenario })).ok, true);
  let v = (await request(controller, 'v3:sync')).view;
  v = (await request(controller, 'v3:command', command(v, 'advance', 'start'))).view;
  assert.equal(v.frame.choice.options.length, 2); assert.deepEqual((await request(peer, 'v3:sync')).view.frame.choice.options, []);
  v = (await request(controller, 'v3:command', command(v, 'answer', 'choose', { selectionId: v.frame.choice.selectionId, tokens: [v.frame.choice.options[0].token] }))).view;
  v = (await request(controller, 'v3:command', command(v, 'advance', 'work-request'))).view;
  assert.equal(v.workType, scenario === 'active' ? 'SET_ACTIVE' : scenario.toUpperCase());
  const c = command(v, 'work', 'apply'); v = (await request(controller, 'v3:command', c)).view;
  assert.equal((await request(controller, 'v3:command', c)).view.movement.revision, v.movement.revision);
  const targetOwner = scenario === 'active' ? actor : 1 - actor, zones = v.movement.players[targetOwner];
  if (scenario === 'ko') { assert.equal(zones.character.filter(Boolean).length, 1); assert.equal(zones.trash.length, 1); }
  else assert.equal(zones.character.filter(card => card?.rotated).length, 1);
  const opposite = (await request(peer, 'v3:sync')).view;
  assert.deepEqual(opposite.movement.players[targetOwner].character, zones.character); assert.deepEqual(opposite.movement.players[targetOwner].trash, zones.trash);
  v = (await request(controller, 'v3:command', command(v, 'advance', 'finish'))).view; assert.equal(v.frame.status, 'completed');
});

for (const actor of [0, 1]) test(`private hand selection and discard/draw cannot leak candidates to seat ${1 - actor}`, async t => {
  const { host, clients } = await setup(t), controller = clients[actor], peer = clients[1 - actor];
  assert.equal((await request(host, 'v3:start', { actor, scenario: 'discardDraw' })).ok, true);
  let v = (await request(controller, 'v3:sync')).view; v = (await request(controller, 'v3:command', command(v, 'advance', 'hand-start'))).view;
  assert.equal(v.frame.choice.min, 1); assert.equal(v.frame.choice.options.length, 5);
  const opposite = (await request(peer, 'v3:sync')).view; assert.deepEqual(opposite.frame.choice.options, []);
  for (const option of v.frame.choice.options) assert.equal(JSON.stringify(opposite).includes(option.token), false);
  for (const card of v.movement.players[actor].hand) assert.equal(JSON.stringify(opposite).includes(card.ref.instanceId), false);
  const answer = command(v, 'answer', 'choose', { selectionId: v.frame.choice.selectionId, tokens: [v.frame.choice.options[0].token] });
  assert.equal((await request(peer, 'v3:command', answer)).ok, false);
  v = (await request(controller, 'v3:command', answer)).view; v = (await request(controller, 'v3:command', command(v, 'advance', 'discard-request'))).view;
  const discard = command(v, 'work', 'discard'); v = (await request(controller, 'v3:command', discard)).view;
  assert.equal((await request(controller, 'v3:command', discard)).view.movement.revision, v.movement.revision);
  assert.equal(v.movement.players[actor].hand.length, 4); assert.equal(v.movement.players[actor].trash.length, 1);
  assert.equal((await request(peer, 'v3:sync')).view.movement.players[actor].trash[0].cardId, v.movement.players[actor].trash[0].cardId);
  v = (await request(controller, 'v3:command', command(v, 'advance', 'draw-request'))).view;
  v = (await request(controller, 'v3:command', command(v, 'work', 'draw'))).view;
  v = (await request(controller, 'v3:command', command(v, 'advance', 'finish'))).view;
  assert.equal(v.frame.status, 'completed'); assert.equal(v.movement.players[actor].hand.length, 5);
  assert.equal((await request(peer, 'v3:sync')).view.movement.players[actor].hand.every(card => card.cardId === null && card.ref === null), true);
});

for (const actor of [0, 1]) for (const scenario of ['discardCostDraw', 'sourceCostDraw', 'returnCostDraw']) test(`private composite cost ${scenario} for seat ${actor} pays together without leaking its selection`, async t => {
  const { host, clients } = await setup(t), controller = clients[actor], peer = clients[1 - actor];
  assert.equal((await request(host, 'v3:start', { actor, scenario })).ok, true);
  let v = (await request(controller, 'v3:sync')).view; const revision = v.movement.revision;
  v = (await request(controller, 'v3:command', command(v, 'advance', 'cost-start'))).view;
  assert.equal(v.frame.choice.purpose, 'cost'); assert.equal(v.movement.revision, revision);
  const other = (await request(peer, 'v3:sync')).view; assert.deepEqual(other.frame.choice.options, []);
  for (const option of v.frame.choice.options) assert.equal(JSON.stringify(other).includes(option.token), false);
  const answer = command(v, 'answer', 'cost-choice', { selectionId: v.frame.choice.selectionId, tokens: [v.frame.choice.options[0].token] });
  assert.equal((await request(peer, 'v3:command', answer)).ok, false); v = (await request(controller, 'v3:command', answer)).view;
  assert.equal(v.movement.revision, revision); assert.equal(v.movement.players[actor].hand.length, 5); assert.equal(v.movement.players[actor].activeDon.length, 2);
  v = (await request(controller, 'v3:command', command(v, 'advance', 'cost-plan'))).view;
  if (scenario === 'returnCostDraw') {
    assert.equal(v.frame.choice.purpose, 'returnCost'); assert.equal(v.movement.revision, revision);
    const nextChoice = command(v, 'answer', 'don-choice', { selectionId: v.frame.choice.selectionId, tokens: [v.frame.choice.options[0].token] });
    assert.deepEqual((await request(peer, 'v3:sync')).view.frame.choice.options, []);
    assert.equal((await request(peer, 'v3:command', nextChoice)).ok, false);
    v = (await request(controller, 'v3:command', nextChoice)).view;
    assert.equal(v.movement.revision, revision); v = (await request(controller, 'v3:command', command(v, 'advance', 'return-plan'))).view;
  }
  assert.equal(v.workType, 'PAY_COSTS'); assert.equal(v.movement.revision, revision);
  const pay = command(v, 'work', 'cost-pay'); v = (await request(controller, 'v3:command', pay)).view;
  assert.equal((await request(controller, 'v3:command', pay)).view.movement.revision, revision + 1);
  assert.equal(v.movement.players[actor].hand.length, 4); assert.equal(v.movement.players[actor].restDon.length, 1); assert.equal(v.movement.players[actor].trash.length, 1);
  assert.equal(v.movement.players[actor].leader[0].rotated, scenario !== 'discardCostDraw');
  assert.equal(v.movement.players[actor].activeDon.length, scenario === 'returnCostDraw' ? 0 : 1);
  assert.equal(v.movement.players[actor].donDeck.length, scenario === 'returnCostDraw' ? 9 : 8);
  const paidPeer = (await request(peer, 'v3:sync')).view; assert.equal(paidPeer.movement.revision, revision + 1); assert.equal(paidPeer.movement.players[actor].hand.every(card => card.cardId === null && card.ref === null), true);
  assert.equal(paidPeer.movement.players[actor].leader[0].rotated, scenario !== 'discardCostDraw');
  assert.equal(paidPeer.movement.players[actor].donDeck.length, v.movement.players[actor].donDeck.length);
  v = (await request(controller, 'v3:command', command(v, 'advance', 'draw-plan'))).view;
  v = (await request(controller, 'v3:command', command(v, 'work', 'draw'))).view;
  v = (await request(controller, 'v3:command', command(v, 'advance', 'finish'))).view; assert.equal(v.frame.status, 'completed'); assert.equal(v.movement.players[actor].hand.length, 5);
});

for (const actor of [0, 1]) test(`mixed DON return for seat ${actor} rejects reserved active DON and permits a corrected choice on both clients`, async t => {
  const { host, clients } = await setup(t), controller = clients[actor], peer = clients[1 - actor];
  assert.equal((await request(host, 'v3:start', { actor, scenario: 'mixedReturnCostDraw' })).ok, true);
  let v = (await request(controller, 'v3:sync')).view; const revision = v.movement.revision;
  assert.equal(v.movement.players[actor].activeDon.length, 2); assert.equal(v.movement.players[actor].restDon.length, 1);
  assert.equal(v.movement.players[actor].attachedDon.length, 1); assert.equal(v.movement.players[actor].donDeck.length, 6);
  v = (await request(controller, 'v3:command', command(v, 'advance', 'hand-start'))).view;
  v = (await request(controller, 'v3:command', command(v, 'answer', 'hand', { selectionId: v.frame.choice.selectionId, tokens: [v.frame.choice.options[0].token] }))).view;
  v = (await request(controller, 'v3:command', command(v, 'advance', 'don-start'))).view;
  const choice = v.frame.choice, active = choice.options.filter(option => option.zone === 'activeDon');
  assert.equal(choice.options.length, 4); assert.equal(choice.maxActiveReturn, 1);
  assert.equal(choice.options.find(option => option.zone === 'attachedDon').label, 'キャラ1付与DON');
  const other = (await request(peer, 'v3:sync')).view; assert.deepEqual(other.frame.choice.options, []);
  for (const option of choice.options) assert.equal(JSON.stringify(other).includes(option.token), false);
  const denied = await request(controller, 'v3:command', command(v, 'answer', 'invalid-active', { selectionId: choice.selectionId, tokens: active.map(option => option.token) }));
  assert.equal(denied.ok, false); assert.equal(denied.view.frame.revision, v.frame.revision);
  assert.equal(denied.view.movement.revision, revision); assert.equal(denied.view.frame.choice.selectionId, choice.selectionId);
  const tokens = [active[0].token, choice.options.find(option => option.zone === 'attachedDon').token];
  const corrected = command(v, 'answer', 'corrected', { selectionId: choice.selectionId, tokens });
  assert.equal((await request(peer, 'v3:command', corrected)).ok, false); v = (await request(controller, 'v3:command', corrected)).view;
  v = (await request(controller, 'v3:command', command(v, 'advance', 'plan'))).view; assert.equal(v.movement.revision, revision);
  const pay = command(v, 'work', 'pay'); v = (await request(controller, 'v3:command', pay)).view;
  assert.equal((await request(controller, 'v3:command', pay)).view.movement.revision, revision + 1);
  const paidPeer = (await request(peer, 'v3:sync')).view;
  for (const result of [v, paidPeer]) {
    const zones = result.movement.players[actor]; assert.equal(zones.activeDon.length, 0); assert.equal(zones.restDon.length, 2);
    assert.equal(zones.attachedDon.length, 0); assert.equal(zones.donDeck.length, 8); assert.equal(zones.hand.length, 4);
  }
  v = (await request(controller, 'v3:command', command(v, 'advance', 'draw-plan'))).view;
  v = (await request(controller, 'v3:command', command(v, 'work', 'draw'))).view;
  v = (await request(controller, 'v3:command', command(v, 'advance', 'finish'))).view; assert.equal(v.frame.status, 'completed');
});

test('invalid decks do not replace a ready deck, remote browser Origins are denied, and production startup is disabled', async t => {
  const { service, host } = await setup(t);
  assert.equal((await request(host, 'v3-room:deck', { invalid: true })).ok, false);
  assert.equal((await request(host, 'v3:start', { actor: 0, scenario: 'payDraw' })).ok, true);
  const forbidden = io(service.url, { autoConnect: false, transports: ['websocket'], reconnection: false, extraHeaders: { Origin: 'https://outside.example' } });
  t.after(() => forbidden.disconnect());
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Origin rejection timeout')), 3000);
    forbidden.once('connect_error', () => { clearTimeout(timer); resolve(); });
    forbidden.once('connect', () => { clearTimeout(timer); reject(Error('Unexpected remote Origin connection')); }); forbidden.connect();
  });
  const previous = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
  try { await assert.rejects(startLocalV3Server(0)); } finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
});
