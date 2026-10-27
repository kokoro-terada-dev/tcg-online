const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { createMatch, projectMatch, parseDeck, applyCommand } = require("../dist/test/game.js");

const recipe = () => ({ name: "test", leaderCardId: "leader", leaderLifeCount: 5, mainDeck: Array(50).fill("character"), donDeck: Array(10).fill("don"), cardTypes: { character: "character" } });
const command = (game, action, revision = game.revision) => ({ matchId: game.id, expectedRevision: revision, requestId: randomUUID(), ...action });
const countCards = (game) => game.players.flatMap((player) => Object.values(player.zones).flat()).filter(Boolean);

test("deck validation and independent, private initial state", () => {
  assert.equal(parseDeck(null), null);
  assert.equal(parseDeck({ ...recipe(), mainDeck: [] }), null);
  assert.equal(parseDeck({ ...recipe(), leaderLifeCount: 1.5 }), null);
  const parsed = parseDeck(recipe());
  const game = createMatch(parsed, parsed);
  assert.equal(countCards(game).length, 122);
  assert.equal(new Set(countCards(game).map((card) => card.id)).size, 122);
  for (const viewer of [0, 1]) {
    const state = projectMatch(game, viewer);
    assert.equal(state.players[viewer].zones.hand.length, 5);
    assert.ok(state.players[viewer].zones.hand.every((card) => card.cardId === "character"));
    assert.ok(state.players[1 - viewer].zones.hand.every((card) => card.cardId === null && card.kind === null));
    for (const player of state.players) {
      assert.equal(player.zones.deck.length, 40);
      assert.equal(player.zones.life.length, 5);
      assert.ok(player.zones.deck.every((card) => card.cardId === null));
      assert.ok(player.zones.life.every((card) => card.cardId === null));
    }
  }
});

test("atomic moves, replay protection, full slots, revisions and DON", () => {
  const game = createMatch(recipe(), recipe());
  const zones = game.players[0].zones;
  const card = zones.hand[0];
  const move = command(game, { kind: "move", cardInstanceId: card.id, from: "hand", to: "character", slotIndex: 0 });
  const initial = JSON.stringify(game.players);
  assert.ok(applyCommand(game, 1, move));
  assert.equal(JSON.stringify(game.players), initial);
  assert.equal(applyCommand(game, 0, move), null);
  assert.equal(zones.character[0].id, card.id);
  assert.equal(applyCommand(game, 0, move), null);
  assert.equal(game.revision, 1);
  assert.ok(applyCommand(game, 0, command(game, { kind: "draw" }, 0)));
  assert.equal(zones.hand.length, 4);
  for (let i = 1; i < 5; i++) {
    assert.equal(applyCommand(game, 0, command(game, { kind: "move", cardInstanceId: zones.hand[0].id, from: "hand", to: "character" })), null);
  }
  applyCommand(game, 0, command(game, { kind: "draw" }));
  const before = JSON.stringify(game.players);
  assert.ok(applyCommand(game, 0, command(game, { kind: "move", cardInstanceId: zones.hand[0].id, from: "hand", to: "character" })));
  assert.equal(JSON.stringify(game.players), before);
  assert.equal(applyCommand(game, 0, command(game, { kind: "rotate", cardInstanceId: card.id, from: "character" })), null);
  assert.equal(zones.character[0].rotated, true);
  assert.equal(applyCommand(game, 0, command(game, { kind: "move", cardInstanceId: card.id, from: "character", to: "life" })), null);
  assert.equal(zones.life[0].faceUp, false);
  assert.equal(projectMatch(game, 1).players[0].zones.life[0].cardId, null);
  assert.equal(applyCommand(game, 0, command(game, { kind: "move", cardInstanceId: card.id, from: "life", to: "hand" })), null);
  assert.equal(zones.hand.at(-1).faceUp, true);
  assert.equal(projectMatch(game, 1).players[0].zones.hand.at(-1).cardId, null);
  const don = zones.donDeck[0];
  assert.equal(applyCommand(game, 0, command(game, { kind: "move", cardInstanceId: don.id, from: "donDeck", to: "activeDon" })), null);
  assert.equal(applyCommand(game, 0, command(game, { kind: "move", cardInstanceId: don.id, from: "activeDon", to: "restDon" })), null);
  assert.equal(zones.restDon[0].rotated, true);
  assert.equal(countCards(game).length, 122);
  assert.equal(new Set(countCards(game).map((card) => card.id)).size, 122);
});

