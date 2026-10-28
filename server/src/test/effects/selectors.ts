import { known, unknown } from "./facts";
import type { FactRecord, FactValue } from "./facts";
import { createPredicateRuntimeRegistry, createEvaluationBudget, evaluateCondition } from "./predicates";
import type { PredicateRuntimeRegistry } from "./predicates";
import type { DeepReadonly, Evaluation, Predicate, Selector, SelectorMap } from "./types";
import type { PreparedSelection, SelectorContext, SelectorHandler, SelectionSnapshot, Seat, SelectionCard } from "./selectionTypes";
import { ZONES } from "./validation";

export class SelectionError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "SelectionError"; }
}
export function ensureSelection(condition: unknown, code: string): asserts condition { if (!condition) throw new SelectionError(code); }
export function seat(value: unknown): asserts value is Seat { ensureSelection(value === 0 || value === 1, "invalid-seat"); }
export function selectionId(value: unknown): asserts value is string { ensureSelection(typeof value === "string" && Boolean(value.trim()) && value.length <= 100 && !/[\x00-\x1f]/.test(value), "invalid-id"); }
const relative = (value: "SELF" | "OPPONENT", actor: Seat): Seat => value === "SELF" ? actor : (1 - actor) as Seat;

export function validateSnapshot(snapshot: SelectionSnapshot): ReadonlyMap<string, SelectionCard> {
  ensureSelection(snapshot && Number.isSafeInteger(snapshot.revision) && snapshot.revision >= 0 && Array.isArray(snapshot.cards) && snapshot.cards.length <= 256, "invalid-snapshot");
  selectionId(snapshot.matchId);
  const cards = new Map<string, SelectionCard>();
  for (const card of snapshot.cards) {
    ensureSelection(card && typeof card === "object", "invalid-card");
    selectionId(card.instanceId); selectionId(card.cardId); seat(card.owner); seat(card.controller);
    ensureSelection(Number.isSafeInteger(card.generation) && card.generation >= 0 && ZONES.includes(card.zone) && typeof card.faceUp === "boolean" && card.facts && typeof card.facts === "object" && !Array.isArray(card.facts), "invalid-card");
    ensureSelection(!cards.has(card.instanceId), "duplicate-card-instance");
    cards.set(card.instanceId, card);
  }
  return cards;
}
function targetFacts(card: SelectionCard): FactRecord {
  const result: Record<string, FactValue | undefined> = Object.create(null);
  for (const key of ["name", "type", "cost", "power", "traits", "attributes", "colors", "abilities", "rotated", "enteredTurn"]) {
    const descriptor = Object.getOwnPropertyDescriptor(card.facts, key);
    if (descriptor && Object.hasOwn(descriptor, "value")) result[key] = descriptor.value;
  }
  result.id = card.instanceId; result.zone = card.zone;
  return Object.freeze(result);
}

export class SelectorRuntimeRegistry {
  private readonly handlers = new Map<string, SelectorHandler<Selector>>();
  private sealed = false;
  register<K extends keyof SelectorMap & string>(kind: K, handler: SelectorHandler<SelectorMap[K]>): this {
    ensureSelection(!this.sealed && /^[A-Za-z][A-Za-z0-9_]*$/.test(kind) && !this.handlers.has(kind), "sealed-invalid-or-duplicate-selector-kind");
    this.handlers.set(kind, (node, ctx) => handler(node as DeepReadonly<SelectorMap[K]>, ctx));
    return this;
  }
  get(kind: string): SelectorHandler<Selector> | undefined { return this.handlers.get(kind); }
  seal(): void { this.sealed = true; }
}
export function createSelectorRuntimeRegistry(): SelectorRuntimeRegistry {
  return new SelectorRuntimeRegistry()
    .register("cards", (selector, context) => {
      const conditions: DeepReadonly<Predicate>[] = [];
      if (selector.condition) conditions.push(selector.condition);
      if (selector.exclude) conditions.push({ kind: "not", condition: selector.exclude });
      const condition: DeepReadonly<Predicate> | undefined = conditions.length ? { kind: "all", conditions } : undefined;
      const candidates = [], examined = [];
      for (const card of context.snapshot.cards) {
        context.budget.spend();
        if (!selector.zones.includes(card.zone)) continue;
        if (selector.owner !== "ANY" && card.owner !== relative(selector.owner, context.actor)) continue;
        if (selector.controller !== undefined && selector.controller !== "ANY" && card.controller !== relative(selector.controller, context.actor)) continue;
        const reference = Object.freeze({ instanceId: card.instanceId, generation: card.generation });
        examined.push(reference);
        const result = evaluateCondition(condition, { ...context.snapshot.facts, target: targetFacts(card) }, context.predicates, context.budget);
        if (result.state === "unknown") return unknown("candidate-condition-unavailable");
        if (result.value) candidates.push(reference);
      }
      return known({ kind: "cards", chooser: relative(selector.chooser, context.actor), mode: selector.mode, min: selector.min, max: selector.max, filtered: conditions.length > 0, examined: Object.freeze(examined), candidates: Object.freeze(candidates) });
    })
    .register("choice", (selector, context) => known({ kind: "choice", chooser: relative(selector.chooser, context.actor), options: Object.freeze(selector.options.map(option => Object.freeze({ ...option }))) }));
}

