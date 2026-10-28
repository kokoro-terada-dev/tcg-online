import type { CardObjectRef, DeepReadonly, Evaluation, Selector, SelectorMap } from "./types";
import type { Facts, FactRecord } from "./facts";
import type { EvaluationBudget, PredicateRuntimeRegistry } from "./predicates";

export type Seat = 0 | 1;
export type SelectionCard = Readonly<CardObjectRef & {
  owner: Seat; controller: Seat; zone: SelectorMap["cards"]["zones"][number];
  cardId: string; faceUp: boolean; facts: FactRecord;
}>;
export type SelectionSnapshot = Readonly<{ matchId: string; revision: number; cards: readonly SelectionCard[]; facts: Facts }>;
export type PreparedCards = Readonly<{
  kind: "cards"; chooser: Seat; mode: SelectorMap["cards"]["mode"];
  min: number; max: number; filtered: boolean; examined: readonly Readonly<CardObjectRef>[]; candidates: readonly Readonly<CardObjectRef>[];
}>;
export type PreparedChoice = Readonly<{ kind: "choice"; chooser: Seat; options: readonly Readonly<{ id: string; label: string }>[] }>;
export type PreparedSelection = PreparedCards | PreparedChoice;
export type SelectorContext = Readonly<{
  actor: Seat; snapshot: SelectionSnapshot; predicates: PredicateRuntimeRegistry; budget: EvaluationBudget;
}>;
export type SelectorHandler<T> = (selector: DeepReadonly<T>, context: SelectorContext) => Evaluation<PreparedSelection>;
export type SelectionIdentity = Readonly<{ matchId: string; resolutionId: string; selectionId: string; revision: number }>;
export type Disclosure = Readonly<{
  revealToChooser?: readonly Readonly<CardObjectRef>[];
  allowFilteredBlindSelection?: boolean;
}>;
export type SelectionView = SelectionIdentity & (
  { kind: "cards"; chooser: Seat; mode: "SELECT" | "BLIND_SELECT" | "ORDER"; min: number; max: number; candidates: readonly Readonly<{ token: string; cardId: string | null }>[] } |
  { kind: "choice"; chooser: Seat; options: readonly Readonly<{ token: string; label: string }>[] }
);
// Results are server-only. They must never be serialized as a player's view.
export type SelectionResult = Readonly<{ kind: "cards"; cards: readonly Readonly<CardObjectRef>[] }> | Readonly<{ kind: "choice"; optionId: string }>;
export type SelectionReply = SelectionIdentity & Readonly<{ tokens: readonly string[] }>;
export type SelectionInput = Readonly<{
  matchId: string; resolutionId: string; actor: Seat;
  selector: DeepReadonly<Selector>; snapshot: SelectionSnapshot; disclosure?: Disclosure;
}>;
