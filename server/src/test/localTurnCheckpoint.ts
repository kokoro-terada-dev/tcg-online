import { applyPlayerIntent, applySystemEvent } from "./progression/transitions";
import type { Progression } from "./progression/types";
import { MovementStore } from "./movement/engine";
import { ensureMove } from "./movement/state";
import type { MovementState, Player } from "./movement/types";

// Fixture navigation only. These checkpoints do NOT execute normal turn-start rules.
export function nextLocalTurnCheckpoint(board: MovementState, progression: Progression, actor: Player, transactionId: string) {
  ensureMove(process.env.NODE_ENV !== "production" && board.turnNumber === progression.turnNumber, "local-turn-unavailable");
  let next = applyPlayerIntent(progression, progression.revision, actor, "endMain");
  for (let step = 0; step < 5; step++) {
    next = applySystemEvent(next, next.revision, { kind: "settlePhase", phaseToken: next.phaseToken });
    if (next.phase === "main") break;
    next = applySystemEvent(next, next.revision, { kind: "advancePhase", phaseToken: next.phaseToken });
  }
  ensureMove(next.phase === "main" && next.phaseSettled && next.turnNumber === board.turnNumber + 1 && next.activePlayer === 1 - actor, "invalid-local-turn-checkpoint");
  const movement = new MovementStore(board).commit({ transactionId, matchId: board.matchId, expectedRevision: board.revision,
    turnNumber: next.turnNumber, actor, effectController: null, source: null, mode: "rule", resolutionId: null, operations: [] }, { status: "certifiedNone" }).state;
  return { movement, progression: next };
}
