const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { Server } = require('socket.io');
const { io: connectClient } = require('socket.io-client');
const { bindEffectSocket, EFFECT_SOCKET_LIMITS } = require('../dist/test/effects/effectSocket.js');
const { EffectCommandHost } = require('../dist/test/effects/effectCommandHost.js');
const { TimedMovementEffect } = require('../dist/test/effects/timedMovement.js');
const { createMovementState, emptyZones } = require('../dist/test/movement/state.js');
const { createProgression } = require('../dist/test/progression/state.js');
const { applySystemEvent } = require('../dist/test/progression/transitions.js');
const rules = { status: 'certifiedNone' }, pay = { kind: 'payDon', amount: 1 };
const discard = { kind: 'moveCards', selector: { kind: 'cards', chooser: 'SELF', owner: 'SELF', zones: ['hand'], min: 1, max: 1, mode: 'SELECT' }, destination: { owner: 'SELF', zone: 'trash', position: 'append', visibility: 'faceUp' } };
const choice = { kind: 'select', saveAs: 'decision', selector: { kind: 'choice', chooser: 'OPPONENT', options: [{ id: 'yes', label: 'Yes' }] } };
const draw = { kind: 'draw', player: 'SELF', amount: 1 };
function host(actor = 0, costs = [pay, discard], actions = [choice, draw], guard = rules, matchId = 'm') {
  let p = createProgression(actor);
  while (true) { p = applySystemEvent(p, p.revision, { kind: 'settlePhase', phaseToken: p.phaseToken }); if (p.phase === 'main') break; p = applySystemEvent(p, p.revision, { kind: 'advancePhase', phaseToken: p.phaseToken }); }
  const players = [emptyZones(), emptyZones()], cards = {};
  for (const seat of [0, 1]) for (const [suffix, kind, zone] of [['l', 'leader', 'leader'], ['h', 'character', 'hand'], ['deck', 'character', 'deck'], ['don', 'don', 'activeDon']]) {
    const id = `${seat}-${suffix}`;
    cards[id] = { instanceId: id, generation: 0, cardId: kind === 'leader' ? 'TEST' : `${matchId}-PRIVATE-${id}`, kind, owner: seat, controller: seat,
      faceUp: zone !== 'deck', rotated: false, attachedTo: null, modifierIds: [], grantIds: [], enteredTurn: null };
    if (zone === 'leader') players[seat].leader[0] = id; else players[seat][zone].push(id);
  }
  return new EffectCommandHost(new TimedMovementEffect(createMovementState({ matchId, turnNumber: 1, players, cards }), p,
    { resolutionId: 'r', actor, source: { instanceId: `${actor}-l`, generation: 0 } },
    { dslVersion: 1, effectId: 'e', cardId: 'TEST', trigger: { kind: 'activate', window: 'main' }, costs, actions }), guard);
}
function once(socket, event) {
  return new Promise((resolve, reject) => {
    const handler = value => { clearTimeout(timer); resolve(value); };
    const timer = setTimeout(() => { socket.off(event, handler); reject(new Error(`Missing ${event}`)); }, 3000);
    socket.once(event, handler);
  });
}
const request = (socket, event, ...args) => new Promise((resolve, reject) => socket.timeout(3000).emit(event, ...args, (error, result) => error ? reject(error) : resolve(result)));
const sync = socket => request(socket, 'test-effect:sync');
function command(view, kind, requestId, patch = {}) {
  const data = { kind, requestId, matchId: view.matchId, resolutionId: view.effect.resolutionId,
    expectedMovementRevision: view.movement.revision, expectedProgressionRevision: view.progression.revision };
  if (kind === 'answerCosts' || kind === 'answerEffect') {
    data.selectionId = view.selection.selectionId;
    data.tokens = [view.selection.kind === 'cards' ? view.selection.candidates[0].token : view.selection.options[0].token];
  }
  return { ...data, ...patch };
}
async function setup(t, configuredHost = host()) {
  const http = createServer(), io = new Server(http, { transports: ['websocket'], maxHttpBufferSize: 32768 });
  const members = new Map(), disposers = new Map(), clients = [], events = new Map();
  const service = { http, io, members, disposers, clients, events, host: configuredHost, now: 0, resolverFails: false };
  const resolver = id => { if (service.resolverFails) throw Error('SECRET-membership-error'); return members.get(id) ?? null; };
  service.resolver = resolver;
  io.on('connection', socket => {
    disposers.set(socket.id, bindEffectSocket(io, socket, resolver, { now: () => service.now }));
    socket.on('disconnect', () => members.delete(socket.id));
  });
  t.after(async () => { clients.forEach(c => c.disconnect()); await new Promise(resolve => io.close(resolve)); });
  await new Promise((resolve, reject) => { http.once('error', reject); http.listen(0, '127.0.0.1', resolve); });
  const url = `http://127.0.0.1:${http.address().port}`;
  service.connect = async () => {
    const c = connectClient(url, { transports: ['websocket'], autoConnect: false, reconnection: false }); clients.push(c); events.set(c, []);
    c.on('test-effect:state', value => events.get(c).push(value)); const connected = once(c, 'connect'); c.connect(); await connected; return c;
  };
  service.pair = (a, b, effectHost = configuredHost) => {
    const socketIds = [a.id, b.id]; members.set(a.id, { host: effectHost, actor: 0, socketIds }); members.set(b.id, { host: effectHost, actor: 1, socketIds });
  };
  service.a = await service.connect(); service.b = await service.connect(); service.outsider = await service.connect(); service.pair(service.a, service.b);
  return service;
}
async function broadcast(s, sender, input) {
  const updates = [once(s.a, 'test-effect:state'), once(s.b, 'test-effect:state')];
  const ack = await request(sender, 'test-effect:command', input), views = await Promise.all(updates);
  return { ack, views };
}

