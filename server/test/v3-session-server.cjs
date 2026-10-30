const { test } = require('node:test');
const assert = require('node:assert/strict');
const { io } = require('socket.io-client');
const { startLocalV3Server } = require('../dist/test/effects/v3/localServer.js');
const deck = { name: 'Synthetic session', leaderCardId: 'LEADER', mainDeck: Array(50).fill('CARD'), donDeck: Array(10).fill('DON'), cardTypes: { CARD: 'character' }, leaderLifeCount: 5 };
const request = (socket, event, input = null) => new Promise((resolve, reject) => socket.timeout(3000).emit(event, input, (error, reply) => error ? reject(error) : resolve(reply)));
const once = (socket, event) => new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error(event)), 3000); socket.once(event, value => { clearTimeout(timer); resolve(value); }); });
let sequence = 0;
const command = (v, kind, extra = {}) => ({ matchId: v.matchId, requestId: `session-${++sequence}`, context: v.context, kind,
  ...(kind === 'activate' ? { sourceToken: v.effects.find(effect => effect.zone === 'leader' && effect.effectId === extra.effectId)?.sourceToken } : {}), ...extra });
async function send(socket, v, kind, extra = {}) {
  const result = await request(socket, 'v3-session:command', command(v, kind, extra)); assert.equal(result.ok, true, JSON.stringify(result)); return result.sessionView;
}
async function setup(t, firstPlayer = 0, decks = [deck, deck]) {
  const service = await startLocalV3Server(), clients = [];
  t.after(async () => { clients.forEach(socket => socket.disconnect()); await new Promise(resolve => service.io.close(resolve)); });
  for (let i = 0; i < 3; i++) { const socket = io(service.url, { autoConnect: false, reconnection: false }); clients.push(socket); const ready = once(socket, 'connect'); socket.connect(); await ready; }
  const [host, guest] = clients, created = once(host, 'v3-room:state'); await request(host, 'v3-room:create'); const room = await created;
  assert.equal((await request(guest, 'v3-room:join', room.roomId)).ok, true);
  for (const [i, socket] of [host, guest].entries()) { assert.equal((await request(socket, 'v3-room:deck', decks[i])).ok, true); assert.equal((await request(socket, 'v3-room:ready', true)).ok, true); }
  assert.equal((await request(host, 'v3-session:start', { firstPlayer })).ok, true);
  return { clients, host, guest, roomId: room.roomId, firstPlayer };
}
async function complete(socket, v) {
  for (let i = 0; i < 16; i++) {
    if (!v.frame || v.frame.status === 'completed') return v;
    if (v.frame.status === 'ready') v = await send(socket, v, 'advance');
    else if (v.frame.status === 'waitingForWork') v = await send(socket, v, 'work');
    else { const c = v.frame.choice; v = await send(socket, v, 'answer', { selectionId: c.selectionId, tokens: c.options.slice(0, c.min).map(option => option.token) }); }
  }
  throw Error('Session resolution did not complete');
}

for (const actor of [0, 1]) for (const zone of ['character', 'stage']) test(`MAIN source tokens select a public ${zone} and keep hand choices private between two clients (seat=${actor})`, async t => {
  const selected = zone === 'stage' ? { ...deck, mainDeck: Array(50).fill('STAGE'), cardTypes: { STAGE: 'stage' } } : deck;
  const { clients } = await setup(t, actor, [selected, selected]), own = clients[actor], peer = clients[1 - actor];
  let v = (await request(own, 'v3-session:sync')).sessionView;
  const play = v.playableCards.find(p => p.enabled); v = await send(own, v, 'play', { card: play.card });
  v = await send(own, v, 'trigger', { token: v.triggerChoices[0].token }); v = await complete(own, v);
  const e = v.effects.find(e => e.zone === zone && e.source.instanceId === play.card.instanceId);
  assert.ok(e?.enabled); assert.ok(e.source.generation > play.card.generation);
  const peerView = (await request(peer, 'v3-session:sync')).sessionView;
  assert.equal(peerView.effects.some(other => other.sourceToken === e.sourceToken || other.source.instanceId === e.source.instanceId), false);
  const before = v.context;
  for (const extra of [{ sourceToken: '0'.repeat(64), effectId: e.effectId }, { sourceToken: e.sourceToken, effectId: 'draw' }, { sourceToken: e.sourceToken, effectId: 'enterDraw' },
    { sourceToken: peerView.effects[0].sourceToken, effectId: e.effectId }, { sourceToken: undefined, effectId: e.effectId },
    { sourceToken: e.sourceToken, effectId: e.effectId, source: e.source }, { sourceToken: e.sourceToken, effectId: e.effectId, actor: 1 - actor }]) {
    const denied = await request(own, 'v3-session:command', command(v, 'activate', extra)); assert.equal(denied.ok, false); assert.deepEqual(denied.sessionView.context, before);
  }
  assert.equal((await request(peer, 'v3-session:command', command(peerView, 'activate', { sourceToken: e.sourceToken, effectId: e.effectId }))).ok, false);
  const input = command(v, 'activate', { sourceToken: e.sourceToken, effectId: e.effectId }), hand = v.movement.players[actor].hand.length;
  const accepted = await request(own, 'v3-session:command', input); assert.equal(accepted.ok, true); v = accepted.sessionView;
  const replay = await request(own, 'v3-session:command', input); assert.equal(replay.ok, true); assert.deepEqual(replay.sessionView.context, v.context);
  assert.equal((await request(own, 'v3-session:command', command(v, 'activate', { sourceToken: e.sourceToken, effectId: e.effectId }))).ok, false);
  v = await complete(own, v); assert.equal(v.movement.players[actor].hand.length, hand + 1);
  const used = v.effects.find(other => other.source.instanceId === e.source.instanceId); assert.equal(used.used, 1); assert.equal(used.enabled, false);
  assert.equal(v.movement.players[actor][zone][e.slot].rotated, true);
  const seen = (await request(peer, 'v3-session:sync')).sessionView;
  assert.equal(seen.movement.players[actor].hand.length, hand + 1); assert.equal(seen.movement.players[actor].hand.every(card => card.cardId === null && card.ref === null), true);
  assert.equal((await request(own, 'v3-session:command', command(v, 'activate', { sourceToken: e.sourceToken, effectId: e.effectId }))).ok, false);
});

