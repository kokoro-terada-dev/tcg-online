import { createHash } from "node:crypto";
import { dataArray, dataObject, ensureMove, freezeMovement, getCard, location, reference } from "../../movement/state";
import { visibleTo } from "../../movement/engine";
import type { MovementState } from "../../movement/types";
import type { CardObjectRef, DeepReadonly } from "../types";
import type { Node } from "./dsl";
import type { ApprovedV3Card } from "./approval";
import { expiryFor, validateExpiry, type EffectExpiry, type ExpiryAnchor } from "./effectExpiry";

export type StatEffect = Readonly<{
  id: string; target: Readonly<CardObjectRef>; source: Readonly<CardObjectRef>; actor: 0 | 1;
  stat: "power" | "cost"; amount: number;
}> & EffectExpiry;
export type StatEffects = readonly StatEffect[];
const field = (state: MovementState, ref: Readonly<CardObjectRef>) => {
  const card = getCard(state, ref), at = location(state, card.instanceId);
  ensureMove(card.faceUp && ["leader", "character", "stage"].includes(at.zone) && card.kind === at.zone && visibleTo(state, card, at, 0) && visibleTo(state, card, at, 1), "v3-stat-public-field-only");
  return card;
};
export function validateStatEffects(state: MovementState, effects: StatEffects): StatEffects {
  dataArray(effects, 256); const ids = new Set<string>();
  for (const effect of effects) {
    dataObject(effect, ["id", "target", "source", "actor", "stat", "amount", "endPlayer", "remaining"], ["battleId", "boundary"]); validateExpiry(effect, state.matchId);
    ensureMove(typeof effect.id === "string" && /^[a-f0-9]{64}$/.test(effect.id) && !ids.has(effect.id), "v3-invalid-stat-id"); ids.add(effect.id);
    reference(effect.target); reference(effect.source); field(state, effect.target);
    ensureMove((effect.actor === 0 || effect.actor === 1) &&
      (effect.stat === "power" || effect.stat === "cost") && Number.isSafeInteger(effect.amount) && effect.amount !== 0 && Math.abs(effect.amount) <= 100000, "v3-invalid-stat-effect");
  }
  return freezeMovement(structuredClone(effects));
}
export function pruneStatEffects(state: MovementState, effects: StatEffects): StatEffects {
  return freezeMovement(effects.filter(effect => {
    const card = state.cards[effect.target.instanceId];
    return card?.generation === effect.target.generation && ["leader", "character", "stage"].includes(location(state, card.instanceId).zone);
  }));
}
export function statDelta(effects: StatEffects, ref: Readonly<CardObjectRef>, stat: "power" | "cost"): number {
  return effects.reduce((sum, effect) => sum + (effect.target.instanceId === ref.instanceId && effect.target.generation === ref.generation && effect.stat === stat ? effect.amount : 0), 0);
}
export function addStatEffects(state: MovementState, effects: StatEffects, workId: string, source: Readonly<CardObjectRef>, actor: 0 | 1,
  targets: readonly Readonly<CardObjectRef>[], stat: "power" | "cost", amount: number, duration: DeepReadonly<Node<"duration">>, definitions: readonly ApprovedV3Card[], battleId: string | null = null, anchor?: ExpiryAnchor): StatEffects {
  ensureMove(targets.length > 0 && new Set(targets.map(ref => ref.instanceId)).size === targets.length && effects.length + targets.length <= 256, "v3-stat-target-or-count-limit");
  const entries = targets.map(target => {
    const card = field(state, target), definition = definitions.find(known => known.definition.cardId === card.cardId);
    ensureMove(definition && definition.definition.cardType === card.kind && definition.definition.baseStats[stat] !== null && !card.modifierIds.length && !card.grantIds.length, "v3-stat-value-unknown");
    ensureMove(Number.isSafeInteger(definition.definition.baseStats[stat]! + statDelta(effects, target, stat) + amount), "v3-stat-number-overflow");
    const id = createHash("sha256").update(JSON.stringify([state.matchId, workId, target])).digest("hex");
    return { id, target: { ...target }, source: { ...source }, actor, stat, amount, ...expiryFor(duration, actor, battleId, anchor) };
  });
  return validateStatEffects(state, [...effects, ...entries]);
}
// Called once for each committed end-of-turn boundary, never from a refresh button.
export function endTurnStatEffects(effects: StatEffects, endingPlayer: 0 | 1): StatEffects {
  return freezeMovement(effects.flatMap(effect => effect.endPlayer !== endingPlayer ? [effect] : effect.remaining === 1 ? [] : [{ ...effect, remaining: 1 as const }]));
}
export function retainBattleStatEffects(effects: StatEffects, battleId: string | null): StatEffects {
  return freezeMovement(effects.filter(effect => effect.battleId === undefined || effect.battleId === battleId));
}
