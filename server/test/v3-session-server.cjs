const { test } = require('node:test');
const assert = require('node:assert/strict');
const { io } = require('socket.io-client');
const { startLocalV3Server } = require('../dist/test/effects/v3/localServer.js');
const deck = { name: 'Synthetic session', leaderCardId: 'LEADER', mainDeck: Array(50).fill('CARD'), donDeck: Array(10).fill('DON'), cardTypes: { CARD: 'character' }, leaderLifeCount: 5 };
const request = (socket, event, input = null) => new Promise((resolve, reject) => socket.timeout(3000).emit(event, input, (error, reply) => error ? reject(error) : resolve(reply)));
const once = (socket, event) => new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error(event)), 3000); socket.once(event, value => { clearTimeout(timer); resolve(value); }); });
let sequence = 0;
const command = (v, kind, extra = {}) => ({ matchId: v.matchId, requestId: `session-${++sequence}`, context: v.context, kind, ...extra });
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
    if (v.frame.status === 'completed') return v;
    if (v.frame.status === 'ready') v = await send(socket, v, 'advance');
    else if (v.frame.status === 'waitingForWork') v = await send(socket, v, 'work');
    else { const c = v.frame.choice; v = await send(socket, v, 'answer', { selectionId: c.selectionId, tokens: c.options.slice(0, c.min).map(option => option.token) }); }
  }
  throw Error('Session resolution did not complete');
}

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
