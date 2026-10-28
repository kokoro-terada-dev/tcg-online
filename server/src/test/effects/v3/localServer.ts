import express = require("express");
import { createServer } from "node:http";
import { randomBytes, randomInt, randomUUID, createHash } from "node:crypto";
import { Server } from "socket.io";
import { createMatch, parseDeck } from "../../game";
import type { DeckInput } from "../../protocol";
import { MatchMovementCapture } from "../matchMovement";
import { createProgression } from "../../progression/state";
import { applySystemEvent } from "../../progression/transitions";
import { dataArray, dataObject, ensureMove } from "../../movement/state";
import { compileV3CardJson, label } from "./compiler";
import { ApprovedV3Catalog } from "./approval";
import { V3FixtureCoordinator } from "./fixtureCoordinator";
import type { V3FixtureView, V3RoomView, V3Scenario } from "./fixtureProtocol";

type Seat = { socketId: string; ready: boolean; deck: DeckInput | null };
type Session = { coordinator: V3FixtureCoordinator; matchId: string; actor: 0 | 1; scenario: V3Scenario; imageAliases: Record<string, string> };
type Room = { code: string; host: Seat; guest: Seat | null; session: Session | null };
type Reply = (value: { ok: boolean; error?: string; view?: V3FixtureView }) => void;

