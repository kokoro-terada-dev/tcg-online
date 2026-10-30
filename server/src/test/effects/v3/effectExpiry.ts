import { dataObject, ensureMove, freezeMovement, id } from "../../movement/state";
import type { DeepReadonly } from "../types";
import type { Node } from "./dsl";
import type { MovementState } from "../../movement/types";
import type { Progression } from "../../progression/types";

export type ExpiryAnchor = Readonly<{ matchId: string; turnNumber: number; activePlayer: 0 | 1; phase: "main" | "end"; phaseToken: string; movementRevision: number; turnOrder: "ALTERNATING" }>;
type BoundaryExpiry = Readonly<{ kind: "TURN_START" | "END_PHASE_END"; player: 0 | 1; turnNumber: number; occurrence: 1 | 2; includeCurrent: boolean; anchor: ExpiryAnchor }>;
export type ExpiryCheckpoint = Readonly<{ kind: BoundaryExpiry["kind"]; matchId: string; turnNumber: number; activePlayer: 0 | 1; phaseToken: string; movementRevision: number }>;
export const hasBoundaryDurations = (cards: readonly Readonly<{ requiredHandlers: readonly string[] }>[]): boolean => cards.some(card => card.requiredHandlers.includes("duration:UNTIL_BOUNDARY"));
const checkpoints = new WeakSet<object>();
function ordinaryTurn(progression: Progression): void {
  ensureMove((progression.firstPlayer === 0 || progression.firstPlayer === 1) && Number.isSafeInteger(progression.turnNumber) && progression.turnNumber >= 1 &&
    progression.activePlayer === (progression.turnNumber % 2 === 1 ? progression.firstPlayer : 1 - progression.firstPlayer), "v3-expiry-turn-order-unmodeled");
}
export function applicationAnchor(board: MovementState, progression: Progression): ExpiryAnchor {
  ordinaryTurn(progression);
  ensureMove(board.turnNumber === progression.turnNumber && !progression.outcome && (progression.phase === "main" || progression.phase === "end"), "v3-expiry-anchor-unknown");
  return freezeMovement({ matchId: board.matchId, turnNumber: board.turnNumber, activePlayer: progression.activePlayer, phase: progression.phase,
    phaseToken: progression.phaseToken, movementRevision: board.revision, turnOrder: "ALTERNATING" });
}
export type EffectExpiry = Readonly<{ endPlayer: 0 | 1; remaining: 1 | 2; battleId?: never; boundary?: never } |
  { endPlayer: null; remaining: null; battleId: string; boundary?: never } | { endPlayer: null; remaining: null; battleId?: never; boundary: BoundaryExpiry }>;