export function prepareSelector(selector: DeepReadonly<Selector>, actor: Seat, snapshot: SelectionSnapshot, registry = createSelectorRuntimeRegistry(), predicates: PredicateRuntimeRegistry = createPredicateRuntimeRegistry()): Evaluation<PreparedSelection> {
  seat(actor); validateSnapshot(snapshot); registry.seal(); predicates.seal();
  const handler = registry.get(selector.kind);
  ensureSelection(handler, "unknown-runtime-selector");
  const result = handler(selector, Object.freeze({ actor, snapshot, predicates, budget: createEvaluationBudget() }));
  ensureSelection(result && (result.state === "known" || (result.state === "unknown" && typeof result.reason === "string")), "invalid-selector-result");
  if (result.state === "unknown") return unknown(result.reason);
  const plan = result.value;
  ensureSelection(plan && typeof plan === "object", "invalid-selector-plan");
  seat(plan.chooser);
  if (plan.kind === "cards") {
    ensureSelection(["SELECT", "BLIND_SELECT", "RANDOM", "ALL", "ORDER"].includes(plan.mode) && typeof plan.filtered === "boolean", "invalid-selector-plan");
    ensureSelection(Number.isSafeInteger(plan.min) && Number.isSafeInteger(plan.max) && plan.min >= 0 && plan.min <= plan.max && plan.max <= 128, "invalid-cardinality");
    ensureSelection(Array.isArray(plan.candidates) && plan.candidates.length <= 128 && Array.isArray(plan.examined) && plan.examined.length <= 128, "candidate-limit-exceeded");
    const current = validateSnapshot(snapshot), ids = new Set();
    for (const candidate of plan.candidates) {
      ensureSelection(candidate && typeof candidate === "object", "invalid-candidate-reference");
      const card = current.get(candidate.instanceId);
      ensureSelection(card && card.generation === candidate.generation && !ids.has(candidate.instanceId), "invalid-candidate-reference");
      ids.add(candidate.instanceId);
    }
    const examined = new Set();
    for (const candidate of plan.examined) {
      ensureSelection(candidate && typeof candidate === "object", "invalid-examined-reference");
      const card = current.get(candidate.instanceId);
      ensureSelection(card && card.generation === candidate.generation && !examined.has(candidate.instanceId), "invalid-examined-reference");
      examined.add(candidate.instanceId);
    }
    for (const id of ids) ensureSelection(examined.has(id), "candidate-not-examined");
    ensureSelection(plan.candidates.length >= plan.min, "insufficient-candidates");
    if (plan.mode === "RANDOM") ensureSelection(plan.min === plan.max, "random-requires-exact-count");
    if (plan.mode === "ALL") ensureSelection(plan.candidates.length <= plan.max, "all-exceeds-cardinality");
    if (plan.mode === "ORDER") ensureSelection(plan.min === plan.max && plan.max === plan.candidates.length, "order-requires-full-set");
  } else if (plan.kind === "choice") {
    ensureSelection(Array.isArray(plan.options) && plan.options.length > 0 && plan.options.length <= 128, "invalid-choice-options");
    const ids = new Set();
    for (const option of plan.options) { ensureSelection(option && typeof option === "object", "invalid-choice-option"); selectionId(option.id); ensureSelection(!ids.has(option.id) && typeof option.label === "string" && option.label.length > 0 && option.label.length <= 200, "invalid-choice-option"); ids.add(option.id); }
  } else throw new SelectionError("unknown-selector-result-kind");
  return known(plan);
}
