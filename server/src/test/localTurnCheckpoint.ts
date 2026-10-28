import { applyPlayerIntent, applySystemEvent } from "./progression/transitions";
import type { Progression } from "./progression/types";
import { MovementStore } from "./movement/engine";
import { ensureMove } from "./movement/state";
import type { MovementOperation, MovementState, Player } from "./movement/types";

export function localDeckOutProgression(board: MovementState, progression: Progression): Progression {
  ensureMove(process.env.NODE_ENV !== "production" && board.turnNumber === progression.turnNumber, "local-outcome-unavailable");
  if (progression.outcome) return progression;
  const defeated = ([0, 1] as const).filter(player => board.players[player].deck.length === 0);
  if (!defeated.length) return progression;
  return applySystemEvent(progression, progression.revision, { kind: "finishGame",
    winner: defeated.length === 1 ? (1 - defeated[0]!) as Player : null, reason: "local-deck-out" });
}

// Local fixture only: basic turn-start operations, without triggers or duration adjudication.
function startLocalTurn(board: MovementState, progression: Progression, transactionId: string) {
  const actor = progression.activePlayer, zones = board.players[actor];
  const endsOnDraw = progression.turnNumber > 1 && zones.deck.length === 1;
  ensureMove(process.env.NODE_ENV !== "production" && ((progression.phase === "main" && progression.phaseSettled) ||
    (progression.phase === "draw" && !progression.phaseSettled && endsOnDraw)) &&
    progression.gate.kind === "idle" && !progression.battle && !progression.outcome, "local-turn-start-unavailable");
  ensureMove(!board.reveals.length && board.players.every(zones => !zones.resolving.length) &&
    Object.values(board.cards).every(card => !card.modifierIds.length && !card.grantIds.length), "local-turn-transient-state-unsupported");
  const operations: MovementOperation[] = [];
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
    ensureMove(zones.deck.length > 0, "local-turn-empty-deck");
    move(zones.deck[0]!, "deck", "hand");
  }
  if (!endsOnDraw) for (const id of zones.donDeck.slice(0, progression.turnNumber === 1 ? 1 : 2)) move(id!, "donDeck", "activeDon");
  const movement = new MovementStore(board).commit({ transactionId, matchId: board.matchId, expectedRevision: board.revision,
    turnNumber: progression.turnNumber, actor, effectController: null, source: null, mode: "rule", resolutionId: null, operations }, { status: "certifiedNone" }).state;
  return { movement, progression: localDeckOutProgression(movement, progression) };
}

export function openingLocalTurnCheckpoint(board: MovementState, progression: Progression, transactionId: string): MovementState {
  ensureMove(board.revision === 0 && board.turnNumber === 1 && progression.turnNumber === 1 &&
    progression.activePlayer === progression.firstPlayer && board.players.every(zones => zones.deck.length > 0), "local-opening-already-started-or-invalid");
  return startLocalTurn(board, progression, transactionId).movement;
}

export function nextLocalTurnCheckpoint(board: MovementState, progression: Progression, actor: Player, transactionId: string) {
  ensureMove(process.env.NODE_ENV !== "production" && board.turnNumber === progression.turnNumber, "local-turn-unavailable");
  let next = applyPlayerIntent(progression, progression.revision, actor, "endMain");
  const ended = localDeckOutProgression(board, progression);
  if (ended !== progression) return { movement: board, progression: ended };
  for (let step = 0; step < 5; step++) {
    if (next.phase === "draw" && board.players[next.activePlayer].deck.length === 1) return startLocalTurn(board, next, transactionId);
    next = applySystemEvent(next, next.revision, { kind: "settlePhase", phaseToken: next.phaseToken });
    if (next.phase === "main") break;
    next = applySystemEvent(next, next.revision, { kind: "advancePhase", phaseToken: next.phaseToken });
  }
  ensureMove(next.phase === "main" && next.phaseSettled && next.turnNumber === board.turnNumber + 1 && next.activePlayer === 1 - actor, "invalid-local-turn-checkpoint");
  return startLocalTurn(board, next, transactionId);
}
