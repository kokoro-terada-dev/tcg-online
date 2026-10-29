import { visibleTo } from "../../movement/engine";
import { ensureMove, getCard, location } from "../../movement/state";
import type { MovementState } from "../../movement/types";
import type { CardObjectRef, DeepReadonly } from "../types";
import type { PinnedMasterFacts } from "../masterFacts";
import type { Value } from "./dsl";
import type { ApprovedV3Card } from "./approval";
import type { ResolutionEnvironment, ResolutionIdentity } from "./resolution";
import type { StatEffects } from "./statEffects";
import { UNKNOWN, createDerivedCardFactsReader, readEventContext, type EventContext } from "./readContext";
import type { KeywordGrants } from "./keywordEffects";

type Scalar = string | number | boolean | null | typeof UNKNOWN;
export function fixtureEnvironment(board: () => MovementState, identity: ResolutionIdentity, definition: ApprovedV3Card, facts: PinnedMasterFacts, now: () => number, definitions: readonly ApprovedV3Card[] = [definition], statEffects: () => StatEffects = () => [], activePlayer: 0 | 1 = identity.actor, counterPower: (ref: Readonly<CardObjectRef>) => number = () => 0, eventContext?: EventContext, keywordGrants: () => KeywordGrants = () => []): ResolutionEnvironment {
  const knownDefinitions = new Map(definitions.map(card => [card.definition.cardId, card]));
  const context = eventContext ?? readEventContext(board(), identity);
  ensureMove(context.effectController === identity.actor && context.source.instanceId === identity.source.instanceId && context.source.generation === identity.source.generation, "v3-read-context-source-mismatch");
  const seat = (side: string): 0 | 1 => side === "SELF" ? context.effectController : (1 - context.effectController) as 0 | 1;
  const cardFacts = createDerivedCardFactsReader({ board, definitions: knownDefinitions, master: facts, statEffects, activePlayer, counterPower, keywordGrants });
  const read = (value: DeepReadonly<Value>, bindings: Readonly<Record<string, readonly Readonly<CardObjectRef>[]>>, candidate?: Readonly<CardObjectRef>): Scalar => {
    if (value === null || typeof value !== "object") return value;
    const state = board(), parts = value.ref.split(".");
    if (parts[0] === "bindings") return bindings[parts[1]!]?.length ?? UNKNOWN;
    if (parts[0] === "SELF" || parts[0] === "OPPONENT") {
      const zones = state.players[seat(parts[0])]; return parts[1] === "lifeCount" ? zones.life.length : parts[1] === "handCount" ? zones.hand.length : UNKNOWN;
    }
    const ref = parts[0] === "SOURCE" ? identity.source : candidate; if (!ref) return UNKNOWN;
    const derived = cardFacts(ref, context.effectController), field = parts[1];
    if (derived === UNKNOWN) return UNKNOWN;
    if (field === "rotated") return derived.rotated;
    if (field === "cardType") return derived.cardType;
    return field === "cost" || field === "power" ? derived.current[field] : UNKNOWN;
  };
  const evaluate: ResolutionEnvironment["evaluate"] = (predicate, bindings, candidate) => {
    if (predicate.type === "all" || predicate.type === "any") {
      let unknown = false;
      for (const child of predicate.conditions) {
        const result = evaluate(child, bindings, candidate);
        if (predicate.type === "all" && result === false) return false;
        if (predicate.type === "any" && result === true) return true;
        if (result === "unknown") unknown = true;
      }
      return unknown ? "unknown" : predicate.type === "all";
    }
    if (predicate.type === "not") { const result = evaluate(predicate.condition, bindings, candidate); return result === "unknown" ? result : !result; }
    if (predicate.type === "CARD_NAME" || predicate.type === "CARD_METADATA" || predicate.type === "HAS_ABILITY") {
      const ref = predicate.subject === "SOURCE" ? identity.source : candidate;
      if (!ref) return "unknown";
      const derived = cardFacts(ref, context.effectController);
      if (derived === UNKNOWN) return "unknown";
      if (predicate.type === "HAS_ABILITY") {
        const ability = derived.abilities[predicate.basis][predicate.ability];
        return ability === UNKNOWN || typeof ability !== "boolean" ? "unknown" : ability;
      }
      const metadata = derived.metadata[predicate.basis === "PRINTED" ? "printed" : "current"];
      if (predicate.type === "CARD_NAME") return metadata.name === UNKNOWN ? "unknown" : predicate.op === "eq" ? metadata.name === predicate.value : metadata.name !== predicate.value;
      const values = metadata[predicate.field]; if (values === UNKNOWN) return "unknown";
      const contains = (query: string) => values.some(value => predicate.comparison === "EXACT" ? value === query : value.includes(query));
      if (predicate.match === "ANY") return predicate.values.some(contains);
      if (predicate.match === "ALL") return predicate.values.every(contains);
      if (predicate.match === "NONE") return !predicate.values.some(contains);
      return values.length === predicate.values.length && predicate.values.every(contains);
    }
    if (predicate.type !== "compare") return "unknown";
    const left = read(predicate.left, bindings, candidate), right = read(predicate.right, bindings, candidate);
    if (left === UNKNOWN || right === UNKNOWN) return "unknown";
    if (predicate.op === "eq") return left === right;
    if (predicate.op === "ne") return left !== right;
    if (typeof left !== "number" || typeof right !== "number") return "unknown";
    const operations = { lt: () => left < right, lte: () => left <= right, gt: () => left > right, gte: () => left >= right };
    return operations[predicate.op]();
  };
  return {
    revision: () => board().revision, now, evaluate,
    peekTop: amount => board().players[identity.actor].deck.slice(0, amount).map(id => ({ instanceId: id!, generation: board().cards[id!]!.generation })),
    canPayCosts: (costs, discarded, returned) => {
      const state = board(), actor = identity.actor; let rest = 0, discard = 0, restSource = 0;
      const returns = costs.filter(cost => cost.type === "DON_RETURN");
      if (returns.length > 1) return "unknown";
      const returnCost = returns[0], returnCount = returnCost?.count ?? 0;
      for (const cost of costs) { if (cost.type === "REST_DON") rest += cost.count; else if (cost.type === "DISCARD_HAND") discard += cost.count; else if (cost.type === "REST_SOURCE") restSource++; else if (cost.type !== "DON_RETURN") return "unknown"; }
      if (restSource) {
        try {
          const card = getCard(state, identity.source), at = location(state, card.instanceId);
          if (restSource !== 1 || card.rotated || !card.faceUp || card.owner !== actor || card.controller !== actor || at.player !== actor ||
            !["leader", "character", "stage"].includes(at.zone) || card.kind !== at.zone || !visibleTo(state, card, at, 0) || !visibleTo(state, card, at, 1)) return false;
        } catch { return false; }
      }
      const eligible = (ref: Readonly<CardObjectRef>) => {
        try { const card = getCard(state, ref), at = location(state, ref.instanceId);
          return at.player === actor && at.zone === "hand" && card.owner === actor && card.controller === actor && ["character", "stage", "event"].includes(card.kind) && visibleTo(state, card, at, actor) && !visibleTo(state, card, at, (1 - actor) as 0 | 1);
        } catch { return false; }
      };
      const eligibleDon = (ref: Readonly<CardObjectRef>) => {
        try {
          const card = getCard(state, ref), at = location(state, ref.instanceId);
          return !!returnCost && returnCost.from.some(zone => zone === at.zone) && at.player === actor && card.kind === "don" && card.owner === actor && card.controller === actor && card.faceUp &&
            visibleTo(state, card, at, 0) && visibleTo(state, card, at, 1);
        } catch { return false; }
      };
      const active = state.players[actor].activeDon.filter(id => { const card = state.cards[id!]!; return card.kind === "don" && card.owner === actor && card.controller === actor && !card.rotated; }).length;
      const candidates = returnCost?.from.flatMap(zone => state.players[actor][zone]).filter(id => eligibleDon({ instanceId: id!, generation: state.cards[id!]!.generation })) ?? [];
      const nonActive = candidates.filter(id => location(state, id!).zone !== "activeDon").length;
      const activeReturned = returned === null ? Math.max(0, returnCount - nonActive) : returned.filter(ref => {
        try { return location(state, getCard(state, ref).instanceId).zone === "activeDon"; } catch { return false; }
      }).length;
      if (rest + discard + restSource + returnCount > 64 || discard > 50 || active < rest + activeReturned || candidates.length < returnCount) return false;
      if (returned !== null && (returned.length !== returnCount || new Set(returned.map(ref => ref.instanceId)).size !== returnCount || !returned.every(eligibleDon))) return false;
      if (state.players[actor].hand.filter(id => eligible({ instanceId: id!, generation: state.cards[id!]!.generation })).length < discard) return false;
      return discarded === null || discarded.length === discard && new Set(discarded.map(ref => ref.instanceId)).size === discard && discarded.every(eligible);
    },
    candidates: (selector, bindings) => {
      const state = board();
      const zones = typeof selector.zone === "string" ? [selector.zone] : selector.zone;
      let ids: readonly (string | null)[] = zones.flatMap(zone => state.players[seat(selector.owner)][zone]);
      if (selector.type === "BOUND_CARDS") {
        const cards = bindings[selector.cards.ref.slice("bindings.".length)], excluded = selector.excludeCards ? bindings[selector.excludeCards.ref.slice("bindings.".length)] : [];
        ensureMove(cards && excluded, "v3-missing-bound-candidates");
        ids = cards.filter(ref => !excluded.some(other => other.instanceId === ref.instanceId && other.generation === ref.generation)).map(ref => {
          const card = getCard(state, ref), at = location(state, card.instanceId);
          ensureMove(at.player === identity.actor && at.zone === "deck" && card.owner === identity.actor && card.controller === identity.actor &&
            state.reveals.some(grant => grant.scopeId === identity.resolutionId && grant.card.instanceId === ref.instanceId && grant.card.generation === ref.generation && grant.viewers.includes(identity.actor)), "v3-uninspected-bound-candidate");
          return card.instanceId;
        });
      }
      return ids.flatMap(id => {
        if (id === null) return [];
        const card = state.cards[id]!, at = location(state, id);
        const viewers = ([0, 1] as const).filter(viewer => visibleTo(state, card, at, viewer));
        const visible = selector.type === "BOUND_CARDS" ? viewers.includes(identity.actor) : selector.visibility === "PUBLIC" ? card.faceUp && viewers.length === 2 :
          at.zone === "hand" && card.owner === identity.actor && card.controller === identity.actor && viewers.length === 1 && viewers[0] === identity.actor;
        if (card.owner !== seat(selector.owner) || card.controller !== seat(selector.controller) || !visible || !selector.cardTypes.some(type => type === card.kind)) return [];
        let label: string | undefined;
        if (at.zone === "activeDon") label = "アクティブDON";
        if (at.zone === "restDon") label = "レストDON";
        if (at.zone === "attachedDon" && card.attachedTo) {
          const parentAt = location(state, card.attachedTo.instanceId);
          label = parentAt.zone === "leader" ? "リーダー付与DON" : `キャラ${state.players[at.player].character.indexOf(card.attachedTo.instanceId) + 1}付与DON`;
        }
        return [{ ref: { instanceId: id, generation: card.generation }, cardId: card.cardId, owner: card.owner, controller: card.controller, zone: at.zone, kind: card.kind, faceUp: card.faceUp, visibleTo: viewers, ...(label ? { label } : {}) }];
      });
    },
  };
}
