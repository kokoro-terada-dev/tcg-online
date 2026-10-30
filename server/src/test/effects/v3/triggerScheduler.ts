import { randomUUID } from "node:crypto";
import type { MovementEvent } from "../../movement/types";
import type { ApprovedV3Card } from "./approval";
import type { Progression } from "../../progression/types";
import type { MovementState } from "../../movement/types";
import type { CardObjectRef } from "../types";
import type { TriggerObservation, TriggerObservations } from "./conditionalTriggers";

export type TriggerCause = Readonly<{ type: "ON_PLAY"; eventId: string; event: MovementEvent }> |
  Readonly<{ type: "ON_EVENT"; eventId: string; observation: TriggerObservation }> |
  Readonly<{ type: "ON_KO"; eventId: string; event: MovementEvent }> |
  Readonly<{ type: "ON_ATTACK" | "ON_OPPONENT_ATTACK"; eventId: string; battleId: string; attacker: 0 | 1; attackSource: Readonly<CardObjectRef>; turnNumber: number }>;
export type ScheduledTrigger = Readonly<{ token: string; batchId: string; actor: 0 | 1; cardId: string; effectId: string; source: Readonly<CardObjectRef>; cause: TriggerCause }>;
export const SYNTHETIC_TRIGGER_POLICY = "synthetic-triggers.attack-entry-ko.4";
export function enqueueObservedTriggers(queue: readonly ScheduledTrigger[], ledger: TriggerObservations): readonly ScheduledTrigger[] {
  const keys = new Set(queue.flatMap(entry => entry.cause.type === "ON_EVENT" ? [entry.cause.observation.key] : []));
  return ledger.records.filter(record => record.status === "PENDING" && !keys.has(record.key)).map(record => ({
    token: randomUUID(), batchId: queue.find(entry => entry.cause.eventId === record.eventId)?.batchId ?? `observed:${record.transactionId}`,
    actor: record.context.effectController, cardId: record.cardId, effectId: record.effectId, source: record.source,
    cause: { type: "ON_EVENT", eventId: record.eventId, observation: record }
  }));
}

// Self-entry events only. Watcher abilities and official simultaneous-trigger rulings are not inferred.
export function movementTriggerCandidates(events: readonly MovementEvent[], definitions: ReadonlyMap<string, ApprovedV3Card>) {
  return events.flatMap(event => {
    if (event.kind !== "moved" || !event.after || !event.to || !event.from || !event.after.faceUp || event.after.owner !== event.to.player || event.after.controller !== event.to.player) return [];
    const onKo = event.isKO && ["BATTLE_KO", "EFFECT_KO"].includes(event.cause.kind) && event.from.zone === "character" && event.to.zone === "trash" && event.before?.kind === "character" && event.after.kind === "character";
    const onPlay = event.from.zone !== event.to.zone && ["character", "stage"].includes(event.to.zone) && event.after.kind === event.to.zone;
    if (!onKo && !onPlay) return [];
    const timing = onKo ? "ON_KO" as const : "ON_PLAY" as const, sourceZone = onKo ? event.from.zone : event.to.zone;
    const definition = definitions.get(event.after.cardId);
    return definition?.definition.effects.filter(effect => effect.kind === "triggered" && effect.timing.type === timing && effect.sourceZones.some(zone => zone === sourceZone))
      .map(effect => ({ actor: event.after!.controller, cardId: event.after!.cardId, effectId: effect.id, timing, event })) ?? [];
  });
}
export function enqueueMovementTriggers(events: readonly MovementEvent[], definitions: ReadonlyMap<string, ApprovedV3Card>): readonly ScheduledTrigger[] {
  const batchId = randomUUID();
  return movementTriggerCandidates(events, definitions).map(({ event, timing, ...candidate }) => ({ ...candidate, batchId, token: randomUUID(),
    source: { instanceId: event.after!.instanceId, generation: event.after!.generation }, cause: { type: timing, eventId: event.eventId, event } }));
}
export function enqueueAttackTriggers(board: MovementState, progression: Progression, definitions: ReadonlyMap<string, ApprovedV3Card>): readonly ScheduledTrigger[] {
  const battle = progression.battle; if (!battle || battle.step !== "attack") return [];
  const batchId = randomUUID(), eventId = `attack:${battle.battleId}`;
  return ([battle.attacker, battle.defender] as const).flatMap(actor => {
    const zones = board.players[actor], timing = actor === battle.attacker ? "ON_ATTACK" as const : "ON_OPPONENT_ATTACK" as const;
    const ids = timing === "ON_ATTACK" ? [battle.source.instanceId] : [...zones.leader, ...zones.character, ...zones.stage];
    return ids.flatMap(id => {
      const card = id ? board.cards[id] : null; if (!card || !card.faceUp || card.owner !== actor || card.controller !== actor) return [];
      const definition = definitions.get(card.cardId);
      return definition?.definition.effects.filter(effect => effect.kind === "triggered" && effect.timing.type === timing && effect.sourceZones.some(zone => zones[zone].includes(id!)))
        .map(effect => ({ token: randomUUID(), batchId, actor, cardId: card.cardId, effectId: effect.id, source: { instanceId: card.instanceId, generation: card.generation },
          cause: { type: timing, eventId, battleId: battle.battleId, attacker: battle.attacker, attackSource: { ...battle.source }, turnNumber: progression.turnNumber } })) ?? [];
    });
  });
}
// Preserve the earlier timing group before any derived events (CR 8-6-1).
export function triggerChooser(queue: readonly ScheduledTrigger[], activePlayer: 0 | 1): 0 | 1 | null {
  const first = queue[0]; if (!first) return null;
  return queue.some(entry => entry.batchId === first.batchId && entry.actor === activePlayer) ? activePlayer : (1 - activePlayer) as 0 | 1;
}
export function availableTriggers(queue: readonly ScheduledTrigger[], activePlayer: 0 | 1): readonly ScheduledTrigger[] {
  const first = queue[0], chooser = triggerChooser(queue, activePlayer);
  return first ? queue.filter(entry => entry.batchId === first.batchId && entry.actor === chooser) : [];
}
