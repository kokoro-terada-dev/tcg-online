import { test } from "node:test";
import assert from "node:assert/strict";
import { networkInterfaces } from "node:os";
import { createServer } from "node:net";
import { request as httpRequest } from "node:http";
import { createRequire } from "node:module";
import { io } from "socket.io-client";
import { isPrivateV3Host, v3LanOptions } from "./v3-lan-options.js";
import { startV3LanVite } from "./v3-lan-vite.js";
const require = createRequire(import.meta.url);
const { startLocalV3Server } = require('../server/dist/test/effects/v3/localServer.js');

test('LAN startup is opt-in, private-interface-only, and requires an unambiguous host', () => {
  const interfaces = { wifi: [{ address: '192.168.10.2', family: 'IPv4', internal: false }] };
  assert.equal(v3LanOptions(['--v3'], interfaces), null);
  assert.deepEqual(v3LanOptions(['--v3', '--lan'], interfaces), { host: '192.168.10.2', port: 5191, origin: 'http://192.168.10.2:5191' });
  assert.throws(() => v3LanOptions(['--lan'], interfaces));
  assert.throws(() => v3LanOptions(['--v3', '--lan', '--lan-host=8.8.8.8'], interfaces));
  assert.throws(() => v3LanOptions(['--v3', '--lan', '--lan-port=0'], interfaces));
  assert.throws(() => v3LanOptions(['--v3', '--lan'], { ...interfaces, other: [{ address: '10.1.2.3', family: 'IPv4', internal: false }] }));
  for (const host of ['0.0.0.0', '127.0.0.1', 'example.com', '172.32.1.1', '192.168.1.999']) assert.equal(isPrivateV3Host(host), false);
});

test('LAN proxy carries both socket transports while rejecting foreign Origins and Hosts', async t => {
  const host = Object.values(networkInterfaces()).flatMap(rows => rows ?? []).find(row => !row.internal && row.family === 'IPv4' && isPrivateV3Host(row.address))?.address;
  if (!host) { t.skip('No local private IPv4 interface is available'); return; }
  const probe = createServer(); await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, host, resolve); });
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const origin = `http://${host}:${port}`, options = { lanOrigin: origin }, backend = await startLocalV3Server(0, options), clients = []; let vite;
  options.lanOrigin = 'https://foreign.invalid';
  t.after(async () => { clients.forEach(client => client.disconnect()); await vite?.close(); await new Promise(resolve => backend.io.close(resolve)); });
  assert.equal(backend.http.address().address, '127.0.0.1');
  vite = await startV3LanVite({ host, port, target: backend.url });
  for (const transport of ['polling', 'websocket']) {
    const client = io(origin, { path: '/v3-socket.io', transports: [transport], reconnection: false, autoConnect: false, extraHeaders: { Origin: origin } }); clients.push(client);
    await new Promise((resolve, reject) => { client.once('connect', resolve); client.once('connect_error', reject); client.connect(); });
  }
  const request = (client, event, input = null) => new Promise((resolve, reject) => client.timeout(3000).emit(event, input, (error, reply) => error ? reject(error) : resolve(reply)));
  const room = new Promise(resolve => clients[0].once('v3-room:state', resolve));
  assert.equal((await request(clients[0], 'v3-room:create')).ok, true);
  assert.equal((await request(clients[1], 'v3-room:join', (await room).roomId)).ok, true);
  const forbidden = io(origin, { path: '/v3-socket.io', transports: ['websocket'], reconnection: false, autoConnect: false, extraHeaders: { Origin: 'https://foreign.invalid' } }); clients.push(forbidden);
  await new Promise((resolve, reject) => { forbidden.once('connect_error', resolve); forbidden.once('connect', () => reject(Error('Foreign Origin accepted'))); forbidden.connect(); });
  const status = await new Promise((resolve, reject) => {
    const req = httpRequest(origin, { headers: { Host: 'foreign.invalid' } }, res => { res.resume(); resolve(res.statusCode); }); req.once('error', reject); req.end();
  }); assert.equal(status, 403);
  await assert.rejects(startLocalV3Server(0, { lanOrigin: 'https://foreign.invalid' }));
});
