import { CostError, costSnapshot, createCostRuntimeRegistry, ensureCost, freezeCost, validateRequirement } from "./costs";
import type { CostCard, CostChoice, CostInput, CostOperation, CostPreparation, CostRegistries, CostRequirement, CostSnapshot, ResourceCostPlan } from "./costTypes";
import { createSelectorRuntimeRegistry, prepareSelector, seat, selectionId, SelectionError, validateSnapshot } from "./selectors";
import { createPredicateRuntimeRegistry } from "./predicates";
import type { CardObjectRef, DeepReadonly, Evaluation, Predicate, SelectorMap } from "./types";

export const COST_LIMITS = Object.freeze({ costs: 16, resources: 128, matchingWork: 32768 });
type Group = { index: number; requirement: CostRequirement; min: number; max: number; candidates: CostCard[]; excluded: string[]; chosen: readonly Readonly<CardObjectRef>[] | undefined };
const reference = (card: CostCard): Readonly<CardObjectRef> => Object.freeze({ instanceId: card.instanceId, generation: card.generation });
function registries(): CostRegistries { return { costs: createCostRuntimeRegistry(), selectors: createSelectorRuntimeRegistry(), predicates: createPredicateRuntimeRegistry() }; }
function eligible(card: CostCard, requirement: CostRequirement): Evaluation<boolean> {
  if (requirement.operation === "reveal") return { state: "known", value: card.zone === "hand" && card.kind !== "don" };
  if (card.kind === "unknown") return { state: "unknown", reason: "cost-card-type-unavailable" };
  if (requirement.operation === "rest") return { state: "known", value: !card.rotated && (card.kind === "don" ? card.zone === "activeDon" : ["leader", "character", "stage"].includes(card.zone)) };
  const to = requirement.destination!.zone;
  return { state: "known", value: card.kind === "don" ? to === "donDeck" && ["activeDon", "restDon"].includes(card.zone) :
    to === "trash" ? ["hand", "character", "stage"].includes(card.zone) : to === "hand" && ["character", "stage"].includes(card.zone) };
}
function choices(input: CostInput): ReadonlyMap<number, CostChoice> {
  const result = new Map<number, CostChoice>();
  ensureCost(Array.isArray(input.choices ?? []) && (input.choices?.length ?? 0) <= COST_LIMITS.costs, "invalid-cost-choices");
  for (const choice of input.choices ?? []) {
    ensureCost(choice && Number.isSafeInteger(choice.costIndex) && choice.costIndex >= 0 && choice.costIndex < input.costs.length && !result.has(choice.costIndex) && Array.isArray(choice.cards) && choice.cards.length <= COST_LIMITS.resources, "invalid-cost-choice");
    const ids = new Set<string>();
    for (const card of choice.cards) {
      ensureCost(card && Number.isSafeInteger(card.generation) && card.generation >= 0, "invalid-cost-reference"); selectionId(card.instanceId);
      ensureCost(!ids.has(card.instanceId), "duplicate-cost-reference"); ids.add(card.instanceId);
    }
    result.set(choice.costIndex, choice);
  }
  return result;
}
function canAllocate(groups: Group[], used: ReadonlySet<string>): boolean {
  // Augmenting paths avoid greedy false failures across overlapping groups.
  const pending = groups.filter(group => group.chosen === undefined);
  ensureCost(pending.reduce((total, group) => total + group.min, used.size) <= COST_LIMITS.resources, "cost-plan-resource-limit");
  const slots: readonly string[][] = pending.flatMap(group => Array.from({ length: group.min }, () => group.candidates.map(card => card.instanceId).filter(id => !used.has(id))));
  const owner = new Map<string, number>(); let work = 0;
  function assign(slot: number, seen: Set<string>): boolean {
    for (const id of slots[slot]!) {
      if (seen.has(id)) continue;
      if (++work > COST_LIMITS.matchingWork) throw new CostError("cost-matching-budget-exceeded");
      seen.add(id);
      const previous = owner.get(id);
      if (previous === undefined || assign(previous, seen)) { owner.set(id, slot); return true; }
    }
    return false;
  }
  return slots.every((_slot, index) => assign(index, new Set()));
}
function requestSelector(group: Group, used: ReadonlySet<string>): DeepReadonly<SelectorMap["cards"]> {
  const excluded = new Set(group.excluded);
  for (const card of group.candidates) if (used.has(card.instanceId)) excluded.add(card.instanceId);
  if (!excluded.size) return group.requirement.selector;
  const conditions: DeepReadonly<Predicate>[] = [];
  if (group.requirement.selector.exclude) conditions.push(group.requirement.selector.exclude);
  conditions.push({ kind: "compare", operator: "IN", left: { kind: "ref", from: "TARGET", field: "id" }, right: { kind: "literal", value: [...excluded] } });
  return { ...group.requirement.selector, exclude: { kind: "any", conditions } };
}