for (const actor of [0, 1]) for (const useTrigger of [false, true]) test(`life trigger choice stays private until activation and releases its no-area source (seat=${actor}, trigger=${useTrigger})`, async t => {
  const stages = { ...deck, mainDeck: Array(50).fill('STAGE'), cardTypes: { STAGE: 'stage' } }, attacker = 1 - actor;
  const { clients } = await setup(t, attacker, [stages, stages]), own = clients[actor], peer = clients[attacker];
  let v = (await request(peer, 'v3-session:sync')).sessionView; v = await send(peer, v, 'endTurn');
  v = (await request(own, 'v3-session:sync')).sessionView; v = await send(own, v, 'endTurn');
  v = (await request(peer, 'v3-session:sync')).sessionView;
  v = await send(peer, v, 'attack', { source: v.attackChoices.sources[0].card, target: v.attackChoices.targets[0].card });
  let defended = (await request(own, 'v3-session:sync')).sessionView; defended = await send(own, defended, 'passBlock');
  defended = await send(own, defended, 'endCounter'); defended = await send(own, defended, 'damage');
  const beforeHand = defended.movement.players[actor].hand.length, beforeLife = defended.movement.players[actor].life.length;
  assert.equal(defended.lifeChoice.canTrigger, true);
  let seen = (await request(peer, 'v3-session:sync')).sessionView; assert.equal(seen.lifeChoice, null);
  assert.equal(seen.movement.players[actor].life[0].cardId, null); assert.equal(seen.movement.players[actor].life[0].ref, null);
  const choice = defended.lifeChoice, input = command(defended, useTrigger ? 'lifeTrigger' : 'life', { selectionId: choice.selectionId, token: choice.token });
  assert.equal((await request(peer, 'v3-session:command', input)).ok, false);
  const picked = await request(own, 'v3-session:command', input); assert.equal(picked.ok, true); defended = picked.sessionView;
  assert.equal((await request(own, 'v3-session:command', input)).sessionView.context.revision, defended.context.revision);
  if (useTrigger) {
    assert.deepEqual(defended.movement.players[actor].resolving, []); assert.equal(defended.lifeTrigger.cardId, choice.cardId);
    assert.equal(defended.movement.players[actor].hand.length, beforeHand); assert.equal(defended.movement.players[actor].trash.length, 0);
    seen = (await request(peer, 'v3-session:sync')).sessionView; assert.deepEqual(seen.lifeTrigger, defended.lifeTrigger);
    assert.deepEqual(seen.movement.players[actor].resolving, []); assert.ok(seen.imageAliases[choice.cardId]);
    defended = await complete(own, defended);
    assert.equal(defended.movement.players[actor].trash[0].cardId, choice.cardId);
  }
  assert.equal(defended.lifeTrigger, null); assert.equal(defended.battle, null);
  assert.equal(defended.movement.players[actor].life.length, beforeLife - 1); assert.equal(defended.movement.players[actor].hand.length, beforeHand + 1);
  seen = (await request(peer, 'v3-session:sync')).sessionView;
  assert.equal(seen.movement.players[actor].hand.every(card => card.cardId === null && card.ref === null), true);
  assert.equal(seen.battle, null); assert.deepEqual(seen.movement.players[actor].trash, defended.movement.players[actor].trash);
});

