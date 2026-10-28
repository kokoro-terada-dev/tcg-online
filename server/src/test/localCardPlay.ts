import type { CardObjectRef } from "./effects/types";
import type { MovementState, Player } from "./movement/types";
import type { Progression } from "./progression/types";
import { MovementStore } from "./movement/engine";
import { ensureMove, getCard, location } from "./movement/state";
import { checkTiming } from "./progression/state";

// Free placement for local fixtures only; not a legal card-play/cost processor.
export function playLocalHandCard(board: MovementState, progression: Progression, actor: Player, source: Readonly<CardObjectRef>, transactionId: string): MovementState {
  ensureMove(process.env.NODE_ENV !== "production" && board.turnNumber === progression.turnNumber &&
    checkTiming(progression, actor, "playCard").allowed && board.players.every(zones => zones.deck.length > 0), "local-play-unavailable");
  const card = getCard(board, source), from = location(board, card.instanceId);
  ensureMove(from.player === actor && from.zone === "hand" && card.owner === actor && card.controller === actor && card.faceUp, "local-play-own-hand-required");
  ensureMove(card.kind === "character" || card.kind === "stage", "local-play-kind-unsupported");
  const slotIndex = board.players[actor][card.kind].indexOf(null);
  ensureMove(slotIndex >= 0, "local-play-no-empty-slot");
  return new MovementStore(board).commit({ transactionId, matchId: board.matchId, expectedRevision: board.revision, turnNumber: board.turnNumber,
    actor, effectController: null, source: null, mode: "rule", resolutionId: null,
    operations: [{ kind: "move", card: source, from, to: { player: actor, zone: card.kind, position: "slot", slotIndex, faceUp: true, rotated: false }, cause: "RULE_PROCESSING" }] }, { status: "certifiedNone" }).state;
}
