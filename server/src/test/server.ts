import express = require("express");
import { createServer } from "node:http";
import { randomInt } from "node:crypto";
import { Server } from "socket.io";

type Seat = { socketId: string; ready: boolean };
type Room = { roomId: string; host: Seat; guest: Seat | null };
type Reply = (result: { ok: boolean; error?: string }) => void;

export function createTestServer() {
  const app = express();
  const http = createServer(app);
  const origins = (process.env.ALLOWED_ORIGINS ?? "https://tcg-online-theta.vercel.app").split(",").map((s) => s.trim());
  const io = new Server(http, { cors: { origin: (origin, callback) => {
    let local = false;
    if (origin && process.env.NODE_ENV !== "production") {
      try {
        const url = new URL(origin);
        local = /^https?:$/.test(url.protocol) && /^(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(url.hostname);
      } catch { /* Invalid origins are rejected. */ }
    }
    callback(null, !origin || origins.includes(origin) || local);
  } } });
  const rooms = new Map<string, Room>();
  const memberships = new Map<string, string>();
  app.get("/", (_req, res) => res.json({ service: "tcg-test", status: "ok", protocolVersion: 1 }));
  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  const publish = (room: Room) => io.to(room.roomId).emit("test-room:state", room);
  function leave(socketId: string) {
    const roomId = memberships.get(socketId);
    const room = roomId ? rooms.get(roomId) : undefined;
    memberships.delete(socketId);
    if (!room) return;
    if (room.host.socketId === socketId) {
      io.to(room.roomId).emit("test-room:closed", "ホストがルームを解散しました");
      if (room.guest) memberships.delete(room.guest.socketId);
      io.in(room.roomId).socketsLeave(room.roomId);
      rooms.delete(room.roomId);
    } else {
      io.sockets.sockets.get(socketId)?.leave(room.roomId);
      room.guest = null;
      room.host.ready = false;
      publish(room);
    }
  }

  io.on("connection", (socket) => {
    socket.on("test-room:create", (reply?: Reply) => {
      if (typeof reply !== "function") return;
      const existing = rooms.get(memberships.get(socket.id) ?? "");
      if (existing) { publish(existing); reply({ ok: true }); return; }
      if (rooms.size >= 10000) { reply({ ok: false, error: "ルームが満員です" }); return; }
      let roomId: string;
      do { roomId = String(randomInt(10000)).padStart(4, "0"); } while (rooms.has(roomId));
      const room: Room = { roomId, host: { socketId: socket.id, ready: false }, guest: null };
      rooms.set(roomId, room);
      memberships.set(socket.id, roomId);
      socket.join(roomId);
      publish(room);
      reply({ ok: true });
    });
    socket.on("test-room:join", (code: unknown, reply?: Reply) => {
      if (typeof reply !== "function") return;
      if (typeof code !== "string" || !/^\d{4}$/.test(code)) { reply({ ok: false, error: "4桁のルームコードを入力してください" }); return; }
      const existing = memberships.get(socket.id);
      if (existing && existing !== code) { reply({ ok: false, error: "先に現在のルームから退出してください" }); return; }
      const room = rooms.get(code);
      if (!room || (room.guest && room.guest.socketId !== socket.id && room.host.socketId !== socket.id)) {
        reply({ ok: false, error: "ルームが見つからない、または満員です" }); return;
      }
      if (!existing) { room.guest = { socketId: socket.id, ready: false }; room.host.ready = false; }
      memberships.set(socket.id, code);
      socket.join(code);
      publish(room);
      reply({ ok: true });
    });
    socket.on("test-room:ready", (value: unknown, reply?: Reply) => {
      if (typeof reply !== "function") return;
      const room = rooms.get(memberships.get(socket.id) ?? "");
      if (!room || typeof value !== "boolean") { reply({ ok: false, error: "ルームに入室してください" }); return; }
      const seat = room.host.socketId === socket.id ? room.host : room.guest;
      if (!seat || seat.socketId !== socket.id) { reply({ ok: false, error: "操作できません" }); return; }
      seat.ready = value;
      publish(room);
      reply({ ok: true });
    });
    socket.on("test-room:leave", (reply?: Reply) => { leave(socket.id); if (typeof reply === "function") reply({ ok: true }); });
    socket.on("disconnect", () => leave(socket.id));
  });
  return { http, io };
}