test('counter events synchronize payment and selection without exposing the other hand', async t => {
  const events = { ...deck, mainDeck: Array(50).fill('EVENT'), cardTypes: { EVENT: 'event' } };
  const { host, guest } = await setup(t, 0, [events, events]);
  let v = (await request(host, 'v3-session:sync')).sessionView; v = await send(host, v, 'endTurn');
  v = (await request(guest, 'v3-session:sync')).sessionView; v = await send(guest, v, 'endTurn');
  v = (await request(host, 'v3-session:sync')).sessionView;
  v = await send(host, v, 'attack', { source: v.attackChoices.sources[0].card, target: v.attackChoices.targets[0].card });
  let defended = (await request(guest, 'v3-session:sync')).sessionView; defended = await send(guest, defended, 'passBlock');
  const choice = defended.counterEventChoices[0], beforeHand = defended.movement.players[1].hand.length, beforeDon = defended.movement.players[1].activeDon.length;
  const use = command(defended, 'counterEvent', { card: choice.card, effectId: choice.effectId });
  const used = await request(guest, 'v3-session:command', use); assert.equal(used.ok, true); defended = used.sessionView;
  assert.equal((await request(guest, 'v3-session:command', use)).sessionView.context.revision, defended.context.revision);
  defended = await send(guest, defended, 'advance');
  const peer = (await request(host, 'v3-session:sync')).sessionView;
  assert.deepEqual(peer.frame.choice.options, []); assert.deepEqual(peer.counterEventChoices, []);
  assert.equal(peer.movement.players[1].hand.every(card => card.cardId === null && card.ref === null), true);
  assert.equal(peer.movement.players[1].trash[0].cardId, choice.cardId);
  defended = await complete(guest, defended);
  assert.equal(defended.movement.players[1].hand.length, beforeHand - 1); assert.equal(defended.movement.players[1].activeDon.length, beforeDon - 1);
  assert.equal(defended.battle.powers.defense, 7000);
  const seen = (await request(host, 'v3-session:sync')).sessionView; assert.deepEqual(seen.battle, defended.battle);
  defended = await send(guest, defended, 'endCounter'); defended = await send(guest, defended, 'damage');
  assert.equal(defended.battle, null); assert.equal(defended.publicStats.find(card => card.player === 1 && card.zone === 'leader').powerDelta, 0);
});

for (const actor of [0, 1]) test(`fresh synthetic Rush attacks and only a declared Blocker redirects the source arrow for seat ${actor}`, async t => {
  const { clients } = await setup(t, actor), own = clients[actor], peer = clients[1 - actor];
  async function enter(socket) {
    let v = (await request(socket, 'v3-session:sync')).sessionView;
    v = await send(socket, v, 'play', { card: v.playableCards[0].card });
    v = await send(socket, v, 'trigger', { token: v.triggerChoices[0].token }); v = await send(socket, v, 'advance'); const choice = v.frame.choice;
    return send(socket, v, 'answer', { selectionId: choice.selectionId, tokens: [choice.options[1].token] });
  }
  let v = await enter(own); v = await send(own, v, 'endTurn'); v = await enter(peer); v = await send(peer, v, 'endTurn');
  v = await enter(own); const fresh = v.movement.players[actor].character[1].ref;
  v = await send(own, v, 'activate', { effectId: 'unblockable' }); v = await complete(own, v);
  assert.equal(v.publicStats.find(card => card.player === actor && card.zone === 'leader').keywords.includes('CANNOT_BE_BLOCKED'), true);
  assert.equal(v.attackChoices.sources.some(choice => choice.card.instanceId === fresh.instanceId), true);
  const target = v.attackChoices.targets[0].card; v = await send(own, v, 'attack', { source: fresh, target });
  if (v.gate === 'trigger') {
    v = await send(own, v, 'trigger', { token: v.triggerChoices[0].token }); v = await send(own, v, 'advance'); const choice = v.frame.choice;
    v = await send(own, v, 'answer', { selectionId: choice.selectionId, tokens: [choice.options[1].token] });
  }
  let other = (await request(peer, 'v3-session:sync')).sessionView; const blocker = other.blockerChoices[0].card;
  assert.equal((await request(own, 'v3-session:command', command(v, 'block', { card: blocker }))).ok, false);
  const blocking = command(other, 'block', { card: blocker }); other = (await request(peer, 'v3-session:command', blocking)).sessionView;
  assert.equal((await request(peer, 'v3-session:command', blocking)).sessionView.context.revision, other.context.revision);
  assert.equal(other.battle.source.instanceId, fresh.instanceId); assert.equal(other.battle.target.instanceId, blocker.instanceId); assert.equal(other.battle.step, 'counter');
  assert.equal(other.movement.players[1 - actor].character[0].rotated, true);
  assert.equal((await request(peer, 'v3-session:command', command(other, 'block', { card: blocker }))).ok, false);
  other = await send(peer, other, 'endCounter'); other = await send(peer, other, 'damage');
  if (other.gate === 'trigger') {
    other = await send(peer, other, 'trigger', { token: other.triggerChoices[0].token }); other = await send(peer, other, 'advance'); const choice = other.frame.choice;
    other = await send(peer, other, 'answer', { selectionId: choice.selectionId, tokens: [choice.options[1].token] });
  }
  assert.equal(other.battle, null); assert.equal(other.movement.players[1 - actor].character[0], null); assert.equal(other.movement.players[1 - actor].life.length, 5);
  const seen = (await request(own, 'v3-session:sync')).sessionView; assert.equal(seen.movement.players[1 - actor].trash.length, 1);
  const next = await send(own, seen, 'endTurn'); assert.equal(next.publicStats.find(card => card.player === actor && card.zone === 'leader').keywords.includes('CANNOT_BE_BLOCKED'), false);
});