test('socket: two authenticated seats receive distinct private views throughout cost/payment/choice/draw', async t => {
  for (const actor of [0, 1]) {
    const s = await setup(t, host(actor)), owner = actor === 0 ? s.a : s.b, other = actor === 0 ? s.b : s.a;
    const initial = await sync(owner); assert.equal(initial.ok, true);
    let { ack, views } = await broadcast(s, owner, command(initial.view, 'beginCosts', 'begin'));
    assert.equal(views[actor].selection.candidates[0].cardId, `m-PRIVATE-${actor}-h`); assert.equal(views[1 - actor].selection, null);
    assert.equal(views[1 - actor].movement.players[actor].hand[0].ref, null);
    ({ ack } = await broadcast(s, owner, command(ack.view, 'answerCosts', 'cost-answer'))); assert.equal(ack.ok, true);
    ({ ack } = await broadcast(s, owner, command(ack.view, 'commitCosts', 'commit'))); assert.equal(ack.ok, true);
    ({ ack, views } = await broadcast(s, owner, command(ack.view, 'advance', 'choose-effect')));
    assert.equal(views[actor].selection, null); assert.equal(views[1 - actor].selection.kind, 'choice');
    const otherView = (await sync(other)).view;
    await broadcast(s, other, command(otherView, 'answerEffect', 'effect-answer'));
    const current = (await sync(owner)).view;
    ({ ack, views } = await broadcast(s, owner, command(current, 'advance', 'draw')));
    assert.equal(ack.view.effect.status, 'completed'); assert.equal(views[actor].movement.players[actor].hand[0].cardId, `m-PRIVATE-${actor}-deck`);
    assert.equal(views[1 - actor].movement.players[actor].hand[0].cardId, null);
    assert.equal(s.events.get(s.outsider).length, 0);
  }
});
test('socket: outsiders and a different match cannot select a host by payload or receive room broadcasts', async t => {
  const s = await setup(t, host(0, [pay], []));
  s.io.sockets.sockets.get(s.outsider.id).join(s.a.id);
  assert.deepEqual(await sync(s.outsider), { ok: false, code: 'not_available' });
  const view = (await sync(s.a)).view, input = command(view, 'start', 'start');
  assert.deepEqual(await request(s.outsider, 'test-effect:command', input), { ok: false, code: 'not_available' });
  const extra = await s.connect(), otherHost = host(0, [pay], [], rules, 'other'); s.pair(s.outsider, extra, otherHost);
  const wrong = await request(s.outsider, 'test-effect:command', input); assert.equal(wrong.code, 'wrong_context'); assert.equal(wrong.view.matchId, 'other');
  await broadcast(s, s.a, input); await sync(s.outsider);
  assert.equal(s.events.get(s.outsider).length, 0); assert.equal(s.events.get(extra).length, 0);
});
test('socket: command replay is acknowledged without duplicate payment or duplicate broadcasts', async t => {
  const s = await setup(t, host(0, [pay], [])), input = command((await sync(s.a)).view, 'start', 'start');
  const first = await broadcast(s, s.a, input); assert.equal(first.ack.ok, true);
  const counts = [s.events.get(s.a).length, s.events.get(s.b).length];
  const duplicate = await request(s.a, 'test-effect:command', input); await sync(s.b);
  assert.equal(duplicate.replayed, true); assert.equal(duplicate.view.movement.players[0].restDon.length, 1);
  assert.deepEqual([s.events.get(s.a).length, s.events.get(s.b).length], counts);
});
test('socket: missing acknowledgements are ignored and actor spoofing is rejected', async t => {
  const s = await setup(t, host(0, [pay], [])), input = command((await sync(s.a)).view, 'start', 'start');
  s.a.emit('test-effect:command', input);
  assert.equal((await sync(s.a)).view.movement.revision, 0);
  const spoof = await request(s.b, 'test-effect:command', { ...input, actor: 0 }); assert.equal(spoof.code, 'invalid_command');
  const unauthorized = await request(s.b, 'test-effect:command', input); assert.equal(unauthorized.code, 'operation_rejected');
  await sync(s.a); assert.equal(s.events.get(s.a).length, 0); assert.equal(s.events.get(s.b).length, 0);
});
test('socket: disconnect blocks operations; trusted reassignment can sync an existing pending choice', async t => {
  const s = await setup(t), initial = (await sync(s.a)).view;
  const pending = (await broadcast(s, s.a, command(initial, 'beginCosts', 'begin'))).ack.view.selection;
  const oldId = s.a.id, serverSocket = s.io.sockets.sockets.get(oldId), disconnected = once(serverSocket, 'disconnect'); s.a.disconnect(); await disconnected;
  assert.deepEqual(await sync(s.b), { ok: false, code: 'not_available' });
  assert.equal(serverSocket.listeners('test-effect:command').length, 0);
  const replacement = await s.connect(); s.pair(replacement, s.b);
  const fresh = await sync(replacement); assert.equal(fresh.ok, true); assert.equal(fresh.view.selection.selectionId, pending.selectionId);
  assert.deepEqual(fresh.view.selection.candidates, pending.candidates); assert.equal(fresh.view.movement.revision, 0);
  assert.equal((await sync(s.b)).view.selection, null);
});
test('socket: bounded per-socket requests cannot mutate state when rate limited and reset by server time', async t => {
  const s = await setup(t, host(0, [pay], [])); let view;
  for (let i = 0; i < EFFECT_SOCKET_LIMITS.requests; i++) { const result = await sync(s.a); assert.equal(result.ok, true); view = result.view; }
  const input = command(view, 'start', 'start');
  assert.deepEqual(await request(s.a, 'test-effect:command', input), { ok: false, code: 'rate_limited' });
  assert.equal((await sync(s.b)).view.movement.revision, 0);
  s.now += EFFECT_SOCKET_LIMITS.windowMs;
  assert.equal((await broadcast(s, s.a, input)).ack.ok, true);
});
test('socket: membership revoked during trusted rule evaluation prevents stale views or broadcasts', async t => {
  let revoke = () => {}; const guard = { status: 'evaluate', check() { revoke(); return { kind: 'allow' }; } };
  const s = await setup(t, host(0, [pay], [], guard)); revoke = () => s.members.delete(s.b.id);
  const input = command((await sync(s.a)).view, 'start', 'start');
  assert.deepEqual(await request(s.a, 'test-effect:command', input), { ok: false, code: 'not_available' });
  assert.equal(s.events.get(s.a).length, 0); assert.equal(s.events.get(s.b).length, 0);
  s.pair(s.a, s.b); const retry = await request(s.a, 'test-effect:command', input);
  assert.equal(retry.replayed, true); assert.equal(retry.view.movement.players[0].restDon.length, 1);
});
test('socket: resolver errors do not expose diagnostic text or private state', async t => {
  const s = await setup(t); s.resolverFails = true;
  const denied = await sync(s.a); assert.deepEqual(denied, { ok: false, code: 'not_available' });
  assert.equal(JSON.stringify(denied).includes('SECRET'), false);
});
test('socket: duplicate binding is refused; disposal is idempotent and permits explicit rebind', async t => {
  const s = await setup(t), serverSocket = s.io.sockets.sockets.get(s.a.id);
  assert.throws(() => bindEffectSocket(s.io, serverSocket, s.resolver), /duplicate/);
  const dispose = s.disposers.get(s.a.id); dispose(); dispose(); assert.equal(serverSocket.listeners('test-effect:command').length, 0);
  const rebound = bindEffectSocket(s.io, serverSocket, s.resolver, { now: () => s.now });
  assert.equal(serverSocket.listeners('test-effect:command').length, 1); assert.equal((await sync(s.a)).ok, true); rebound();
});
test('socket: failed effect after payment publishes a blocked paid state to both players', async t => {
  const s = await setup(t, host(0, [pay], [{ ...draw, amount: 2 }]));
  const first = await broadcast(s, s.a, command((await sync(s.a)).view, 'start', 'start'));
  const failed = await broadcast(s, s.a, command(first.ack.view, 'advance', 'fail'));
  assert.equal(failed.ack.code, 'operation_rejected');
  for (const view of failed.views) { assert.equal(view.effect.status, 'blocked'); assert.equal(view.progression.gate, 'resolving'); assert.equal(view.movement.players[0].restDon.length, 1); }
});
