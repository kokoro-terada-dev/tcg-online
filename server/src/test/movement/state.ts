import type { CardObjectRef } from "../effects/types";
import type { Location, MovementCard, MovementState, MovementZone, Player, ZoneLists } from "./types";
export const MOVEMENT_ZONES = ["deck", "hand", "life", "character", "leader", "stage", "donDeck", "activeDon", "restDon", "trash", "public", "resolving", "attachedDon"] as const;
export const MOVEMENT_LIMITS = Object.freeze({ cards: 256, operations: 64, events: 512, transactions: 4096 });
export class MovementError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "MovementError"; }
}
export function ensureMove(condition: unknown, code: string): asserts condition { if (!condition) throw new MovementError(code); }
export function dataObject(value: unknown, required: readonly string[], optional: readonly string[] = []): asserts value is Record<string, unknown> {
  ensureMove(value && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null), "invalid-data-object");
  const ownKeys = Reflect.ownKeys(value);
  ensureMove(ownKeys.length <= required.length + optional.length, "unknown-data-field");
  for (const key of ownKeys) {
    ensureMove(typeof key === "string" && (required.includes(key) || optional.includes(key)), "unknown-data-field");
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    ensureMove(Object.hasOwn(descriptor, "value") && descriptor.enumerable, "data-accessors-not-allowed");
  }
  for (const key of required) ensureMove(Object.hasOwn(value, key), "missing-data-field");
}
export function dataArray(value: unknown, max: number): asserts value is unknown[] {
  ensureMove(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype && value.length <= max, "invalid-data-array");
  ensureMove(Reflect.ownKeys(value).length === value.length + 1, "invalid-array-fields");
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    ensureMove(descriptor && Object.hasOwn(descriptor, "value") && descriptor.enumerable, "sparse-or-accessor-array");
  }
}
export function player(value: unknown): asserts value is Player { ensureMove(value === 0 || value === 1, "invalid-movement-player"); }
export function id(value: unknown, max = 100): asserts value is string { ensureMove(typeof value === "string" && value.length <= max && /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(value) && !["constructor", "prototype"].includes(value), "invalid-movement-id"); }
export function reference(value: CardObjectRef): void { dataObject(value, ["instanceId", "generation"]); id(value.instanceId); ensureMove(Number.isSafeInteger(value.generation) && value.generation >= 0, "invalid-generation"); }
export function freezeMovement<T>(value: T): T { if (value && typeof value === "object") { Object.values(value).forEach(freezeMovement); Object.freeze(value); } return value; }
export function emptyZones(): Record<MovementZone, (string | null)[]> {
  return Object.fromEntries(MOVEMENT_ZONES.map(zone => [zone, zone === "character" ? Array(5).fill(null) : zone === "stage" || zone === "leader" ? [null] : []])) as Record<MovementZone, (string | null)[]>;
}
export function location(state: MovementState, instanceId: string): Location {
  for (const owner of [0, 1] as const) for (const zone of MOVEMENT_ZONES) if (state.players[owner][zone].includes(instanceId)) return { player: owner, zone };
  throw new MovementError("card-has-no-location");
}
export function getCard(state: MovementState, ref: CardObjectRef): MovementCard {
  reference(ref); const card = Object.hasOwn(state.cards, ref.instanceId) ? state.cards[ref.instanceId] : undefined;
  ensureMove(card && card.generation === ref.generation, "stale-or-missing-card-reference"); return card;
}
export function physicalArea(zone: MovementZone): string { return zone === "activeDon" || zone === "restDon" ? "donArea" : zone; }
function ids(values: readonly string[]): void { dataArray(values, 128); ensureMove(new Set(values).size === values.length, "invalid-runtime-reference-list"); values.forEach(value => id(value)); }

