import { createHash } from "node:crypto";
import type { CardObjectRef } from "../types";
import type { MovementEvent, MovementState } from "../../movement/types";
import { movementOccurrence } from "../../movement/occurrence";
import { ensureMove, freezeMovement, getCard, location } from "../../movement/state";
import { visibleTo } from "../../movement/engine";
import { pinMasterFacts } from "../masterFacts";
import type { ApprovedV3Card } from "./approval";
import { fixtureEnvironment } from "./fixtureEnvironment";
import { readEventContext, type EventContext } from "./readContext";
import type { StatEffects } from "./statEffects";
import type { KeywordGrants } from "./keywordEffects";
import type { Predicate } from "./dsl";
import type { DeepReadonly } from "../types";

export type TriggerObservation = Readonly<{
  key: string; eventId: string; groupId: string; transactionId: string; eventType: "CARD_ENTERED" | "CARD_KO" | "CARD_MOVED";
  causeEffectId: string | null; source: Readonly<CardObjectRef>; cardId: string;
  effectId: string; definitionHash: string; context: EventContext; target: Readonly<CardObjectRef>;
  snapshot: "TRANSACTION_BEFORE" | "TRANSACTION_AFTER"; turnNumber: number; activePlayer: 0 | 1;
  result: true | false | "unknown"; status: "HELD" | "NOT_MATCHED" | "PENDING" | "RESOLVING" | "RESOLVED" | "SKIPPED";
  reason: "PR06B_REQUIRED" | "CONDITION_FALSE" | "UNKNOWN_FACTS" | "MULTI_MOVE_TIMING_UNRESOLVED" | "READY" | "SOURCE_STALE" | "USAGE_EXHAUSTED" | "NON_MAIN_BOUNDARY";
}>;
export type TriggerObservations = Readonly<{
  events: Readonly<Record<string, string>>; records: readonly TriggerObservation[];
}>;
export const emptyTriggerObservations = (): TriggerObservations => freezeMovement({ events: {}, records: [] });
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const observations = new WeakSet<object>();
export const isTriggerObservation = (value: TriggerObservation): boolean => observations.has(value);
export function updateTriggerObservation(ledger: TriggerObservations, key: string, status: TriggerObservation["status"], reason?: TriggerObservation["reason"]): TriggerObservations {
  return freezeMovement({ ...ledger, records: ledger.records.map(record => {
    if (record.key !== key) return record;
    const next = { ...record, status, reason: reason ?? record.reason }; observations.add(next); return next;
  }) });
}
export const conditionalTriggersWaiting = (ledger: TriggerObservations): boolean => ledger.records.some(record => record.status === "PENDING" || record.status === "HELD");
export function hasConditionalTriggers(definitions: ReadonlyMap<string, ApprovedV3Card>): boolean {
  return [...definitions.values()].some(card => card.definition.effects.some(effect => effect.timing.type === "ON_EVENT"));
}
export const conditionalTriggersHeld = (ledger: TriggerObservations): boolean => ledger.records.some(record => record.status === "HELD");
function privateQuery(predicate: DeepReadonly<Predicate>): boolean {
  if (predicate.type === "all" || predicate.type === "any") return predicate.conditions.some(privateQuery);
  if (predicate.type === "not") return privateQuery(predicate.condition);
  return (predicate.type === "EXISTS" || predicate.type === "COUNT") && (predicate.query.visibility !== "PUBLIC" || privateQuery(predicate.query.filters));
}

