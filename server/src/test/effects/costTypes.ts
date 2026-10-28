import type { CardObjectRef, Cost, DeepReadonly, Destination, SelectorMap } from "./types";
import type { SelectionCard, SelectionSnapshot, Seat } from "./selectionTypes";
import type { PredicateRuntimeRegistry } from "./predicates";
import type { SelectorRuntimeRegistry } from "./selectors";

export type CostCard = SelectionCard & Readonly<{ kind: "leader" | "character" | "event" | "stage" | "don" | "unknown"; rotated: boolean }>;
export type CostSnapshot = Omit<SelectionSnapshot, "cards"> & Readonly<{ cards: readonly CostCard[] }>;
export type CostOperation = Readonly<{ costIndex: number }> & (
  | Readonly<{ kind: "rest"; card: Readonly<CardObjectRef> }>
  | Readonly<{ kind: "move"; card: Readonly<CardObjectRef>; destination: DeepReadonly<Destination>; cause: "COST_PAYMENT" }>
  | Readonly<{ kind: "reveal"; card: Readonly<CardObjectRef> }>);
export type CostRequirement = Readonly<{
  selector: DeepReadonly<SelectorMap["cards"]>; operation: "rest" | "move" | "reveal";
  destination?: DeepReadonly<Destination>; saveAs?: string;
}>;
export type CostContext = Readonly<{ actor: Seat; snapshot: CostSnapshot }>;
export type CostHandler<T> = (cost: DeepReadonly<T>, context: CostContext) => CostRequirement;
export type CostChoice = Readonly<{ costIndex: number; cards: readonly Readonly<CardObjectRef>[] }>;
export type CostInput = Readonly<{
  resolutionId: string; actor: Seat; semantics: "independent" | "ordered";
  costs: readonly DeepReadonly<Cost>[]; snapshot: CostSnapshot; choices?: readonly CostChoice[];
}>;
export type CostRegistries = Readonly<{ costs: CostRuntimeRegistryContract; selectors: SelectorRuntimeRegistry; predicates: PredicateRuntimeRegistry }>;
export interface CostRuntimeRegistryContract {
  get(kind: string): CostHandler<Cost> | undefined;
  seal(): void;
}
export type CostRequest = Readonly<{ costIndex: number; selector: DeepReadonly<SelectorMap["cards"]> }>;
export type ResourceCostPlan = Readonly<{
  status: "resourcePlan"; matchId: string; resolutionId: string; revision: number; actor: Seat;
  operations: readonly CostOperation[]; resources: readonly Readonly<CardObjectRef>[];
  // These are pre-payment references; movement must produce after-generation results.
  bindings: Readonly<Record<string, readonly Readonly<CardObjectRef>[]>>;
}>;
export type CostPreparation =
  | Readonly<{ state: "planned"; plan: ResourceCostPlan }>
  | Readonly<{ state: "selectionRequired"; requests: readonly CostRequest[] }>
  | Readonly<{ state: "unknown"; reason: string }>
  | Readonly<{ state: "unavailable"; reason: string }>
  | Readonly<{ state: "unsupported"; reason: string }>;