test("socket: both players receive authoritative state; private cards stay private", async () => {
  const { io } = require("socket.io-client");
  const { createTestServer } = require("../dist/test/server.js");
  const service = createTestServer();
  const clients = [];
  await new Promise((resolve) => service.http.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${service.http.address().port}`;
  const request = (socket, event, ...args) => new Promise((resolve, reject) => socket.timeout(3000).emit(event, ...args, (err, result) => err ? reject(err) : resolve(result)));
  const once = (socket, event) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Missing ${event}`)), 3000);
    socket.once(event, (value) => { clearTimeout(timer); resolve(value); });
  });
  async function connect() { const socket = io(url, { autoConnect: false, reconnection: false }); clients.push(socket); const connected = once(socket, "connect"); socket.connect(); await connected; return socket; }
  try {
    const host = await connect(), guest = await connect(), outsider = await connect();
    const roomEvent = once(host, "test-room:state");
    await request(host, "test-room:create");
    const room = await roomEvent;
    await request(guest, "test-room:join", room.roomId);
    assert.equal((await request(host, "test-match:start")).ok, false);
    await request(host, "test-room:deck", recipe()); await request(guest, "test-room:deck", recipe());
    await request(host, "test-room:ready", true); await request(guest, "test-room:ready", true);
    assert.equal((await request(guest, "test-match:start")).ok, false);
    let hostEvent = once(host, "test-match:state"), guestEvent = once(guest, "test-match:state");
    assert.equal((await request(host, "test-match:start")).ok, true);
    const [a, b] = await Promise.all([hostEvent, guestEvent]);
    assert.equal(a.matchId, b.matchId);
    assert.equal(a.players[0].zones.hand[0].id, b.players[0].zones.hand[0].id);
    assert.equal(b.players[0].zones.hand[0].cardId, null);
    assert.equal((await request(host, "test-room:deck", recipe())).ok, false);
    const move = { matchId: a.matchId, expectedRevision: 0, requestId: randomUUID(), kind: "move", from: "hand", to: "character", slotIndex: 0, cardInstanceId: a.players[0].zones.hand[0].id };
    assert.equal((await request(outsider, "test-match:command", move)).ok, false);
    assert.equal((await request(guest, "test-match:command", move)).ok, false);
    hostEvent = once(host, "test-match:state"); guestEvent = once(guest, "test-match:state");
    assert.equal((await request(host, "test-match:command", move)).ok, true);
    const [nextA, nextB] = await Promise.all([hostEvent, guestEvent]);
    assert.equal(nextA.revision, 1); assert.equal(nextB.revision, 1);
    assert.deepEqual(nextA.players[0].zones.character, nextB.players[0].zones.character);
    assert.equal(nextB.players[0].zones.character[0].cardId, "character");
    assert.equal((await request(host, "test-match:command", move)).ok, true);
    const ended = once(guest, "test-match:ended");
    assert.equal((await request(host, "test-match:end")).ok, true);
    await ended;
    assert.equal((await request(host, "test-match:command", move)).ok, false);
    const afterEnd = once(host, "test-room:state");
    await request(host, "test-room:ready", true);
    assert.equal((await afterEnd).roomId, room.roomId);
  } finally {
    clients.forEach((client) => client.disconnect());
    await new Promise((resolve) => service.io.close(resolve));
  }
});