// Evaluate immutable transaction evidence, never the board at a later resume/request.
// This ledger is server-only: it has no execution tokens and is not a selection DTO.
export function observeConditionalTriggers(ledger: TriggerObservations, events: readonly MovementEvent[], definitions: ReadonlyMap<string, ApprovedV3Card>,
  activePlayer: 0 | 1, statEffects: StatEffects = [], keywordGrants: KeywordGrants = [], counterPower: (ref: Readonly<CardObjectRef>) => number = () => 0,
  resolvingEffect?: Readonly<{ resolutionId: string; effectId: string }>): TriggerObservations {
  if (!hasConditionalTriggers(definitions)) return ledger;
  const seen = { ...ledger.events }, records = [...ledger.records];
  for (const event of events) {
    if (event.kind !== "moved" || !event.before || !event.after || !event.from || !event.to || event.after.kind === "don") continue;
    const digest = hash(event);
    if (Object.hasOwn(seen, event.eventId)) { ensureMove(seen[event.eventId] === digest, "v3-trigger-event-conflict"); continue; }
    const occurrence = movementOccurrence(event);
    ensureMove(occurrence && occurrence.events.includes(event), "v3-trigger-occurrence-evidence-required");
    ensureMove(Object.keys(seen).length < 512, "v3-trigger-observation-event-limit"); seen[event.eventId] = digest;
    const multiMove = occurrence.events.filter(row => row.kind === "moved" && row.after?.kind !== "don").length > 1;
    for (const basis of ["TRANSACTION_BEFORE", "TRANSACTION_AFTER"] as const) {
      const state = basis === "TRANSACTION_BEFORE" ? occurrence.before : occurrence.after;
      const targetCard = basis === "TRANSACTION_BEFORE" ? event.before : event.after;
      const target = { instanceId: targetCard.instanceId, generation: targetCard.generation };
      for (const sourceCard of Object.values(state.cards)) {
        const sourceAt = location(state, sourceCard.instanceId);
        if (!["leader", "character", "stage"].includes(sourceAt.zone) || !sourceCard.faceUp || sourceCard.kind !== sourceAt.zone ||
          sourceCard.owner !== sourceCard.controller || sourceAt.player !== sourceCard.controller ||
          !visibleTo(state, sourceCard, sourceAt, 0) || !visibleTo(state, sourceCard, sourceAt, 1)) continue;
        const definition = definitions.get(sourceCard.cardId); if (!definition || definition.definition.cardType !== sourceCard.kind) continue;
        for (const effect of definition.definition.effects) {
          const timing = effect.timing;
          if (effect.kind !== "triggered" || timing.type !== "ON_EVENT" || timing.snapshot !== basis || !effect.sourceZones.some(zone => zone === sourceAt.zone)) continue;
          const self = target.instanceId === sourceCard.instanceId;
          if (timing.relation === "SELF" && !self || timing.relation === "OTHER" && self) continue;
          if (!timing.fromZones.some(zone => zone === event.from!.zone) || !timing.toZones.some(zone => zone === event.to!.zone)) continue;
          if (timing.event === "CARD_ENTERED" && !(event.to.zone === "character" || event.to.zone === "stage")) continue;
          if (timing.event === "CARD_KO" && !(event.isKO && ["BATTLE_KO", "EFFECT_KO"].includes(event.cause.kind) && event.from.zone === "character" && event.to.zone === "trash")) continue;
          const actor = sourceCard.controller, seat = (player: string) => player === "SELF" ? actor : 1 - actor;
          // A hidden subject never supplies metadata or even a false match to an observer.
          const authorized = visibleTo(state, targetCard, location(state, target.instanceId), actor);
          const source = { instanceId: sourceCard.instanceId, generation: sourceCard.generation };
          const identity = { matchId: state.matchId, resolutionId: "conditional-observation", actor, source, effectId: effect.id };
          const context = readEventContext(state, identity, null, { type: "movement", event });
          const environment = fixtureEnvironment(() => state, identity, definition, pinMasterFacts(state, { master: null, numericPolicy: "certifiedUnmodified" }),
            () => 0, [...definitions.values()], () => statEffects, activePlayer, counterPower, context, () => keywordGrants);
          const structural = timing.cardTypes.some(kind => kind === targetCard.kind) &&
            (timing.owner === "ANY" || targetCard.owner === seat(timing.owner)) && (timing.controller === "ANY" || targetCard.controller === seat(timing.controller));
          const filter = authorized ? environment.evaluate(timing.filters, {}, target) : "unknown";
          const activation = environment.evaluate(effect.activationConditions, {});
          // Do not disclose a private-query truth value through the public hold indicator.
          const result = multiMove || !authorized || targetCard.kind === "unknown" || privateQuery(timing.filters) || privateQuery(effect.activationConditions) ? "unknown" :
            !structural || filter === false || activation === false ? false : filter === "unknown" || activation === "unknown" ? "unknown" : true;
          ensureMove(records.length < 4096, "v3-trigger-observation-limit");
          const executable = definition.definition.schemaVersion === "3.0.0-subset.22";
          const record: TriggerObservation = { key: hash([state.matchId, event.eventId, source, effect.id, definition.definitionHash]), eventId: event.eventId, groupId: event.groupId,
            transactionId: occurrence.transactionId, eventType: timing.event, causeEffectId: resolvingEffect && resolvingEffect.resolutionId === event.cause.resolutionId ? resolvingEffect.effectId : null,
            source, cardId: sourceCard.cardId, effectId: effect.id, definitionHash: definition.definitionHash, context, target, snapshot: basis,
            turnNumber: occurrence.after.turnNumber, activePlayer, result, status: result === false ? "NOT_MATCHED" : result === true && executable ? "PENDING" : "HELD",
            reason: multiMove ? "MULTI_MOVE_TIMING_UNRESOLVED" : result === false ? "CONDITION_FALSE" : result === "unknown" ? "UNKNOWN_FACTS" : executable ? "READY" : "PR06B_REQUIRED" };
          observations.add(record); records.push(record);
        }
      }
    }
  }
  return freezeMovement({ events: seen, records });
}

export function validateObservedSource(record: TriggerObservation, state: MovementState, definitions: ReadonlyMap<string, ApprovedV3Card>): "CURRENT" | "STALE" {
  try {
    const card = getCard(state, record.source), at = location(state, card.instanceId);
    const definition = definitions.get(card.cardId), effect = definition?.definition.effects.find(effect => effect.id === record.effectId);
    return card.faceUp && visibleTo(state, card, at, 0) && visibleTo(state, card, at, 1) && definition?.definitionHash === record.definitionHash && card.cardId === record.cardId && effect?.timing.type === "ON_EVENT" &&
      effect.sourceZones.some(zone => zone === at.zone) && card.owner === record.context.sourceOwner && card.controller === record.context.sourceController ? "CURRENT" : "STALE";
  } catch { return "STALE"; }
}