for (const actor of [0, 1]) test(`basic battle for seat ${actor} handles DON, counters, private life and lethal damage`, async t => {
  const smallLife = { ...deck, leaderLifeCount: 1 };
  const { clients } = await setup(t, actor, [smallLife, smallLife]), own = clients[actor], peer = clients[1 - actor];
  let v = (await request(own, 'v3-session:sync')).sessionView;
  assert.equal(v.attackChoices.sources.length, 0); v = await send(own, v, 'endTurn');
  v = (await request(peer, 'v3-session:sync')).sessionView; v = await send(peer, v, 'endTurn');
  v = (await request(own, 'v3-session:sync')).sessionView;
  const leader = v.publicStats.find(card => card.player === actor && card.zone === 'leader').card;
  v = await send(own, v, 'attachDon', { target: leader, count: 1 });
  assert.equal(v.movement.players[actor].attachedDon.length, 1);
  async function fight(attacker, defender, counters = 0) {
    let attackView = (await request(attacker, 'v3-session:sync')).sessionView;
    const input = command(attackView, 'attack', { source: attackView.attackChoices.sources[0].card, target: attackView.attackChoices.targets[0].card });
    attackView = (await request(attacker, 'v3-session:command', input)).sessionView;
    assert.equal((await request(attacker, 'v3-session:command', input)).sessionView.context.revision, attackView.context.revision);
    let defended = (await request(defender, 'v3-session:sync')).sessionView;
    assert.equal((await request(attacker, 'v3-session:command', command(attackView, 'passBlock'))).ok, false);
    defended = await send(defender, defended, 'passBlock');
    for (let i = 0; i < counters; i++) defended = await send(defender, defended, 'counter', { card: defended.counterChoices[0].card, target: defended.battle.target });
    defended = await send(defender, defended, 'endCounter');
    const powers = defended.battle.powers; defended = await send(defender, defended, 'damage');
    if (defended.lifeChoice) {
      const hidden = (await request(attacker, 'v3-session:sync')).sessionView;
      assert.equal(hidden.lifeChoice, null); assert.equal(hidden.lifePending, true);
      const life = command(defended, 'life', { selectionId: defended.lifeChoice.selectionId, token: defended.lifeChoice.token });
      assert.equal((await request(attacker, 'v3-session:command', life)).ok, false);
      defended = (await request(defender, 'v3-session:command', life)).sessionView;
      assert.equal((await request(defender, 'v3-session:command', life)).sessionView.context.revision, defended.context.revision);
      const after = (await request(attacker, 'v3-session:sync')).sessionView;
      assert.equal(after.movement.players[after.battle?.defender ?? defended.localPlayerIndex].hand.every(card => card.cardId === null), true);
    }
    return { view: defended, powers };
  }
  let result = await fight(own, peer, 2);
  assert.deepEqual(result.powers, { attack: 6000, defense: 7000 }); assert.equal(result.view.movement.players[1 - actor].life.length, 1);
  v = (await request(own, 'v3-session:sync')).sessionView; await send(own, v, 'endTurn');
  result = await fight(peer, own); assert.deepEqual(result.powers, { attack: 5000, defense: 5000 }); assert.equal(result.view.movement.players[actor].life.length, 0);
  v = (await request(peer, 'v3-session:sync')).sessionView; await send(peer, v, 'endTurn');
  result = await fight(own, peer); assert.equal(result.view.movement.players[1 - actor].life.length, 0);
  v = (await request(own, 'v3-session:sync')).sessionView; await send(own, v, 'endTurn');
  result = await fight(peer, own); assert.equal(result.view.outcome.winner, 1 - actor); assert.equal(result.view.battle, null);
  assert.deepEqual((await request(peer, 'v3-session:sync')).sessionView.outcome, result.view.outcome);
  assert.equal((await request(own, 'v3-session:command', command(result.view, 'endTurn'))).ok, false);
});