export function planCosts(input: CostInput, runtime: CostRegistries = registries()): CostPreparation {
  seat(input.actor); selectionId(input.resolutionId);
  ensureCost(input.semantics === "independent" || input.semantics === "ordered", "cost-semantics-must-be-explicit");
  if (input.semantics === "ordered") return { state: "unsupported", reason: "ordered-costs-not-supported" };
  ensureCost(Array.isArray(input.costs) && input.costs.length <= COST_LIMITS.costs, "cost-count-limit");
  const snapshot = costSnapshot(input.snapshot), supplied = choices(input);
  runtime.costs.seal(); runtime.selectors.seal(); runtime.predicates.seal();
  const current = new Map(snapshot.cards.map(card => [card.instanceId, card]));
  const groups: Group[] = [];
  try {
    for (let index = 0; index < input.costs.length; index++) {
      const cost = input.costs[index]!;
      const handler = runtime.costs.get(cost.kind); ensureCost(handler, "unknown-runtime-cost");
      const requirement = handler(cost, { actor: input.actor, snapshot }); validateRequirement(requirement, { actor: input.actor, snapshot });
      const prepared = prepareSelector(requirement.selector, input.actor, snapshot, runtime.selectors, runtime.predicates);
      if (prepared.state === "unknown") return { state: "unknown", reason: prepared.reason };
      ensureCost(prepared.value.kind === "cards" && prepared.value.chooser === input.actor, "invalid-cost-selector-result");
      const plan = prepared.value, candidates: CostCard[] = [], excluded: string[] = [];
      for (const ref of plan.candidates) {
        const card = current.get(ref.instanceId)!;
        if (card.owner !== input.actor || card.controller !== input.actor) { excluded.push(card.instanceId); continue; }
        const result = eligible(card, requirement);
        if (result.state === "unknown") return { state: "unknown", reason: result.reason };
        if (result.value) candidates.push(card); else excluded.push(card.instanceId);
      }
      if (candidates.length < plan.min) return { state: "unavailable", reason: "insufficient-cost-candidates" };
      if (plan.mode === "ALL" && excluded.length) return { state: "unavailable", reason: "all-cost-has-illegal-candidates" };
      const chosen = supplied.get(index)?.cards ?? (plan.mode === "ALL" ? candidates.map(reference) : undefined);
      if (chosen !== undefined) {
        ensureCost(chosen.length >= plan.min && chosen.length <= plan.max, "wrong-cost-selection-count");
        const eligibleIds = new Set(candidates.map(card => card.instanceId));
        for (const ref of chosen) ensureCost(eligibleIds.has(ref.instanceId) && current.get(ref.instanceId)!.generation === ref.generation, "illegal-or-stale-cost-card");
        if (plan.mode === "ALL" || plan.mode === "ORDER") ensureCost(chosen.length === candidates.length, "cost-must-select-full-set");
      }
      groups.push({ index, requirement, min: plan.min, max: plan.max, candidates, excluded, chosen });
    }
  } catch (error) {
    if (error instanceof SelectionError && error.code === "insufficient-candidates") return { state: "unavailable", reason: "insufficient-cost-candidates" };
    if (error instanceof CostError && error.code.startsWith("unsupported-")) return { state: "unsupported", reason: error.code };
    throw error;
  }
  const used = new Set<string>();
  for (const group of groups) for (const card of group.chosen ?? []) {
    if (used.has(card.instanceId)) return { state: "unavailable", reason: "cost-resource-used-more-than-once" };
    used.add(card.instanceId);
  }
  if (!canAllocate(groups, used)) return { state: "unavailable", reason: "combined-costs-cannot-be-allocated" };
  const pending = groups.filter(group => group.chosen === undefined);
  if (pending.length) return freezeCost({ state: "selectionRequired", requests: pending.map(group => ({ costIndex: group.index, selector: structuredClone(requestSelector(group, used)) })) });
  const operations: CostOperation[] = [], resources: Readonly<CardObjectRef>[] = [];
  const bindings: Record<string, readonly Readonly<CardObjectRef>[]> = Object.create(null);
  for (const group of groups) {
    const chosen = group.chosen!;
    const ids = new Set(chosen.map(ref => ref.instanceId));
    const refs = group.requirement.selector.mode === "ORDER" ? chosen.map(ref => reference(current.get(ref.instanceId)!)) : group.candidates.filter(card => ids.has(card.instanceId)).map(reference);
    if (group.requirement.saveAs !== undefined) {
      ensureCost(!Object.hasOwn(bindings, group.requirement.saveAs), "duplicate-cost-binding"); bindings[group.requirement.saveAs] = refs;
    }
    for (const card of refs) {
      resources.push(card);
      operations.push(group.requirement.operation === "move" ? { costIndex: group.index, kind: "move", card, destination: structuredClone(group.requirement.destination!), cause: "COST_PAYMENT" } : { costIndex: group.index, kind: group.requirement.operation, card });
    }
  }
  return freezeCost({ state: "planned", plan: { status: "resourcePlan", matchId: snapshot.matchId, revision: snapshot.revision, resolutionId: input.resolutionId, actor: input.actor, operations, resources, bindings } });
}