function fixture(room: Room, scenario: V3Scenario, actor: 0 | 1, signingKey: Uint8Array): Session {
  ensureMove(room.host.deck && room.guest?.deck, "v3-decks-required");
  const match = createMatch(room.host.deck, room.guest.deck), imageAliases: Record<string, string> = {};
  for (const seat of [0, 1] as const) {
    const zones = match.players[seat].zones, leader = zones.leader[0]!;
    const syntheticId = `V3-FIXTURE-LEADER-${seat}`; imageAliases[syntheticId] = leader.cardId; leader.cardId = syntheticId;
    // Seed public cards explicitly; this is not an actual match setup or card effect.
    for (let slot = 0; slot < 2; slot++) {
      const zone = (["deck", "hand", "life"] as const).find(zone => zones[zone].some(card => card?.kind === "character")); ensureMove(zone, "v3-two-characters-required");
      const index = zones[zone].findIndex(card => card?.kind === "character"), card = zones[zone].splice(index, 1)[0]!;
      if (zone !== "deck") zones[zone].splice(index, 0, { ...zones.deck.shift()!, faceUp: zone === "hand", rotated: false });
      zones.character[slot] = { ...card, faceUp: true, rotated: scenario === "active" && seat === actor };
    }
    for (let i = 0; i < 2; i++) zones.activeDon.push({ ...zones.donDeck.shift()!, faceUp: true, rotated: false });
  }
  const cardId = `V3-FIXTURE-LEADER-${actor}`, always = () => ({ type: "all", conditions: [] });
  const side = scenario === "ko" || scenario === "rest" ? "OPPONENT" : "SELF";
  const privateHand = scenario === "discardDraw";
  const fieldAction = { ko: "KO", rest: "REST", active: "SET_ACTIVE" } as const;
  const actions = scenario === "payDraw" ? [{ type: "DRAW", player: "SELF", count: 1 }] : [
    { type: "SELECT", bindAs: "picked", selector: { type: "CARDS", owner: side, controller: side, zone: privateHand ? "hand" : "character", cardTypes: privateHand ? ["character", "stage", "event"] : ["character"],
      filters: scenario === "rest" || scenario === "active" ? { type: "compare", left: { ref: "CANDIDATE.rotated" }, op: "eq", right: scenario === "active" } : always(),
      excludeSource: !privateHand, faceUpOnly: !privateHand, min: privateHand ? 1 : 0, max: 1, visibility: privateHand ? "OWNER_ONLY" : "PUBLIC", selectionMode: "SELECT", chooser: "SELF", order: "UNORDERED", onInsufficient: "fail" } },
    scenario === "bounce" || privateHand ? { type: "MOVE_CARD", cards: { ref: "bindings.picked" }, destination: { owner: "SELF", zone: privateHand ? "trash" : "hand", position: "append", faceUp: true }, cause: "EFFECT" } :
      { type: fieldAction[scenario], cards: { ref: "bindings.picked" } },
    ...(privateHand ? [{ type: "DRAW", player: "SELF", count: 1 }] : []),
  ];
  const plan = compileV3CardJson(JSON.stringify({ schemaVersion: "3.0.0-subset.4", cardId, cardVersion: `synthetic.${scenario}.1`, name: "V3 synthetic fixture leader", cardType: "leader",
    baseStats: { cost: null, power: null, counter: null, life: null }, colors: [], traits: [], attributes: [], reviewStatus: "approved",
    source: { text: `Synthetic test only: ${scenario}. Not an official card ability or ruling.`, triggerText: "", displayIds: [cardId], datasetSha256: createHash("sha256").update("v3-synthetic-ui.1").digest("hex") },
    effects: [{ id: "main", kind: "activated", timing: { type: "MAIN" }, sourceZones: ["leader"], optional: false, activationConditions: always(), resolutionConditions: always(), costs: scenario === "payDraw" ? [{ type: "REST_DON", count: 1 }] : [], actions }] }));
  const rulesetVersion = "synthetic-ui.1", card = new ApprovedV3Catalog([plan], [{ status: "approved", cardId, cardVersion: plan.definition.cardVersion, definitionHash: plan.definitionHash, sourceHash: plan.sourceHash,
    compilerVersion: plan.compilerVersion, registryHash: plan.registryHash, rulesetVersion, reviewer: "synthetic-fixture-code", approvedAt: "2026-10-28T00:00:00.000Z", ruleEvidence: ["synthetic-ui-fixture:not-official-card-rulings"] }], rulesetVersion).get(cardId)!;
  let progression = createProgression(actor);
  while (true) { progression = applySystemEvent(progression, progression.revision, { kind: "settlePhase", phaseToken: progression.phaseToken }); if (progression.phase === "main") break;
    progression = applySystemEvent(progression, progression.revision, { kind: "advancePhase", phaseToken: progression.phaseToken }); }
  const movement = new MatchMovementCapture(match, 1).snapshot().movement;
  const coordinator = new V3FixtureCoordinator({ mode: "syntheticNoAbilities", card, identity: { matchId: match.id, resolutionId: randomUUID(), effectId: "main", actor,
    source: { instanceId: match.players[actor].zones.leader[0]!.id, generation: 0 } }, movement, progression, signingKey, master: null });
  return { coordinator, matchId: match.id, actor, scenario, imageAliases };
}

