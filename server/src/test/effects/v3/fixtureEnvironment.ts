import { visibleTo } from "../../movement/engine";
import { getCard, location } from "../../movement/state";
import type { MovementState } from "../../movement/types";
import type { CardObjectRef, DeepReadonly } from "../types";
import type { PinnedMasterFacts } from "../masterFacts";
import { masterCardFacts } from "../masterFacts";
import type { Value } from "./dsl";
import type { ApprovedV3Card } from "./approval";
import type { ResolutionEnvironment, ResolutionIdentity } from "./resolution";

const UNKNOWN = Symbol("unknown");
type Scalar = string | number | boolean | null | typeof UNKNOWN;
export function fixtureEnvironment(board: () => MovementState, identity: ResolutionIdentity, definition: ApprovedV3Card, facts: PinnedMasterFacts, now: () => number): ResolutionEnvironment {
  const seat = (side: string): 0 | 1 => side === "SELF" ? identity.actor : (1 - identity.actor) as 0 | 1;
  const read = (value: DeepReadonly<Value>, bindings: Readonly<Record<string, readonly Readonly<CardObjectRef>[]>>, candidate?: Readonly<CardObjectRef>): Scalar => {
    if (value === null || typeof value !== "object") return value;
    const state = board(), parts = value.ref.split(".");
    if (parts[0] === "bindings") return bindings[parts[1]!]?.length ?? UNKNOWN;
    if (parts[0] === "SELF" || parts[0] === "OPPONENT") {
      const zones = state.players[seat(parts[0])]; return parts[1] === "lifeCount" ? zones.life.length : parts[1] === "handCount" ? zones.hand.length : UNKNOWN;
    }
    const ref = parts[0] === "SOURCE" ? identity.source : candidate; if (!ref) return UNKNOWN;
    try {
      const card = getCard(state, ref), field = parts[1];
      if (field === "rotated") return card.rotated;
      if (field === "cardType") return card.kind === "unknown" ? UNKNOWN : card.kind;
      if (field !== "cost" && field !== "power") return UNKNOWN;
      let number: unknown;
      if (card.cardId === definition.definition.cardId) {
        if (card.kind !== definition.definition.cardType || card.modifierIds.length || card.grantIds.length) return UNKNOWN;
        if (field === "power" && state.players.some(zones => zones.attachedDon.some(id => state.cards[id!]!.attachedTo?.instanceId === card.instanceId))) return UNKNOWN;
        number = definition.definition.baseStats[field];
      } else number = masterCardFacts(state, card, facts)[field];
      return typeof number === "number" && Number.isSafeInteger(number) ? number : UNKNOWN;
    } catch { return UNKNOWN; }
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
    candidates: selector => {
      const state = board();
      return state.players[seat(selector.owner)][selector.zone].flatMap(id => {
        if (id === null) return [];
        const card = state.cards[id]!, at = location(state, id);
        const viewers = ([0, 1] as const).filter(viewer => visibleTo(state, card, at, viewer));
        const visible = selector.visibility === "PUBLIC" ? card.faceUp && viewers.length === 2 :
          at.zone === "hand" && card.owner === identity.actor && card.controller === identity.actor && viewers.length === 1 && viewers[0] === identity.actor;
        if (card.owner !== seat(selector.owner) || card.controller !== seat(selector.controller) || !visible || !selector.cardTypes.some(type => type === card.kind)) return [];
        return [{ ref: { instanceId: id, generation: card.generation }, cardId: card.cardId, owner: card.owner, controller: card.controller, zone: at.zone, kind: card.kind, faceUp: card.faceUp, visibleTo: viewers }];
      });
    },
  };
}