export function validateMovementState(state: MovementState): void {
  dataObject(state, ["version", "matchId", "revision", "turnNumber", "players", "cards", "reveals", "appliedTransactions"]);
  ensureMove(state && state.version === 1 && Number.isSafeInteger(state.revision) && state.revision >= 0 && Number.isSafeInteger(state.turnNumber) && state.turnNumber >= 1, "invalid-movement-state"); id(state.matchId);
  dataArray(state.players, 2);
  ensureMove(state.players.length === 2 && state.cards && typeof state.cards === "object" && !Array.isArray(state.cards) && (Object.getPrototypeOf(state.cards) === Object.prototype || Object.getPrototypeOf(state.cards) === null), "invalid-movement-state");
  ensureMove(Reflect.ownKeys(state.cards).length <= MOVEMENT_LIMITS.cards, "movement-card-limit");
  dataObject(state.cards, Object.keys(state.cards));
  const entries = Object.entries(state.cards); ensureMove(entries.length <= MOVEMENT_LIMITS.cards, "movement-card-limit");
  dataArray(state.appliedTransactions, MOVEMENT_LIMITS.transactions);
  ensureMove(new Set(state.appliedTransactions).size === state.appliedTransactions.length && state.revision === state.appliedTransactions.length, "invalid-transaction-ledger"); state.appliedTransactions.forEach(value => id(value, 80));
  const placed = new Map<string, Location>();
  for (const owner of [0, 1] as const) {
    const zones = state.players[owner];
    dataObject(zones, MOVEMENT_ZONES);
    for (const zone of MOVEMENT_ZONES) {
      const list = zones[zone]; dataArray(list, MOVEMENT_LIMITS.cards);
      if (zone === "character" || zone === "leader" || zone === "stage") ensureMove(list.length === (zone === "character" ? 5 : 1), "invalid-fixed-slots");
      for (const cardId of list) {
        if (cardId === null) { ensureMove(["character", "leader", "stage"].includes(zone), "null-in-list-zone"); continue; }
        id(cardId); ensureMove(Object.hasOwn(state.cards, cardId) && !placed.has(cardId), "duplicate-or-missing-card"); placed.set(cardId, { player: owner, zone });
      }
    }
  }
  ensureMove(placed.size === entries.length, "unplaced-card");
  for (const [key, card] of entries) {
    dataObject(card, ["instanceId", "generation", "cardId", "kind", "owner", "controller", "faceUp", "rotated", "attachedTo", "modifierIds", "grantIds", "enteredTurn"]);
    reference({ instanceId: card.instanceId, generation: card.generation }); id(card.cardId); ensureMove(key === card.instanceId, "card-key-mismatch"); player(card.owner); player(card.controller);
    ensureMove(["leader", "character", "stage", "event", "don", "unknown"].includes(card.kind) && typeof card.faceUp === "boolean" && typeof card.rotated === "boolean", "invalid-card-state");
    ids(card.modifierIds); ids(card.grantIds); ensureMove(card.enteredTurn === null || (Number.isSafeInteger(card.enteredTurn) && card.enteredTurn >= 1 && card.enteredTurn <= state.turnNumber), "invalid-entered-turn");
    const at = placed.get(key)!;
    if (at.zone !== "character") ensureMove(card.enteredTurn === null, "entered-turn-outside-character-area");
    if (["character", "leader", "stage"].includes(at.zone)) ensureMove(card.kind === at.zone && card.controller === at.player && card.faceUp, "invalid-field-card");
    else ensureMove(card.owner === at.player && card.controller === card.owner, "invalid-off-field-owner");
    if (card.kind === "leader") ensureMove(at.zone === "leader", "leader-outside-leader-zone");
    if (card.kind === "don") ensureMove(["donDeck", "activeDon", "restDon", "attachedDon"].includes(at.zone), "don-outside-don-zone");
    else ensureMove(!["donDeck", "activeDon", "restDon", "attachedDon"].includes(at.zone), "main-card-in-don-zone");
    if (at.zone === "activeDon") ensureMove(!card.rotated && card.faceUp, "invalid-active-don");
    if (at.zone === "restDon") ensureMove(card.rotated && card.faceUp, "invalid-rest-don");
    if (at.zone === "attachedDon") {
      ensureMove(card.attachedTo && !card.rotated && card.faceUp, "invalid-attached-don");
      const parent = getCard(state, card.attachedTo), parentAt = placed.get(parent.instanceId)!;
      ensureMove(["leader", "character"].includes(parentAt.zone) && parentAt.player === at.player && parent.owner === card.owner, "invalid-don-parent");
    } else ensureMove(card.attachedTo === null, "attachment-outside-attached-zone");
  }
  dataArray(state.reveals, 256);
  const reveals = new Set<string>();
  for (const grant of state.reveals) {
    dataObject(grant, ["scopeId", "card", "viewers"]); id(grant.scopeId); getCard(state, grant.card); dataArray(grant.viewers, 2);
    ensureMove(grant.viewers.length > 0 && new Set(grant.viewers).size === grant.viewers.length, "invalid-reveal-viewers"); grant.viewers.forEach(player);
    const key = JSON.stringify([grant.scopeId, grant.card.instanceId]); ensureMove(!reveals.has(key), "duplicate-reveal-grant"); reveals.add(key);
  }
}

export function createMovementState(input: { matchId: string; turnNumber: number; players: readonly [ZoneLists, ZoneLists]; cards: Readonly<Record<string, MovementCard>> }): MovementState {
  dataObject(input, ["matchId", "turnNumber", "players", "cards"]);
  const state: MovementState = { ...input, version: 1, revision: 0, reveals: [], appliedTransactions: [] };
  validateMovementState(state); return freezeMovement(structuredClone(state));
}
