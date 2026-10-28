import { isDeepStrictEqual } from "node:util";
import type { Match } from "../game";
import type { Zone } from "../protocol";
import { createMovementState, dataArray, dataObject, emptyZones, ensureMove, freezeMovement, id } from "../movement/state";
import type { MovementCard, MovementState } from "../movement/types";

const ZONES: readonly Zone[] = ["hand", "deck", "life", "trash", "public", "character", "stage", "leader", "donDeck", "activeDon", "restDon"];
type LegacyCard = NonNullable<Match["players"][number]["zones"][Zone][number]>;
type Frame = Readonly<{ id: string; revision: number; players: Match["players"]; attack: Match["attack"]; processed: readonly (readonly [string, number])[] }>;

function capture(match: Match): Frame {
  dataObject(match, ["id", "revision", "players", "attack", "master", "processed"]);
  id(match.id); ensureMove(Number.isSafeInteger(match.revision) && match.revision >= 0, "invalid-legacy-match-revision");
  dataArray(match.players, 2); ensureMove(match.players.length === 2, "invalid-legacy-match-players");
  let count = 0;
  const players = match.players.map(player => {
    dataObject(player, ["zones"]); dataObject(player.zones, ZONES);
    const zones = {} as Record<Zone, (LegacyCard | null)[]>;
    for (const zone of ZONES) {
      const source = player.zones[zone]; dataArray(source, 256);
      zones[zone] = source.map(card => {
        if (card === null) return null;
        ensureMove(++count <= 256, "legacy-match-card-limit");
        dataObject(card, ["id", "cardId", "kind", "rotated", "faceUp"]); id(card.id); id(card.cardId);
        ensureMove(["leader", "character", "stage", "event", "don"].includes(card.kind) && typeof card.rotated === "boolean" && typeof card.faceUp === "boolean", "invalid-legacy-card");
        return { id: card.id, cardId: card.cardId, kind: card.kind, rotated: card.rotated, faceUp: card.faceUp };
      });
    }
    return { zones };
  }) as Match["players"];
  let attack: Match["attack"] = null;
  if (match.attack !== null) {
    dataObject(match.attack, ["actor", "sourceId", "targetId"]);
    ensureMove(match.attack.actor === 0 || match.attack.actor === 1, "invalid-legacy-attack"); id(match.attack.sourceId); id(match.attack.targetId);
    attack = { ...match.attack };
  }
  ensureMove(match.processed instanceof Map && Object.getPrototypeOf(match.processed) === Map.prototype && match.processed.size <= 4096, "invalid-legacy-replay-ledger");
  const processed = [...match.processed.entries()].map(([key, revision]) => {
    ensureMove(typeof key === "string" && key.length <= 202 && Number.isSafeInteger(revision) && revision >= 0, "invalid-legacy-replay-entry");
    return [key, revision] as const;
  });
  ensureMove(match.master === null || (Object.isFrozen(match.master) && Object.isFrozen(match.master.cards)), "legacy-master-must-be-pinned");
  return freezeMovement({ id: match.id, revision: match.revision, players, attack, processed });
}

// Read-only migration boundary. It detects conflicting legacy writes; it is not itself a mutex.
export class MatchMovementCapture {
  #match: Match;
  #frame: Frame;
  #master: Match["master"];
  #masterVersion: string | null;
  #movement: MovementState;
  constructor(match: Match, turnNumber: number) {
    const frame = capture(match);
    ensureMove(frame.attack === null, "legacy-attack-needs-progression-adapter");
    const players = [emptyZones(), emptyZones()] as const, cards: Record<string, MovementCard> = Object.create(null);
    for (const actor of [0, 1] as const) for (const zone of ZONES) {
      players[actor][zone] = frame.players[actor].zones[zone].map(card => {
        if (card === null) return null;
        ensureMove(!Object.hasOwn(cards, card.id), "duplicate-legacy-card-instance");
        cards[card.id] = { instanceId: card.id, generation: 0, cardId: card.cardId, kind: card.kind, owner: actor, controller: actor,
          faceUp: zone === "donDeck" ? false : card.faceUp, rotated: card.rotated, attachedTo: null,
          modifierIds: [], grantIds: [], enteredTurn: null };
        return card.id;
      });
    }
    this.#movement = createMovementState({ matchId: frame.id, turnNumber, players, cards });
    this.#match = match; this.#frame = frame; this.#master = match.master; this.#masterVersion = match.master?.version ?? null;
  }
  snapshot(): Readonly<{ movement: MovementState; legacyRevision: number; masterVersion: string | null }> {
    return Object.freeze({ movement: this.#movement, legacyRevision: this.#frame.revision, masterVersion: this.#masterVersion });
  }
  assertCurrent(match: Match): void {
    ensureMove(match === this.#match, "legacy-match-instance-replaced");
    const current = capture(match);
    ensureMove(isDeepStrictEqual(current, this.#frame) && match.master === this.#master && (match.master?.version ?? null) === this.#masterVersion, "legacy-match-changed-during-capture");
  }
  toJSON(): never { throw new Error("server-only-match-movement-capture"); }
}