for (const actor of [0, 1]) test(`stat changes sync and expire at their declared player boundary for seat ${actor}`, async t => {
  const { clients } = await setup(t, actor), own = clients[actor], peer = clients[1 - actor];
  let v = (await request(own, 'v3-session:sync')).sessionView;
  v = await send(own, v, 'play', { card: v.playableCards[0].card });
  if (v.gate === 'trigger') {
    v = await send(own, v, 'trigger', { token: v.triggerChoices[0].token }); v = await send(own, v, 'advance'); const choice = v.frame.choice;
    v = await send(own, v, 'answer', { selectionId: choice.selectionId, tokens: [choice.options[1].token] });
  }
  for (const effectId of ['buff', 'debuff', 'costDown']) {
    v = await send(own, v, 'activate', { effectId }); v = await send(own, v, 'advance'); const choice = v.frame.choice;
    v = await send(own, v, 'answer', { selectionId: choice.selectionId, tokens: [choice.options[0].token] });
    v = await send(own, v, 'advance'); assert.equal(v.workType, 'MODIFY_STAT');
    const work = command(v, 'work'); v = (await request(own, 'v3-session:command', work)).sessionView;
    assert.equal((await request(own, 'v3-session:command', work)).sessionView.context.revision, v.context.revision);
    v = await complete(own, v);
  }
  const leader = (view, player) => view.publicStats.find(card => card.player === player && card.zone === 'leader');
  const character = view => view.publicStats.find(card => card.player === actor && card.zone === 'character');
  assert.equal(leader(v, actor).power, 6000); assert.equal(leader(v, 1 - actor).power, 4000); assert.equal(character(v).cost, 1);
  assert.deepEqual((await request(peer, 'v3-session:sync')).sessionView.publicStats, v.publicStats);
  v = await send(own, v, 'endTurn');
  assert.equal(leader(v, actor).power, 5000); assert.equal(character(v).cost, 2); assert.equal(leader(v, 1 - actor).power, 4000);
  const other = (await request(peer, 'v3-session:sync')).sessionView; v = await send(peer, other, 'endTurn');
  assert.equal(leader(v, 1 - actor).power, 5000); assert.equal(v.publicStats.every(card => !card.powerDelta && !card.costDelta), true);
});

for (const [actor, accepted] of [[0, true], [1, false]]) test(`entry triggers for seat ${actor} lock normal actions, authorize only the controller and resolve optionally (accepted=${accepted})`, async t => {
  const { clients } = await setup(t, actor), own = clients[actor], peer = clients[1 - actor];
  let v = (await request(own, 'v3-session:sync')).sessionView;
  const play = command(v, 'play', { card: v.playableCards[0].card }); v = (await request(own, 'v3-session:command', play)).sessionView;
  assert.equal(v.gate, 'trigger'); assert.equal(v.pendingTriggerCount, 1); assert.equal(v.triggerChooser, actor);
  const pending = v.triggerChoices[0]; assert.equal(pending.effectId, 'enterDraw');
  assert.equal((await request(own, 'v3-session:command', play)).sessionView.triggerChoices[0].token, pending.token);
  assert.equal((await request(own, 'v3-session:command', command(v, 'endTurn'))).ok, false);
  assert.equal((await request(own, 'v3-session:command', command(v, 'activate', { effectId: 'draw' }))).ok, false);
  let other = (await request(peer, 'v3-session:sync')).sessionView; assert.equal(other.pendingTriggerCount, 1); assert.deepEqual(other.triggerChoices, []);
  assert.equal((await request(peer, 'v3-session:command', command(other, 'trigger', { token: pending.token }))).ok, false);
  const resolve = command(v, 'trigger', { token: pending.token }); v = (await request(own, 'v3-session:command', resolve)).sessionView;
  assert.equal((await request(own, 'v3-session:command', resolve)).sessionView.context.revision, v.context.revision);
  v = await send(own, v, 'advance'); const choice = v.frame.choice; assert.equal(choice.purpose, 'activation');
  v = await send(own, v, 'answer', { selectionId: choice.selectionId, tokens: [choice.options[accepted ? 0 : 1].token] });
  v = await complete(own, v); assert.equal(v.movement.players[actor].hand.length, accepted ? 5 : 4); assert.equal(v.pendingTriggerCount, 0); assert.equal(v.gate, 'idle');
  assert.equal((await request(own, 'v3-session:command', command(v, 'trigger', { token: pending.token }))).ok, false);
  other = (await request(peer, 'v3-session:sync')).sessionView;
  assert.equal(other.movement.players[actor].hand.length, accepted ? 5 : 4); assert.equal(other.movement.players[actor].hand.every(card => card.cardId === null), true);
  v = await send(own, v, 'endTurn'); assert.equal(typeof v.history.at(-1).triggerEventId, 'string'); assert.equal(v.history.at(-1).declined, !accepted);
});

