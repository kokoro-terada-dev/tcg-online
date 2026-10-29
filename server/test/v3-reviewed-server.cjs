const { test } = require('node:test');
const assert = require('node:assert/strict');
const { io } = require('socket.io-client');
const { startLocalV3Server } = require('../dist/test/effects/v3/localServer.js');
const request = (socket, event, input = null) => new Promise((resolve, reject) => socket.timeout(3000).emit(event, input, (error, reply) => error ? reject(error) : resolve(reply)));
const once = (socket, event) => new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error(event)), 3000); socket.once(event, value => { clearTimeout(timer); resolve(value); }); });
let sequence = 0;
async function command(socket, view, kind, extra = {}) {
  const reply = await request(socket, 'v3-session:command', { matchId: view.matchId, requestId: `play-${++sequence}`, context: view.context, kind, ...extra });
  assert.equal(reply.ok, true, JSON.stringify(reply)); return reply.sessionView;
}
async function sync(socket) { const reply = await request(socket, 'v3-session:sync'); assert.equal(reply.ok, true); return reply.sessionView; }

for (const first of [0, 1]) test(`reviewed room reaches a synchronized outcome and returns to the same room (first=${first})`, async t => {
  const service = await startLocalV3Server(), clients = [];
  t.after(async () => { clients.forEach(client => client.disconnect()); await new Promise(resolve => service.io.close(resolve)); });
  for (let i = 0; i < 3; i++) { const client = io(service.url, { autoConnect: false, reconnection: false }); clients.push(client); const connected = once(client, 'connect'); client.connect(); await connected; }
  const [host, guest, outsider] = clients;
  const created = once(host, 'v3-room:state'); await request(host, 'v3-room:create'); const room = await created;
  assert.equal((await request(guest, 'v3-room:join', room.roomId)).ok, true);
  assert.equal((await request(host, 'v3-room:mode', 'reviewed')).ok, true);
  assert.equal((await request(guest, 'v3-room:mode', 'synthetic')).ok, false);
  for (const client of [host, guest]) assert.equal((await request(client, 'v3-room:preset', 'kid-basic')).ok, true);
  assert.equal((await request(host, 'v3-room:deck', {})).ok, false);
  assert.equal((await request(host, 'v3-room:ready', true)).ok, true);
  assert.equal((await request(host, 'v3-reviewed:start', {})).ok, false);
  assert.equal((await request(guest, 'v3-room:ready', true)).ok, true);
  assert.equal((await request(host, 'v3-session:start', { firstPlayer: first })).ok, false);
  assert.equal((await request(host, 'v3-reviewed:start', {})).ok, true);
  assert.equal((await request(outsider, 'v3-reviewed:sync')).ok, false);
  const initial = (await request(host, 'v3-reviewed:sync')).setupView;
  assert.equal(initial.movement.players.every(player => player.hand.length === 0), true);
  assert.equal((await request(host, 'v3-session:sync')).ok, false);
  const chooser = initial.choicePlayer;
  const choose = { matchId: initial.matchId, requestId: 'first', revision: initial.revision, kind: 'first', value: chooser === first ? 'first' : 'second' };
  assert.equal((await request(clients[1 - chooser], 'v3-reviewed:command', choose)).ok, false);
  let selected = (await request(clients[chooser], 'v3-reviewed:command', choose)).setupView;
  assert.equal(selected.firstPlayer, first);
  const other = 1 - first;
  const redraw = { matchId: initial.matchId, requestId: 'redraw', revision: selected.revision, kind: 'mulligan', value: true };
  assert.equal((await request(clients[other], 'v3-reviewed:command', { ...redraw, requestId: 'early' })).ok, false);
  selected = (await request(clients[first], 'v3-reviewed:command', redraw)).setupView;
  assert.equal(selected.status, 'mulligan'); assert.equal((await request(clients[first], 'v3-session:sync')).ok, false);
  const keep = { matchId: initial.matchId, requestId: 'keep', revision: selected.revision, kind: 'mulligan', value: false };
  const ready = await request(clients[other], 'v3-reviewed:command', keep); assert.equal(ready.ok, true);
  const repeated = await request(clients[other], 'v3-reviewed:command', keep); assert.deepEqual(repeated.sessionView.context, ready.sessionView.context);
  let view = await sync(clients[first]); assert.equal(view.mode, 'v3-reviewed-session'); assert.equal(view.turnNumber, 1);
  assert.equal(view.movement.players[first].activeDon.length, 1); assert.equal(view.movement.players[other].activeDon.length, 0);
  assert.equal(view.movement.players[first].leader[0].cardId, 'ST02-001'); assert.equal(view.imageAliases.DON, 'don');
  view = await command(clients[first], view, 'endTurn'); view = await sync(clients[other]); await command(clients[other], view, 'endTurn');
  for (let hit = 0; hit < 6; hit++) {
    view = await sync(clients[first]);
    const source = view.publicStats.find(card => card.player === first && card.zone === 'leader').card, target = view.attackChoices.targets.find(card => card.cardId === 'ST02-001').card;
    view = await command(clients[first], view, 'attachDon', { target: source, count: 1 });
    view = await command(clients[first], view, 'attack', { source, target });
    let defense = await sync(clients[other]); defense = await command(clients[other], defense, 'passBlock');
    defense = await command(clients[other], defense, 'endCounter'); defense = await command(clients[other], defense, 'damage');
    if (hit < 5) {
      assert.ok(defense.lifeChoice); defense = await command(clients[other], defense, 'life', { selectionId: defense.lifeChoice.selectionId, token: defense.lifeChoice.token });
      assert.equal(defense.movement.players[other].life.length, 4 - hit);
      view = await sync(clients[first]); view = await command(clients[first], view, 'endTurn');
      defense = await sync(clients[other]); await command(clients[other], defense, 'endTurn');
    } else {
      view = await sync(clients[first]); assert.deepEqual(view.outcome, { winner: first, reason: 'leader-damage-at-zero-life' });
      assert.deepEqual(view.outcome, defense.outcome); assert.deepEqual(view.context, defense.context);
      assert.equal(view.movement.players[other].hand.every(card => card.cardId === null && card.ref === null), true);
    }
  }
  const hostRoom = once(host, 'v3-room:state'), guestRoom = once(guest, 'v3-room:state');
  assert.equal((await request(host, 'v3-session:end')).ok, true);
  const [left, right] = await Promise.all([hostRoom, guestRoom]);
  assert.equal(left.roomId, room.roomId); assert.deepEqual(left, right); assert.equal(left.matchId, null);
  assert.equal(left.host.ready, false); assert.equal(left.guest.ready, false); assert.equal(left.mode, 'reviewed');
  assert.equal((await request(guest, 'v3-reviewed:sync')).ok, false);
});
