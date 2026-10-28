import type { CardObjectRef } from "./effects/types";
import type { MovementState, Player } from "./movement/types";
import type { Progression } from "./progression/types";
import { MovementStore } from "./movement/engine";
import { ensureMove, getCard, location } from "./movement/state";
import { checkTiming } from "./progression/state";
import { applyPlayerIntent, applySystemEvent } from "./progression/transitions";

function fieldCard(board: MovementState, ref: Readonly<CardObjectRef>, actor: Player) {
  const card = getCard(board, ref), at = location(board, card.instanceId);
  ensureMove(at.player === actor && card.owner === actor && card.controller === actor && card.faceUp &&
    (at.zone === "leader" || at.zone === "character") && card.kind === at.zone, "local-battle-field-card-required");
  return card;
}
function localContext(board: MovementState, progression: Progression) {
  ensureMove(process.env.NODE_ENV !== "production" && board.turnNumber === progression.turnNumber &&
    board.players.every(zones => zones.deck.length > 0) && Object.values(board.cards).every(card => !card.modifierIds.length && !card.grantIds.length), "local-battle-context-unavailable");
}
export function localAttackCandidates(board: MovementState, progression: Progression, actor: Player) {
  const empty = { sources: [] as string[], targets: [] as string[] };
  try { localContext(board, progression); } catch { return empty; }
  if (!checkTiming(progression, actor, "attack").allowed) return empty;
  const sources = [...board.players[actor].leader, ...board.players[actor].character].filter((id): id is string => id !== null).filter(id => {
    const card = board.cards[id]!;
    return card.owner === actor && card.controller === actor && card.faceUp && !card.rotated && (card.kind === "leader" || card.enteredTurn !== progression.turnNumber);
  });
  const opponent = (1 - actor) as Player;
  const targets = [...board.players[opponent].leader, ...board.players[opponent].character].filter((id): id is string => id !== null).filter(id => {
    const card = board.cards[id]!;
    return card.owner === opponent && card.controller === opponent && card.faceUp && (card.kind === "leader" || card.rotated);
  });
  return { sources, targets };
}
// Basic fixture declaration only. No printed abilities, blocking, power or damage adjudication.
export function startLocalBattle(board: MovementState, progression: Progression, actor: Player, source: Readonly<CardObjectRef>, target: Readonly<CardObjectRef>, battleId: string, transactionId: string) {
  localContext(board, progression);
  ensureMove(checkTiming(progression, actor, "attack").allowed, "local-attack-window-unavailable");
  const attacker = fieldCard(board, source, actor), defender = fieldCard(board, target, (1 - actor) as Player);
  ensureMove(!attacker.rotated && (attacker.kind === "leader" || attacker.enteredTurn !== progression.turnNumber), "local-attack-source-unavailable");
  ensureMove(defender.kind === "leader" || defender.rotated, "local-attack-target-must-be-leader-or-rested-character");
  let next = applySystemEvent(progression, progression.revision, { kind: "startBattle", battleId, source, target });
  const movement = new MovementStore(board).commit({ transactionId, matchId: board.matchId, expectedRevision: board.revision, turnNumber: board.turnNumber,
    actor, effectController: null, source, mode: "rule", resolutionId: null, operations: [{ kind: "setRest", card: source, rotated: true }] }, { status: "certifiedNone" }).state;
  next = applySystemEvent(next, next.revision, { kind: "settleBattleStep", battleId, step: "attack" });
  next = applySystemEvent(next, next.revision, { kind: "advanceBattle", battleId, step: "attack", participantsPresent: true });
  return { movement, progression: next };
}
export function decideLocalBattle(board: MovementState, progression: Progression, actor: Player, battleId: string, decision: "passBlock" | "endCounter") {
  localContext(board, progression);
  const battle = progression.battle;
  ensureMove(battle?.battleId === battleId, "local-battle-context-stale");
  fieldCard(board, battle.source, battle.attacker); fieldCard(board, battle.target, battle.defender);
  let next = applyPlayerIntent(progression, progression.revision, actor, decision);
  next = applySystemEvent(next, next.revision, { kind: "settleBattleStep", battleId, step: battle.step });
  next = applySystemEvent(next, next.revision, { kind: "advanceBattle", battleId, step: battle.step, participantsPresent: true });
  return { movement: board, progression: next };
}