for (const actor of [0, 1]) test(`continuous session starts with seat ${actor}, enforces use limits, and continues across both turns`, async t => {
  const { clients, host } = await setup(t, actor), own = clients[actor], peer = clients[1 - actor];
  let v = (await request(own, 'v3-session:sync')).sessionView; const matchId = v.matchId;
  assert.equal(v.frame, null); assert.equal(v.activePlayer, actor); assert.equal(v.effects.every(effect => effect.enabled && effect.used === 0), true);
  const foreign = (await request(peer, 'v3-session:sync')).sessionView;
  assert.equal((await request(peer, 'v3-session:command', command(foreign, 'activate', { effectId: 'draw' }))).ok, false);
  const begin = command(v, 'activate', { effectId: 'draw' }); v = (await request(own, 'v3-session:command', begin)).sessionView;
  assert.equal((await request(own, 'v3-session:command', begin)).sessionView.context.revision, v.context.revision);
  v = await complete(own, v); assert.equal(v.movement.players[actor].hand.length, 6);
  assert.equal(v.effects.find(effect => effect.effectId === 'draw').used, 1); assert.equal(v.effects.find(effect => effect.effectId === 'draw').enabled, false);
  const denied = await request(own, 'v3-session:command', command(v, 'activate', { effectId: 'draw' })); assert.equal(denied.ok, false); assert.deepEqual(denied.sessionView.context, v.context);
  const synced = (await request(peer, 'v3-session:sync')).sessionView;
  assert.equal(synced.movement.players[actor].hand.every(card => card.cardId === null && card.ref === null), true);
  v = await send(own, v, 'endTurn'); assert.equal(v.activePlayer, 1 - actor); assert.equal(v.turnNumber, 2); assert.equal(v.matchId, matchId); assert.equal(v.frame, null);
  let other = (await request(peer, 'v3-session:sync')).sessionView; assert.equal(other.movement.players[1 - actor].hand.length, 6);
  assert.equal(other.effects.every(effect => effect.enabled), true); other = await send(peer, other, 'activate', { effectId: 'draw' }); other = await complete(peer, other);
  assert.equal(other.movement.players[1 - actor].hand.length, 7); other = await send(peer, other, 'endTurn');
  v = (await request(own, 'v3-session:sync')).sessionView; assert.equal(v.turnNumber, 3); assert.equal(v.activePlayer, actor); assert.equal(v.matchId, matchId);
  assert.equal(v.effects.find(effect => effect.effectId === 'draw').enabled, true); assert.equal(v.effects.find(effect => effect.effectId === 'draw').used, 0);
  v = await send(own, v, 'activate', { effectId: 'draw' }); assert.equal((await complete(own, v)).frame.status, 'completed');
  assert.equal((await request(host, 'v3-session:end')).ok, true);
});

test('optional decline keeps the use available, a pending choice blocks turn end, and committed costs sync only once', async t => {
  const { host, guest } = await setup(t); let v = (await request(host, 'v3-session:sync')).sessionView;
  v = await send(host, v, 'activate', { effectId: 'paidDraw' }); v = await send(host, v, 'advance');
  const declined = v.frame.choice; assert.deepEqual((await request(guest, 'v3-session:sync')).sessionView.frame.choice.options, []);
  const blockedEnd = await request(host, 'v3-session:command', command(v, 'endTurn')); assert.equal(blockedEnd.ok, false); assert.deepEqual(blockedEnd.sessionView.context, v.context);
  v = await send(host, v, 'answer', { selectionId: declined.selectionId, tokens: [declined.options[1].token] });
  assert.equal(v.effects.find(effect => effect.effectId === 'paidDraw').used, 0); assert.equal(v.effects.find(effect => effect.effectId === 'paidDraw').enabled, true);
  v = await send(host, v, 'activate', { effectId: 'paidDraw' }); v = await send(host, v, 'advance'); const accepted = v.frame.choice;
  v = await send(host, v, 'answer', { selectionId: accepted.selectionId, tokens: [accepted.options[0].token] }); v = await send(host, v, 'advance');
  const hand = v.frame.choice; assert.equal(v.effects.find(effect => effect.effectId === 'paidDraw').used, 0);
  v = await send(host, v, 'answer', { selectionId: hand.selectionId, tokens: [hand.options[0].token] }); v = await send(host, v, 'advance');
  const pay = command(v, 'work'); v = (await request(host, 'v3-session:command', pay)).sessionView;
  assert.equal((await request(host, 'v3-session:command', pay)).sessionView.context.revision, v.context.revision);
  assert.equal(v.effects.find(effect => effect.effectId === 'paidDraw').used, 1); assert.equal(v.movement.players[0].hand.length, 4); assert.equal(v.movement.players[0].restDon.length, 1);
  const peer = (await request(guest, 'v3-session:sync')).sessionView; assert.equal(peer.movement.players[0].restDon.length, 1); assert.equal(peer.movement.players[0].trash.length, 1);
  assert.equal((await complete(host, v)).movement.players[0].hand.length, 5);
});

