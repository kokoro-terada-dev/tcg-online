const { test } = require("node:test");
const assert = require("node:assert/strict");
const { io } = require("socket.io-client");
const { createTestServer } = require("../dist/test/server.js");

test("test rooms: isolation, membership, READY, leave and disconnect", async () => {
  const service = createTestServer();
  const clients = [];
  await new Promise((resolve) => service.http.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${service.http.address().port}`;
  const request = (socket, name, ...args) => new Promise((resolve, reject) => {
    socket.timeout(3000).emit(name, ...args, (err, result) => err ? reject(err) : resolve(result));
  });
  const event = (socket, name) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(name, received); reject(new Error(`Missing ${name}`)); }, 3000);
    function received(value) { clearTimeout(timer); resolve(value); }
    socket.once(name, received);
  });
  async function connect() {
    const socket = io(url, { autoConnect: false, reconnection: false });
    clients.push(socket);
    const connected = event(socket, "connect");
    socket.connect();
    await connected;
    return socket;
  }
  try {
    const host = await connect();
    const guest = await connect();
    const outsider = await connect();
    let next = event(host, "test-room:state");
    assert.equal((await request(host, "test-room:create")).ok, true);
    const room = await next;
    assert.match(room.roomId, /^\d{4}$/);
    next = event(host, "test-room:state");
    await request(host, "test-room:create");
    assert.equal((await next).roomId, room.roomId);
    assert.equal((await request(guest, "test-room:join", "bad")).ok, false);
    assert.equal((await request(guest, "test-room:join", room.roomId)).ok, true);
    assert.equal((await request(outsider, "test-room:join", room.roomId)).ok, false);
    assert.equal((await request(outsider, "test-room:ready", true)).ok, false);
    assert.equal((await request(host, "test-room:ready", "true")).ok, false);
    assert.equal((await request(host, "test-room:ready", true)).ok, false);
    const recipe = { name: "test", leaderCardId: "leader", leaderLifeCount: 5, mainDeck: Array(50).fill("character"), donDeck: Array(10).fill("don"), cardTypes: { character: "character" } };
    assert.equal((await request(host, "test-room:deck", recipe)).ok, true);
    assert.equal((await request(guest, "test-room:deck", recipe)).ok, true);
    await request(host, "test-room:ready", true);
    next = event(host, "test-room:state");
    await request(guest, "test-room:ready", true);
    const ready = await next;
    assert.equal(ready.host.ready && ready.guest.ready, true);
    next = event(host, "test-room:state");
    await request(guest, "test-room:leave");
    const left = await next;
    assert.equal(left.guest, null);
    assert.equal(left.host.ready, false);
    await request(guest, "test-room:join", room.roomId);
    next = event(guest, "test-room:closed");
    await request(host, "test-room:leave");
    assert.equal(await next, "ホストがルームを解散しました");
    assert.equal((await request(outsider, "test-room:join", room.roomId)).ok, false);
    next = event(host, "test-room:state");
    await request(host, "test-room:create");
    const second = await next;
    await request(guest, "test-room:join", second.roomId);
    next = event(host, "test-room:state");
    guest.disconnect();
    assert.equal((await next).guest, null);
    host.disconnect();
    // Acknowledgement ordering on the server guarantees cleanup before the next lookup.
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal((await request(outsider, "test-room:join", second.roomId)).ok, false);
    const health = await (await fetch(url)).json();
    assert.equal(health.service, "tcg-test");
  } finally {
    clients.forEach((socket) => socket.disconnect());
    await new Promise((resolve) => service.io.close(resolve));
  }
});