function targetTurn(kind: BoundaryExpiry["kind"], player: 0 | 1, occurrence: 1 | 2, includeCurrent: boolean, anchor: ExpiryAnchor): number {
  dataObject(anchor, ["matchId", "turnNumber", "activePlayer", "phase", "phaseToken", "movementRevision", "turnOrder"]); id(anchor.matchId); id(anchor.phaseToken);
  ensureMove(anchor.turnOrder === "ALTERNATING" && (anchor.phase === "main" || anchor.phase === "end") &&
    Number.isSafeInteger(anchor.turnNumber) && anchor.turnNumber >= 1 && (anchor.activePlayer === 0 || anchor.activePlayer === 1) &&
    Number.isSafeInteger(anchor.movementRevision) && anchor.movementRevision >= 0, "v3-expiry-anchor-unknown");
  const offset = player !== anchor.activePlayer ? 1 : kind === "END_PHASE_END" && includeCurrent ? 0 : 2;
  const result = anchor.turnNumber + offset + (occurrence - 1) * 2;
  ensureMove(Number.isSafeInteger(result), "v3-expiry-turn-overflow"); return result;
}
export function expiryFor(duration: DeepReadonly<Node<"duration">>, actor: 0 | 1, battleId: string | null, anchor?: ExpiryAnchor): EffectExpiry {
  if (duration.type === "UNTIL_BOUNDARY") {
    ensureMove(anchor && (actor === 0 || actor === 1), "v3-expiry-anchor-required");
    ensureMove((duration.player === "SELF" || duration.player === "OPPONENT") && (duration.boundary === "TURN_START" || duration.boundary === "END_PHASE_END") &&
      (duration.occurrence === 1 || duration.occurrence === 2) && typeof duration.includeCurrent === "boolean", "v3-invalid-boundary-duration");
    const player = duration.player === "SELF" ? actor : (1 - actor) as 0 | 1;
    return { endPlayer: null, remaining: null, boundary: { kind: duration.boundary, player, occurrence: duration.occurrence, includeCurrent: duration.includeCurrent,
      anchor: { ...anchor }, turnNumber: targetTurn(duration.boundary, player, duration.occurrence, duration.includeCurrent, anchor) } };
  }
  if (duration.type === "BATTLE_END") {
    ensureMove(battleId !== null, "v3-battle-duration-outside-battle"); id(battleId);
    return { endPlayer: null, remaining: null, battleId };
  }
  return { endPlayer: duration.player === "SELF" ? actor : (1 - actor) as 0 | 1, remaining: duration.occurrence };
}
export function validateExpiry(value: EffectExpiry, matchId?: string): void {
  if (value.boundary !== undefined) {
    const b = value.boundary; dataObject(b, ["kind", "player", "turnNumber", "occurrence", "includeCurrent", "anchor"]);
    ensureMove(value.battleId === undefined && value.endPlayer === null && value.remaining === null && (b.kind === "TURN_START" || b.kind === "END_PHASE_END") &&
      (b.player === 0 || b.player === 1) && (b.occurrence === 1 || b.occurrence === 2) && typeof b.includeCurrent === "boolean", "v3-invalid-boundary-expiry");
    ensureMove(b.turnNumber === targetTurn(b.kind, b.player, b.occurrence, b.includeCurrent, b.anchor) && (matchId === undefined || b.anchor.matchId === matchId), "v3-invalid-boundary-expiry-anchor"); return;
  }
  if (value.battleId !== undefined) {
    id(value.battleId); ensureMove(value.endPlayer === null && value.remaining === null, "v3-invalid-battle-expiry");
  } else ensureMove((value.endPlayer === 0 || value.endPlayer === 1) && (value.remaining === 1 || value.remaining === 2), "v3-invalid-turn-expiry");
}
export function expiryCheckpoint(board: MovementState, progression: Progression, kind: ExpiryCheckpoint["kind"]): ExpiryCheckpoint {
  ordinaryTurn(progression);
  ensureMove(progression.gate.kind === "idle" && !progression.battle && !progression.outcome && !progression.phaseSettled &&
    progression.phase === (kind === "TURN_START" ? "refresh" : "end") && progression.turnNumber >= board.turnNumber && progression.turnNumber <= board.turnNumber + 1, "v3-expiry-checkpoint-unavailable");
  const checkpoint = freezeMovement({ kind, matchId: board.matchId, turnNumber: progression.turnNumber, activePlayer: progression.activePlayer, phaseToken: progression.phaseToken, movementRevision: board.revision });
  checkpoints.add(checkpoint); return checkpoint;
}
export function expireAtBoundary<T extends EffectExpiry>(effects: readonly T[], checkpoint: ExpiryCheckpoint): readonly T[] {
  ensureMove(checkpoints.has(checkpoint), "v3-expiry-checkpoint-proof-required");
  dataObject(checkpoint, ["kind", "matchId", "turnNumber", "activePlayer", "phaseToken", "movementRevision"]); id(checkpoint.matchId); id(checkpoint.phaseToken);
  ensureMove((checkpoint.kind === "TURN_START" || checkpoint.kind === "END_PHASE_END") && (checkpoint.activePlayer === 0 || checkpoint.activePlayer === 1) &&
    Number.isSafeInteger(checkpoint.turnNumber) && checkpoint.turnNumber >= 1 && Number.isSafeInteger(checkpoint.movementRevision) && checkpoint.movementRevision >= 0, "v3-invalid-expiry-checkpoint");
  return freezeMovement(effects.filter(effect => {
    validateExpiry(effect, checkpoint.matchId); const b = effect.boundary; if (!b) return true;
    ensureMove(b.anchor.turnNumber <= checkpoint.turnNumber && b.anchor.movementRevision <= checkpoint.movementRevision, "v3-stale-expiry-checkpoint");
    ensureMove(b.turnNumber >= checkpoint.turnNumber && !(b.turnNumber === checkpoint.turnNumber && b.kind === "TURN_START" && checkpoint.kind === "END_PHASE_END"), "v3-expiry-boundary-missed");
    ensureMove(b.turnNumber !== checkpoint.turnNumber || b.player === checkpoint.activePlayer, "v3-expiry-turn-order-unmodeled");
    if (b.kind !== checkpoint.kind || b.player !== checkpoint.activePlayer) return true;
    return b.turnNumber !== checkpoint.turnNumber;
  }));
}
