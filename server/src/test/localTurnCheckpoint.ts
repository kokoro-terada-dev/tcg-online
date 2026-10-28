import { applyPlayerIntent, applySystemEvent } from "./progression/transitions";
import type { Progression } from "./progression/types";
import { MovementStore } from "./movement/engine";
import { ensureMove } from "./movement/state";
import type { MovementOperation, MovementState, Player } from "./movement/types";

// Local fixture only: basic turn-start operations, without triggers or duration adjudication.
function startLocalTurn(board: MovementState, progression: Progression, transactionId: string): MovementState {
  ensureMove(process.env.NODE_ENV !== "production" && progression.phase === "main" && progression.phaseSettled &&
    progression.gate.kind === "idle" && !progression.battle && !progression.outcome, "local-turn-start-unavailable");
  ensureMove(!board.reveals.length && board.players.every(zones => !zones.resolving.length) &&
    Object.values(board.cards).every(card => !card.modifierIds.length && !card.grantIds.length), "local-turn-transient-state-unsupported");
  const actor = progression.activePlayer, zones = board.players[actor], operations: MovementOperation[] = [];
  const move = (instanceId: string, from: "attachedDon" | "deck" | "donDeck", to: "activeDon" | "hand") => {
    const card = board.cards[instanceId]!;
    operations.push({ kind: "move", card: { instanceId, generation: card.generation }, from: { player: actor, zone: from },
      to: { player: actor, zone: to, position: "append", faceUp: true, rotated: false }, cause: "RULE_PROCESSING" });
  };
  for (const id of zones.attachedDon) move(id!, "attachedDon", "activeDon");
  for (const zone of ["leader", "character", "stage", "restDon"] as const) for (const id of zones[zone]) {
    if (id && board.cards[id]!.rotated) operations.push({ kind: "setRest", card: { instanceId: id, generation: board.cards[id]!.generation }, rotated: false });
  }
  if (progression.turnNumber > 1) {
    // Do not silently skip an unavailable draw or invent a deck-out ruling here.
    ensureMove(zones.deck.length > 1, "local-turn-deck-outcome-unsupported");
    move(zones.deck[0]!, "deck", "hand");
  }
  for (const id of zones.donDeck.slice(0, progression.turnNumber === 1 ? 1 : 2)) move(id!, "donDeck", "activeDon");
  return new MovementStore(board).commit({ transactionId, matchId: board.matchId, expectedRevision: board.revision,
    turnNumber: progression.turnNumber, actor, effectController: null, source: null, mode: "rule", resolutionId: null, operations }, { status: "certifiedNone" }).state;
}

export function openingLocalTurnCheckpoint(board: MovementState, progression: Progression, transactionId: string): MovementState {
  ensureMove(board.revision === 0 && board.turnNumber === 1 && progression.turnNumber === 1 &&
    progression.activePlayer === progression.firstPlayer, "local-opening-already-started-or-invalid");
  return startLocalTurn(board, progression, transactionId);
}

export function nextLocalTurnCheckpoint(board: MovementState, progression: Progression, actor: Player, transactionId: string) {
  ensureMove(process.env.NODE_ENV !== "production" && board.turnNumber === progression.turnNumber, "local-turn-unavailable");
  let next = applyPlayerIntent(progression, progression.revision, actor, "endMain");
  for (let step = 0; step < 5; step++) {
    next = applySystemEvent(next, next.revision, { kind: "settlePhase", phaseToken: next.phaseToken });
    if (next.phase === "main") break;
    next = applySystemEvent(next, next.revision, { kind: "advancePhase", phaseToken: next.phaseToken });
  }
  ensureMove(next.phase === "main" && next.phaseSettled && next.turnNumber === board.turnNumber + 1 && next.activePlayer === 1 - actor, "invalid-local-turn-checkpoint");
  const movement = startLocalTurn(board, next, transactionId);
  return { movement, progression: next };
}