// Holds a resource plan, not a paid receipt. A movement transaction is still needed.
export class CostPlanSession {
  readonly #input: Omit<CostInput, "snapshot">;
  readonly #runtime: CostRegistries;
  readonly #plan: ResourceCostPlan;
  readonly #fingerprint: string;
  private constructor(input: CostInput, runtime: CostRegistries, plan: ResourceCostPlan) {
    this.#input = { resolutionId: input.resolutionId, actor: input.actor, semantics: input.semantics, costs: freezeCost(structuredClone(input.costs)), choices: freezeCost(structuredClone(input.choices ?? [])) };
    this.#runtime = Object.freeze({ ...runtime }); this.#plan = plan; this.#fingerprint = this.fingerprint(plan, input.snapshot);
  }
  static prepare(input: CostInput, runtime: CostRegistries = registries()): Exclude<CostPreparation, { state: "planned" }> | CostPlanSession {
    const result = planCosts(input, runtime);
    return result.state === "planned" ? new CostPlanSession(input, runtime, result.plan) : result;
  }
  toJSON(): never { throw new CostError("server-only-cost-plan"); }
  private fingerprint(plan: ResourceCostPlan, snapshot: CostSnapshot): string {
    const cards = validateSnapshot(snapshot);
    return JSON.stringify({ plan, before: plan.resources.map(ref => {
      const card = cards.get(ref.instanceId) as CostCard;
      return { id: card.instanceId, generation: card.generation, owner: card.owner, controller: card.controller, zone: card.zone, cardId: card.cardId, faceUp: card.faceUp, kind: card.kind, rotated: card.rotated };
    }) });
  }
  validateForCommit(snapshot: CostSnapshot): ResourceCostPlan {
    ensureCost(snapshot.matchId === this.#plan.matchId && snapshot.revision === this.#plan.revision, "stale-cost-plan");
    const result = planCosts({ ...this.#input, snapshot }, this.#runtime);
    ensureCost(result.state === "planned", "cost-plan-no-longer-valid");
    ensureCost(this.fingerprint(result.plan, snapshot) === this.#fingerprint, "cost-payment-source-changed");
    return result.plan;
  }
}