export async function startLocalV3Server(port = 0) {
  ensureMove(process.env.NODE_ENV !== "production" && Number.isInteger(port) && port >= 0 && port <= 65535, "v3-local-server-disabled-or-invalid-port");
  const app = express(), http = createServer(app), key = randomBytes(32);
  const originAllowed = (origin?: string) => {
    let allowed = !origin; try { if (origin) { const url = new URL(origin); allowed = ["http:", "https:"].includes(url.protocol) && ["localhost", "127.0.0.1"].includes(url.hostname); } } catch { allowed = false; }
    return allowed;
  };
  const io = new Server(http, { maxHttpBufferSize: 32768, allowRequest: (request, callback) => callback(null, originAllowed(request.headers.origin)),
    cors: { origin: (origin, callback) => callback(null, originAllowed(origin)) } });
  const rooms = new Map<string, Room>(), membership = new Map<string, string>();
  app.get("/health", (_req, res) => res.json({ status: "ok", mode: "v3-local-synthetic-only" }));
  const roomFor = (id: string) => rooms.get(membership.get(id) ?? "");
  const actorFor = (room: Room, id: string): 0 | 1 | null => room.host.socketId === id ? 0 : room.guest?.socketId === id ? 1 : null;
  function publish(room: Room) {
    const seat = (s: Seat) => ({ socketId: s.socketId, ready: s.ready, deckName: s.deck?.name ?? null });
    const view: V3RoomView = { roomId: room.code, matchId: room.session?.matchId ?? null, host: seat(room.host), guest: room.guest ? seat(room.guest) : null };
    for (const id of [room.host.socketId, room.guest?.socketId]) if (id) io.sockets.sockets.get(id)?.emit("v3-room:state", view);
  }
  function view(room: Room, actor: 0 | 1): V3FixtureView {
    const session = room.session!;
    return { ...session.coordinator.viewFor(actor), matchId: session.matchId, roomId: room.code, localPlayerIndex: actor, actor: session.actor, scenario: session.scenario,
      imageAliases: session.imageAliases, workType: session.coordinator.pendingWorkKind() };
  }
  function publishGame(room: Room) { if (room.session && room.guest) for (const actor of [0, 1] as const) io.sockets.sockets.get(actor === 0 ? room.host.socketId : room.guest.socketId)?.emit("v3:state", view(room, actor)); }
  function leave(id: string) {
    const room = roomFor(id); membership.delete(id); if (!room) return;
    if (room.host.socketId === id) {
      if (room.guest) { membership.delete(room.guest.socketId); io.sockets.sockets.get(room.guest.socketId)?.emit("v3-room:closed", "ホストがルームを解散しました"); }
      rooms.delete(room.code);
    } else { room.guest = null; room.session = null; room.host.ready = false; publish(room); }
  }
  io.on("connection", socket => {
    let start = Date.now(), requests = 0;
    const handle = (event: string, callback: (input: unknown) => { view?: V3FixtureView } | void) => socket.on(event, (input: unknown, reply?: Reply) => {
      if (typeof reply !== "function") return;
      try {
        ensureMove(process.env.NODE_ENV !== "production", "v3-local-disabled");
        if (Date.now() - start >= 10000) { start = Date.now(); requests = 0; } ensureMove(++requests <= 60, "v3-rate-limit");
        const result = callback(input); reply({ ok: true, ...result });
      } catch { const room = roomFor(socket.id), actor = room ? actorFor(room, socket.id) : null;
        reply({ ok: false, error: "操作できません。接続・準備状態・対象・最新の状態を確認してください。", ...(room?.session && actor !== null ? { view: view(room, actor) } : {}) }); }
    });
    handle("v3-room:create", () => {
      const current = roomFor(socket.id); if (current) { publish(current); return; } ensureMove(rooms.size < 100, "v3-room-limit");
      let code: string; do { code = String(randomInt(10000)).padStart(4, "0"); } while (rooms.has(code));
      const room: Room = { code, host: { socketId: socket.id, ready: false, deck: null }, guest: null, session: null }; rooms.set(code, room); membership.set(socket.id, code); publish(room);
    });
    handle("v3-room:join", input => {
      ensureMove(typeof input === "string" && /^\d{4}$/.test(input), "v3-room-code"); const room = rooms.get(input); ensureMove(room && !room.session, "v3-room-unavailable");
      const current = roomFor(socket.id); if (current === room) { publish(room); return; }
      ensureMove(!current && !room.guest, "v3-already-in-room-or-full"); room.guest = { socketId: socket.id, ready: false, deck: null }; membership.set(socket.id, input); publish(room);
    });
    handle("v3-room:deck", input => {
      const room = roomFor(socket.id); ensureMove(room && !room.session, "v3-no-editable-room"); const actor = actorFor(room, socket.id); ensureMove(actor !== null, "v3-membership");
      const deck = parseDeck(input); ensureMove(deck, "v3-invalid-deck");
      const seat = actor === 0 ? room.host : room.guest!; seat.deck = deck; seat.ready = false; publish(room);
    });
    handle("v3-room:ready", input => { const room = roomFor(socket.id); ensureMove(room && !room.session && typeof input === "boolean", "v3-ready-state"); const actor = actorFor(room, socket.id); ensureMove(actor !== null, "v3-membership");
      const seat = actor === 0 ? room.host : room.guest!; ensureMove(seat.deck, "v3-deck-required"); seat.ready = input; publish(room); });
    handle("v3:start", input => {
      const room = roomFor(socket.id); ensureMove(room && room.host.socketId === socket.id && !room.session && room.guest && room.host.ready && room.guest.ready && io.sockets.sockets.get(room.guest.socketId)?.connected, "v3-cannot-start");
      dataObject(input, ["scenario", "actor"]); ensureMove((input.scenario === "bounce" || input.scenario === "payDraw" || input.scenario === "ko" || input.scenario === "rest" || input.scenario === "active" || input.scenario === "discardDraw") && (input.actor === 0 || input.actor === 1), "v3-fixture-options");
      room.session = fixture(room, input.scenario, input.actor, key); publish(room); publishGame(room);
    });
    const active = () => { const room = roomFor(socket.id), actor = room ? actorFor(room, socket.id) : null;
      ensureMove(room?.session && room.guest && actor !== null && membership.get(room.host.socketId) === room.code && membership.get(room.guest.socketId) === room.code &&
        io.sockets.sockets.get(room.host.socketId)?.connected && io.sockets.sockets.get(room.guest.socketId)?.connected, "v3-no-live-session"); return { room, actor, session: room.session }; };
    handle("v3:sync", () => { const { room, actor } = active(); return { view: view(room, actor) }; });
    handle("v3:command", input => {
      const { room, actor, session } = active(); ensureMove(input && typeof input === "object", "v3-command-object");
      const kind = Object.getOwnPropertyDescriptor(input, "kind")?.value; ensureMove(["advance", "work", "answer"].includes(kind), "v3-command-kind");
      dataObject(input, ["kind", "requestId", "matchId", "resolutionId", "frameRevision", "movementRevision", "progressionRevision", ...(kind === "answer" ? ["selectionId", "tokens"] : [])]);
      const requestId = label(input.requestId); ensureMove(input.matchId === session.matchId && input.resolutionId === session.coordinator.viewFor(actor).frame.resolutionId, "v3-command-context");
      const expected = { frameRevision: input.frameRevision as number, movementRevision: input.movementRevision as number, progressionRevision: input.progressionRevision as number };
      ensureMove(Object.values(expected).every(n => Number.isSafeInteger(n) && n >= 0), "v3-command-revisions");
      if (kind === "answer") { const selectionId = label(input.selectionId); dataArray(input.tokens, 50); input.tokens.forEach(token => label(token)); session.coordinator.answer(actor, requestId, expected, selectionId, input.tokens as string[]); }
      else if (kind === "work") session.coordinator.applyPendingWork(actor, requestId, expected);
      else session.coordinator.advance(actor, requestId, expected);
      publishGame(room); return { view: view(room, actor) };
    });
    handle("v3:end", () => { const { room, actor } = active(); ensureMove(actor === 0, "v3-host-only"); room.session = null; room.host.ready = false; room.guest!.ready = false; publish(room); });
    handle("v3-room:leave", () => { leave(socket.id); socket.emit("v3-room:closed", "退出しました"); });
    socket.on("disconnect", () => leave(socket.id));
  });
  try { await new Promise<void>((resolve, reject) => { http.once("error", reject); http.listen(port, "127.0.0.1", resolve); }); }
  catch (error) { await new Promise<void>(resolve => io.close(() => resolve())); throw error; }
  const address = http.address(); ensureMove(address && typeof address !== "string", "v3-listen-failed");
  return { io, http, url: `http://127.0.0.1:${address.port}` };
}