test('continuous and single fixtures are isolated, extra authority is refused, and closing or leaving clears the session', async t => {
  const { clients, host, guest, roomId } = await setup(t); const old = (await request(host, 'v3-session:sync')).sessionView;
  assert.equal((await request(host, 'v3:start', { actor: 0, scenario: 'payDraw' })).ok, false);
  assert.equal((await request(host, 'v3:sync')).ok, false); assert.equal((await request(clients[2], 'v3-session:sync')).ok, false);
  assert.equal((await request(clients[2], 'v3-room:join', roomId)).ok, false);
  assert.equal((await request(host, 'v3-session:command', { ...command(old, 'activate', { effectId: 'draw' }), actor: 1 })).ok, false);
  assert.equal((await request(guest, 'v3-session:end')).ok, false);
  assert.equal((await request(host, 'v3-session:end')).ok, true); assert.equal((await request(host, 'v3-session:sync')).ok, false);
  for (const socket of [host, guest]) assert.equal((await request(socket, 'v3-room:ready', true)).ok, true);
  assert.equal((await request(host, 'v3-session:start', { firstPlayer: 0 })).ok, true);
  assert.equal((await request(host, 'v3-session:command', command(old, 'endTurn'))).ok, false);
  await request(guest, 'v3-room:leave'); assert.equal((await request(host, 'v3-session:sync')).ok, false);
  assert.equal((await request(clients[2], 'v3-room:join', roomId)).ok, true);
});

for (const actor of [0, 1]) test(`seat ${actor} can play an approved synthetic hand card with exact cost, once, while the opponent sees only its public entry`, async t => {
  const { clients } = await setup(t, actor), own = clients[actor], peer = clients[1 - actor];
  let v = (await request(own, 'v3-session:sync')).sessionView, other = (await request(peer, 'v3-session:sync')).sessionView;
  const play = v.playableCards[0]; assert.equal(play.cost, 2); assert.equal(play.enabled, true); assert.equal(play.zone, 'character');
  assert.equal(other.playableCards.some(card => card.card.instanceId === play.card.instanceId), false);
  const commandInput = command(v, 'play', { card: play.card });
  assert.equal((await request(peer, 'v3-session:command', { ...command(other, 'play', { card: play.card }) })).ok, false);
  const stale = { ...commandInput, requestId: 'stale-play', card: { ...play.card, generation: play.card.generation + 1 } };
  assert.equal((await request(own, 'v3-session:command', stale)).ok, false);
  v = (await request(own, 'v3-session:command', commandInput)).sessionView;
  assert.equal((await request(own, 'v3-session:command', commandInput)).sessionView.context.revision, v.context.revision);
  const placed = v.movement.players[actor].character[0]; assert.equal(placed.ref.instanceId, play.card.instanceId); assert.equal(placed.ref.generation, play.card.generation + 1);
  assert.equal(v.movement.players[actor].hand.length, 4); assert.equal(v.movement.players[actor].activeDon.length, 0); assert.equal(v.movement.players[actor].restDon.length, 2);
  assert.equal(v.playableCards.every(card => !card.enabled), true);
  other = (await request(peer, 'v3-session:sync')).sessionView;
  assert.equal(other.movement.players[actor].character[0].cardId, placed.cardId); assert.equal(other.imageAliases[placed.cardId], 'CARD');
  assert.equal(other.movement.players[actor].hand.every(card => card.cardId === null && card.ref === null), true);
  const denied = await request(own, 'v3-session:command', command(v, 'play', { card: v.playableCards[0].card }));
  assert.equal(denied.ok, false); assert.deepEqual(denied.sessionView.context, v.context);
});

test('synthetic image aliases do not disclose the opponent deck or hand before a card is made public', async t => {
  const guestDeck = { ...deck, mainDeck: Array(50).fill('GUEST-CARD'), cardTypes: { 'GUEST-CARD': 'character' } };
  const { host, guest } = await setup(t, 1, [deck, guestDeck]);
  const initial = (await request(host, 'v3-session:sync')).sessionView;
  assert.equal(Object.values(initial.imageAliases).includes('GUEST-CARD'), false);
  let own = (await request(guest, 'v3-session:sync')).sessionView;
  assert.equal(Object.values(own.imageAliases).includes('CARD'), false); assert.equal(Object.values(own.imageAliases).includes('GUEST-CARD'), true);
  own = await send(guest, own, 'play', { card: own.playableCards[0].card });
  const publicView = (await request(host, 'v3-session:sync')).sessionView;
  assert.equal(Object.values(publicView.imageAliases).includes('GUEST-CARD'), true);
  assert.equal(publicView.movement.players[1].hand.every(card => card.cardId === null), true);
});

