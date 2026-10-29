import { randomUUID } from "node:crypto";
import { MovementStore } from "../../movement/engine";
import { ensureMove, freezeMovement, getCard, location } from "../../movement/state";
import type { MovementEvent, MovementState } from "../../movement/types";
import type { Progression } from "../../progression/types";
import { checkTiming } from "../../progression/state";
import { applySystemEvent } from "../../progression/transitions";
import type { CardObjectRef } from "../types";
import type { ApprovedV3Card } from "./approval";
import { statDelta, type StatEffects } from "./statEffects";

type Ref = Readonly<CardObjectRef>;
type Seat = 0 | 1;
export type BattleCounters = readonly Readonly<{ target: Ref; amount: number }>[];
export type LifeDecision = Readonly<{ battleId: string; resolutionId: string; selectionId: string; token: string; defender: Seat; card: Ref; expiresAt: number }>;
export const V3_BASE_BATTLE_RULES = {
  version: "v3-base-battle.1", source: "https://www.onepiece-cardgame.com/pdf/rule_comprehensive.pdf?20260828=",
  reviewedAt: "2026-10-29", clauses: ["6-5-5", "6-5-6", "7-1", "7-1-3", "7-1-4", "7-1-5"],
} as const;
function field(board: MovementState, ref: Ref, player: Seat) {
  const card = getCard(board, ref), at = location(board, card.instanceId);
  ensureMove(at.player === player && card.owner === player && card.controller === player && card.faceUp && (at.zone === "leader" || at.zone === "character") && at.zone === card.kind, "v3-battle-field-required");
  return card;
}
export function battlePower(board: MovementState, progression: Progression, definitions: ReadonlyMap<string, ApprovedV3Card>, effects: StatEffects, counters: BattleCounters) {
  const battle = progression.battle; if (!battle) return null;
  const power = (ref: Ref, player: Seat) => {
    const object = field(board, ref, player), known = definitions.get(object.cardId)?.definition;
    ensureMove(known && known.cardType === object.kind && known.baseStats.power !== null && !object.modifierIds.length && !object.grantIds.length, "v3-battle-power-unknown");
    const attached = player === progression.activePlayer ? board.players[player].attachedDon.filter(id => {
      const target = board.cards[id!]!.attachedTo; return target?.instanceId === ref.instanceId && target.generation === ref.generation;
    }).length * 1000 : 0;
    const bonus = counters.filter(entry => entry.target.instanceId === ref.instanceId && entry.target.generation === ref.generation).reduce((sum, entry) => sum + entry.amount, 0);
    const result = known.baseStats.power + statDelta(effects, ref, "power") + attached + bonus;
    ensureMove(Number.isSafeInteger(result), "v3-battle-power-overflow"); return result;
  };
  return { attack: power(battle.source, battle.attacker), defense: power(battle.target, battle.defender) };
}
export function counterCandidates(board: MovementState, progression: Progression, actor: Seat, definitions: ReadonlyMap<string, ApprovedV3Card>) {
  if (!checkTiming(progression, actor, "counterEffect").allowed) return [];
  return board.players[actor].hand.flatMap(id => {
    const card = board.cards[id!]!, known = definitions.get(card.cardId)?.definition, amount = known?.baseStats.counter;
    if (card.kind !== "character" || card.owner !== actor || card.controller !== actor || known?.cardType !== "character" || typeof amount !== "number" || amount <= 0) return [];
    return [{ card: { instanceId: card.instanceId, generation: card.generation }, cardId: card.cardId, amount }];
  });
}
export function useCounter(board: MovementState, progression: Progression, actor: Seat, card: Ref, target: Ref, definitions: ReadonlyMap<string, ApprovedV3Card>, counters: BattleCounters, effects: StatEffects, transactionId: string) {
  const option = counterCandidates(board, progression, actor, definitions).find(choice => choice.card.instanceId === card.instanceId && choice.card.generation === card.generation);
  ensureMove(option && counters.length < 100, "v3-battle-counter-unavailable"); const targetObject = field(board, target, actor), known = definitions.get(targetObject.cardId)?.definition;
  const bonus = counters.filter(entry => entry.target.instanceId === target.instanceId && entry.target.generation === target.generation).reduce((sum, entry) => sum + entry.amount, option.amount);
  ensureMove(known && known.cardType === targetObject.kind && known.baseStats.power !== null && Number.isSafeInteger(known.baseStats.power + statDelta(effects, target, "power") + bonus), "v3-counter-target-power-unknown-or-overflow");
  const result = new MovementStore(board).commit({ transactionId, matchId: board.matchId, expectedRevision: board.revision, turnNumber: board.turnNumber,
    actor, effectController: actor, source: card, mode: "rule", resolutionId: null, operations: [{ kind: "move", card, from: { player: actor, zone: "hand" },
      to: { player: actor, zone: "trash", position: "append", faceUp: true, rotated: false }, cause: "OTHER" }] }, { status: "certifiedNone" });
  return { ...result, counters: freezeMovement([...counters, { target: { ...target }, amount: option.amount }]) };
}
function finishDamage(progression: Progression): Progression {
  const battle = progression.battle!;
  let next = applySystemEvent(progression, progression.revision, { kind: "settleBattleStep", battleId: battle.battleId, step: "damage" });
  next = applySystemEvent(next, next.revision, { kind: "advanceBattle", battleId: battle.battleId, step: "damage", participantsPresent: false });
  next = applySystemEvent(next, next.revision, { kind: "settleBattleStep", battleId: battle.battleId, step: "end" });
  return applySystemEvent(next, next.revision, { kind: "advanceBattle", battleId: battle.battleId, step: "end", participantsPresent: false });
}
export function damage(board: MovementState, progression: Progression, actor: Seat, definitions: ReadonlyMap<string, ApprovedV3Card>, effects: StatEffects, counters: BattleCounters, transactionId: string, now: number) {
  const battle = progression.battle;
  ensureMove(battle && actor === battle.defender && battle.step === "damage" && battle.decisionComplete && !battle.settled && progression.gate.kind === "idle" && !progression.outcome, "v3-battle-damage-window");
  const powers = battlePower(board, progression, definitions, effects, counters)!;
  const target = field(board, battle.target, actor), hits = powers.attack >= powers.defense;
  let next = progression; let movement = board; let events: readonly MovementEvent[] = [];
  let pendingLife: LifeDecision | null = null;
  if (hits && target.kind === "leader" && board.players[actor].life.length === 0) {
    next = applySystemEvent(next, next.revision, { kind: "finishGame", winner: battle.attacker, reason: "leader-damage-at-zero-life" });
  } else if (hits && target.kind === "leader") {
    const id = board.players[actor].life[0]!, card = board.cards[id]!, known = definitions.get(card.cardId)?.definition;
    ensureMove(known && known.cardType === card.kind && known.source.triggerText.trim() === "", "v3-life-trigger-definition-unresolved");
    ensureMove(Number.isSafeInteger(now) && now >= 0 && Number.isSafeInteger(now + 120000), "v3-life-clock-invalid");
    pendingLife = { battleId: battle.battleId, resolutionId: randomUUID(), selectionId: randomUUID(), token: randomUUID(), defender: actor,
      card: { instanceId: id, generation: card.generation }, expiresAt: now + 120000 };
    next = applySystemEvent(next, next.revision, { kind: "beginResolution", resolutionId: pendingLife.resolutionId, controller: actor });
    next = applySystemEvent(next, next.revision, { kind: "waitForChoice", resolutionId: pendingLife.resolutionId, selectionId: pendingLife.selectionId, chooser: actor });
    const result = new MovementStore(board).commit({ transactionId, matchId: board.matchId, expectedRevision: board.revision, turnNumber: board.turnNumber,
      actor, effectController: null, source: battle.source, mode: "rule", resolutionId: pendingLife.resolutionId,
      operations: [{ kind: "reveal", card: pendingLife.card, scopeId: pendingLife.resolutionId, viewers: [actor] }] }, { status: "certifiedNone" });
    movement = result.state; events = result.events;
  } else {
    if (hits && target.kind === "character") {
      const result = new MovementStore(board).commit({ transactionId, matchId: board.matchId, expectedRevision: board.revision, turnNumber: board.turnNumber,
        actor: battle.attacker, effectController: null, source: battle.source, mode: "rule", resolutionId: null,
        operations: [{ kind: "move", card: battle.target, from: { player: actor, zone: "character" }, to: { player: actor, zone: "trash", position: "append", faceUp: true, rotated: false }, cause: "BATTLE_KO" }] }, { status: "certifiedNone" });
      movement = result.state; events = result.events;
    }
    next = finishDamage(next);
  }
  return { movement, progression: next, events, pendingLife };
}
export function takeLife(board: MovementState, progression: Progression, actor: Seat, pending: LifeDecision, selectionId: string, token: string, transactionId: string, now: number) {
  const gate = progression.gate, battle = progression.battle;
  ensureMove(actor === pending.defender && pending.token === token && pending.selectionId === selectionId && Number.isSafeInteger(now) && now < pending.expiresAt &&
    battle?.battleId === pending.battleId && battle.step === "damage" && gate.kind === "choice" && gate.chooser === actor && gate.selectionId === selectionId && gate.resolutionId === pending.resolutionId &&
    board.players[actor].life[0] === pending.card.instanceId, "v3-life-choice-unavailable");
  getCard(board, pending.card); field(board, battle.source, battle.attacker); field(board, battle.target, actor);
  let next = applySystemEvent(progression, progression.revision, { kind: "acceptChoice", resolutionId: pending.resolutionId, selectionId, chooser: actor });
  next = applySystemEvent(next, next.revision, { kind: "finishResolution", resolutionId: pending.resolutionId }); next = finishDamage(next);
  const result = new MovementStore(board).commit({ transactionId, matchId: board.matchId, expectedRevision: board.revision, turnNumber: board.turnNumber,
    actor, effectController: null, source: battle.source, mode: "rule", resolutionId: pending.resolutionId,
    operations: [{ kind: "move", card: pending.card, from: { player: actor, zone: "life" }, to: { player: actor, zone: "hand", position: "append", faceUp: true, rotated: false }, cause: "DAMAGE" },
      { kind: "closeReveals", scopeId: pending.resolutionId }] }, { status: "certifiedNone" });
  return { movement: result.state, progression: next, events: result.events };
}
