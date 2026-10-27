import express = require("express");
import { createServer } from "node:http";
import { randomInt } from "node:crypto";
import { Server } from "socket.io";
import { applyCommand, createMatch, parseDeck, projectMatch } from "./game";
import type { Match } from "./game";
import type { DeckInput, RoomView } from "./protocol";

type Seat = { socketId: string; ready: boolean; recipe: DeckInput | null };
type Room = { roomId: string; host: Seat; guest: Seat | null; game: Match | null };
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

  function publish(room: Room) {
    const seat = (value: Seat) => ({ socketId: value.socketId, ready: value.ready, deck: value.recipe ? { name: value.recipe.name, leaderCardId: value.recipe.leaderCardId } : null });
    const view: RoomView = { roomId: room.roomId, host: seat(room.host), guest: room.guest ? seat(room.guest) : null, inMatch: Boolean(room.game) };
    io.to(room.roomId).emit("test-room:state", view);
  }
  function publishGame(room: Room) {
    if (!room.game || !room.guest) return;
    io.to(room.host.socketId).emit("test-match:state", projectMatch(room.game, 0));
    io.to(room.guest.socketId).emit("test-match:state", projectMatch(room.game, 1));
  }
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
      room.game = null;
      io.to(room.roomId).emit("test-match:ended", "ゲストが退出したためルームへ戻りました");
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
      const room: Room = { roomId, host: { socketId: socket.id, ready: false, recipe: null }, guest: null, game: null };
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
      if (!room || (room.game && !existing) || (room.guest && room.guest.socketId !== socket.id && room.host.socketId !== socket.id)) {
        reply({ ok: false, error: "ルームが見つからない、または満員です" }); return;
      }
      if (!existing) { room.guest = { socketId: socket.id, ready: false, recipe: null }; room.host.ready = false; }
      memberships.set(socket.id, code);
      socket.join(code);
      publish(room);
      reply({ ok: true });
    });
    socket.on("test-room:ready", (value: unknown, reply?: Reply) => {
      if (typeof reply !== "function") return;
      const room = rooms.get(memberships.get(socket.id) ?? "");
      if (!room || typeof value !== "boolean") { reply({ ok: false, error: "ルームに入室してください" }); return; }
      if (room.game) { reply({ ok: false, error: "対戦中は変更できません" }); return; }
      const seat = room.host.socketId === socket.id ? room.host : room.guest;
      if (!seat || seat.socketId !== socket.id) { reply({ ok: false, error: "操作できません" }); return; }
      if (value && !seat.recipe) { reply({ ok: false, error: "デッキを選択してください" }); return; }
      seat.ready = value;
      publish(room);
      reply({ ok: true });
    });
    socket.on("test-room:deck", (value: unknown, reply?: Reply) => {
      if (typeof reply !== "function") return;
      const room = rooms.get(memberships.get(socket.id) ?? "");
      const recipe = parseDeck(value);
      if (!room || room.game || !recipe) { reply({ ok: false, error: "デッキ形式が正しくないか、対戦中です" }); return; }
      const seat = room.host.socketId === socket.id ? room.host : room.guest;
      if (!seat || seat.socketId !== socket.id) { reply({ ok: false, error: "入室してください" }); return; }
      seat.recipe = recipe;
      room.host.ready = false;
      if (room.guest) room.guest.ready = false;
      publish(room); reply({ ok: true });
    });
    socket.on("test-match:start", (reply?: Reply) => {
      if (typeof reply !== "function") return;
      const room = rooms.get(memberships.get(socket.id) ?? "");
      if (!room || room.host.socketId !== socket.id || room.game || !room.host.ready || !room.guest?.ready || !room.host.recipe || !room.guest.recipe) {
        reply({ ok: false, error: "ホストのみ、両者のデッキ選択・READY後に開始できます" }); return;
      }
      room.game = createMatch(room.host.recipe, room.guest.recipe);
      publish(room); publishGame(room); reply({ ok: true });
    });
    socket.on("test-match:command", (value: unknown, reply?: Reply) => {
      if (typeof reply !== "function") return;
      const room = rooms.get(memberships.get(socket.id) ?? "");
      if (!room?.game) { reply({ ok: false, error: "対戦が開始されていません" }); return; }
      const actor = room.host.socketId === socket.id ? 0 : room.guest?.socketId === socket.id ? 1 : null;
      if (actor === null) { reply({ ok: false, error: "操作できません" }); return; }
      const error = applyCommand(room.game, actor, value);
      publishGame(room);
      reply(error ? { ok: false, error } : { ok: true });
    });
    socket.on("test-match:end", (reply?: Reply) => {
      if (typeof reply !== "function") return;
      const room = rooms.get(memberships.get(socket.id) ?? "");
      if (!room?.game) { reply({ ok: false, error: "対戦が開始されていません" }); return; }
      room.game = null; room.host.ready = false;
      if (room.guest) room.guest.ready = false;
      io.to(room.roomId).emit("test-match:ended", "対戦を終了してルームへ戻りました");
      publish(room); reply({ ok: true });
    });
    socket.on("test-room:leave", (reply?: Reply) => { leave(socket.id); if (typeof reply === "function") reply({ ok: true }); });
    socket.on("disconnect", () => leave(socket.id));
  });
  return { http, io };
}