for (const actor of [0, 1]) for (const picked of [false, true]) test(`seat ${actor} searches privately, publishes only its chosen card, orders the remainder and closes knowledge (picked=${picked})`, async t => {
  const searchDeck = { ...deck, mainDeck: Array.from({ length: 50 }, (_, i) => `SEARCH-${i}`), cardTypes: Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`SEARCH-${i}`, 'character'])) };
  const decks = [deck, deck]; decks[actor] = searchDeck;
  const { clients } = await setup(t, actor, decks), own = clients[actor], peer = clients[1 - actor];
  let v = (await request(own, 'v3-session:sync')).sessionView;
  v = await send(own, v, 'activate', { effectId: 'search' }); v = await send(own, v, 'advance');
  assert.equal(v.workType, 'LOOK_TOP'); assert.equal(v.movement.players[actor].deck.every(card => card.cardId === null), true);
  v = await send(own, v, 'work');
  const visible = v.movement.players[actor].deck.filter(card => card.cardId !== null);
  assert.equal(visible.length, 3);
  let other = (await request(peer, 'v3-session:sync')).sessionView;
  assert.equal(other.movement.players[actor].deck.every(card => card.cardId === null && card.ref === null), true);
  for (const card of visible) assert.equal(other.imageAliases[card.cardId], undefined);
  v = await send(own, v, 'advance'); const selection = v.frame.choice;
  assert.equal(selection.options.length, 3); assert.equal(selection.min, 0);
  assert.deepEqual((await request(peer, 'v3-session:sync')).sessionView.frame.choice.options, []);
  assert.equal((await request(peer, 'v3-session:command', command(v, 'answer', { selectionId: selection.selectionId, tokens: [selection.options[0].token] }))).ok, false);
  const selected = selection.options[1];
  v = await send(own, v, 'answer', { selectionId: selection.selectionId, tokens: picked ? [selected.token] : [] });
  if (picked) {
    v = await send(own, v, 'advance'); assert.equal(v.workType, 'REVEAL'); v = await send(own, v, 'work');
    other = (await request(peer, 'v3-session:sync')).sessionView;
    assert.equal(other.publicReveals.length, 1); assert.equal(other.publicReveals[0].cardId, selected.cardId);
    assert.equal(other.imageAliases[selected.cardId], v.imageAliases[selected.cardId]);
    for (const card of visible.filter(card => card.cardId !== selected.cardId)) assert.equal(other.imageAliases[card.cardId], undefined);
    v = await send(own, v, 'advance'); assert.equal(v.workType, 'MOVE_CARD'); v = await send(own, v, 'work');
    assert.equal(v.movement.players[actor].hand.length, 6);
    other = (await request(peer, 'v3-session:sync')).sessionView;
    assert.deepEqual(other.publicReveals, []); assert.equal(other.imageAliases[selected.cardId], undefined);
    assert.equal(other.movement.players[actor].hand.every(card => card.cardId === null && card.ref === null), true);
  }
  v = await send(own, v, 'advance'); const order = v.frame.choice;
  assert.equal(order.purpose, 'order'); assert.equal(order.options.length, picked ? 2 : 3); assert.equal(order.min, order.options.length); assert.equal(order.max, order.min);
  assert.deepEqual((await request(peer, 'v3-session:sync')).sessionView.frame.choice.options, []);
  const rejected = await request(own, 'v3-session:command', command(v, 'answer', { selectionId: order.selectionId, tokens: [order.options[0].token] }));
  assert.equal(rejected.ok, false); assert.deepEqual(rejected.sessionView.context, v.context);
  v = await send(own, v, 'answer', { selectionId: order.selectionId, tokens: [...order.options].reverse().map(option => option.token) });
  v = await send(own, v, 'advance'); assert.equal(v.workType, 'RETURN_TO_DECK');
  const returning = command(v, 'work'); v = (await request(own, 'v3-session:command', returning)).sessionView;
  assert.equal((await request(own, 'v3-session:command', returning)).sessionView.context.revision, v.context.revision);
  const remainder = visible.filter(card => !picked || card.cardId !== selected.cardId).reverse().map(card => card.cardId);
  assert.deepEqual(v.movement.players[actor].deck.slice(-remainder.length).map(card => card.cardId), remainder);
  v = await send(own, v, 'advance'); assert.equal(v.workType, 'CLOSE_REVEALS');
  assert.equal((await request(own, 'v3-session:command', command(v, 'endTurn'))).ok, false);
  v = await send(own, v, 'work'); v = await send(own, v, 'advance');
  assert.equal(v.frame.status, 'completed'); assert.equal(v.gate, 'idle'); assert.equal(v.effects.find(effect => effect.effectId === 'search').used, 1);
  assert.equal(v.movement.players[actor].deck.every(card => card.cardId === null && card.ref === null), true);
  for (const card of visible.filter(card => !picked || card.cardId !== selected.cardId)) assert.equal(v.imageAliases[card.cardId], undefined);
});
