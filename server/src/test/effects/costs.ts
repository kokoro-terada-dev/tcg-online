import type { Cost, CostMap, DeepReadonly, Predicate, SelectorMap } from "./types";
import type { CostContext, CostHandler, CostRequirement, CostSnapshot } from "./costTypes";
import { validateSnapshot } from "./selectors";

export class CostError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "CostError"; }
}
export function ensureCost(condition: unknown, code: string): asserts condition { if (!condition) throw new CostError(code); }
export function freezeCost<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freezeCost); Object.freeze(value); }
  return value;
}
export function costSnapshot(snapshot: CostSnapshot): CostSnapshot {
  validateSnapshot(snapshot);
  const cards = snapshot.cards.map(card => {
    ensureCost(["leader", "character", "event", "stage", "don", "unknown"].includes(card.kind) && typeof card.rotated === "boolean", "invalid-cost-card");
    if (["activeDon", "restDon", "donDeck"].includes(card.zone)) ensureCost(card.kind === "don", "invalid-don-zone");
    if (card.zone === "activeDon") ensureCost(!card.rotated, "active-don-is-rested");
    if (card.zone === "restDon") ensureCost(card.rotated, "rest-don-is-active");
    if (card.kind === "don") ensureCost(["activeDon", "restDon", "donDeck"].includes(card.zone), "attached-or-misplaced-don-not-supported");
    if (card.kind === "leader") ensureCost(card.zone === "leader", "invalid-leader-zone");
    for (const [zone, kind] of [["leader", "leader"], ["character", "character"], ["stage", "stage"]] as const) if (card.zone === zone && card.kind !== "unknown") ensureCost(card.kind === kind, "invalid-board-card-kind");
    const facts: Record<string, unknown> = Object.create(null);
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(card.facts))) if (Object.hasOwn(descriptor, "value")) facts[key] = descriptor.value;
    facts.type = card.kind === "unknown" ? null : card.kind; facts.rotated = card.rotated;
    return { ...card, facts: facts as typeof card.facts };
  });
  return freezeCost(structuredClone({ ...snapshot, cards }));
}
function all(...conditions: DeepReadonly<Predicate>[]): DeepReadonly<Predicate> { return { kind: "all", conditions }; }
const equals = (field: "type" | "rotated", value: string | boolean): DeepReadonly<Predicate> => ({ kind: "compare", operator: "EQ", left: { kind: "ref", from: "TARGET", field }, right: { kind: "literal", value } });
function scoped(selector: DeepReadonly<SelectorMap["cards"]>): DeepReadonly<SelectorMap["cards"]> {
  ensureCost(selector.owner === "SELF" && selector.chooser === "SELF" && (selector.controller === undefined || selector.controller === "SELF"), "unsupported-cost-owner-or-chooser");
  ensureCost(["SELECT", "ALL", "ORDER"].includes(selector.mode), "unsupported-cost-selection-mode");
  return { ...selector, controller: "SELF" };
}
function addCondition(selector: DeepReadonly<SelectorMap["cards"]>, condition: DeepReadonly<Predicate>): DeepReadonly<SelectorMap["cards"]> {
  return { ...selector, condition: selector.condition ? all(selector.condition, condition) : condition };
}

export class CostRuntimeRegistry {
  private readonly handlers = new Map<string, CostHandler<Cost>>();
  private sealed = false;
  register<K extends keyof CostMap & string>(kind: K, handler: CostHandler<CostMap[K]>): this {
    ensureCost(!this.sealed && /^[A-Za-z][A-Za-z0-9_]*$/.test(kind) && !this.handlers.has(kind), "sealed-invalid-or-duplicate-cost-kind");
    this.handlers.set(kind, (cost, context) => handler(cost as DeepReadonly<CostMap[K]>, context)); return this;
  }
  get(kind: string): CostHandler<Cost> | undefined { return this.handlers.get(kind); }
  seal(): void { this.sealed = true; }
}
export function createCostRuntimeRegistry(): CostRuntimeRegistry {
  return new CostRuntimeRegistry()
    .register("payDon", cost => {
      ensureCost(Number.isSafeInteger(cost.amount) && cost.amount >= 1 && cost.amount <= 128, "invalid-don-payment-amount");
      return { operation: "rest", selector: { kind: "cards", owner: "SELF", controller: "SELF", chooser: "SELF", zones: ["activeDon"], mode: "SELECT", min: cost.amount, max: cost.amount, condition: all(equals("type", "don"), equals("rotated", false)) } };
    })
    .register("restCards", cost => {
      const selector = scoped(cost.selector);
      ensureCost(selector.zones.every(zone => ["leader", "character", "stage", "activeDon"].includes(zone)), "unsupported-rest-cost-zone");
      return { operation: "rest", selector: addCondition(selector, equals("rotated", false)), ...(cost.saveAs === undefined ? {} : { saveAs: cost.saveAs }) };
    })
    .register("moveCards", cost => {
      const selector = scoped(cost.selector);
      ensureCost(cost.destination.owner === "SELF", "unsupported-cost-destination-owner");
      ensureCost(selector.zones.length > 0 && selector.zones.every(zone => ["hand", "character", "stage", "activeDon", "restDon"].includes(zone)), "unsupported-move-cost-source");
      ensureCost(["hand", "trash", "donDeck"].includes(cost.destination.zone), "unsupported-move-cost-destination");
      ensureCost(["top", "bottom", "append"].includes(cost.destination.position), "unsupported-cost-position");
      return { operation: "move", selector, destination: cost.destination, ...(cost.saveAs === undefined ? {} : { saveAs: cost.saveAs }) };
    })
    .register("revealCards", cost => {
      const selector = scoped(cost.selector);
      ensureCost(selector.zones.length === 1 && selector.zones[0] === "hand", "reveal-cost-requires-own-hand");
      return { operation: "reveal", selector, ...(cost.saveAs === undefined ? {} : { saveAs: cost.saveAs }) };
    });
}

export function validateRequirement(requirement: CostRequirement, context: CostContext): void {
  ensureCost(requirement && ["rest", "move", "reveal"].includes(requirement.operation), "invalid-cost-requirement");
  scoped(requirement.selector);
  if (requirement.operation === "move") ensureCost(requirement.destination, "missing-cost-destination");
  if (requirement.destination) ensureCost(requirement.destination.owner === "SELF" && ["hand", "trash", "donDeck"].includes(requirement.destination.zone) && ["top", "bottom", "append"].includes(requirement.destination.position) && ["faceUp", "faceDown"].includes(requirement.destination.visibility), "unsupported-cost-destination");
  if (requirement.saveAs !== undefined) ensureCost(/^[A-Za-z][A-Za-z0-9_.-]{0,99}$/.test(requirement.saveAs) && !["__proto__", "prototype", "constructor"].includes(requirement.saveAs), "invalid-cost-binding");
  ensureCost(context.actor === 0 || context.actor === 1, "invalid-cost-actor");
}
