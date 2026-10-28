import type { DeepReadonly } from "../types";
export type Player = "SELF" | "OPPONENT";
export type DonZone = "activeDon" | "restDon" | "attachedDon";
export type SourceSpan = { start: number; end: number };
export type NodeMeta = { id?: string; sourceSpan?: SourceSpan };
export type CardField = "cost" | "power" | "cardType" | "rotated";
export type Value = number | string | boolean | null | { ref: "SELF.lifeCount" | "SELF.handCount" | "OPPONENT.lifeCount" | "OPPONENT.handCount" | `SOURCE.${CardField}` | `CANDIDATE.${CardField}` | `bindings.${string}.count` };
export type CardSetRef = { ref: `bindings.${string}` };
// Declaration merging extends the typed vocabulary; parsers must also be registered.
export interface PredicateMap {
  all: NodeMeta & { type: "all"; conditions: Predicate[] };
  any: NodeMeta & { type: "any"; conditions: Predicate[] };
  not: NodeMeta & { type: "not"; condition: Predicate };
  compare: NodeMeta & { type: "compare"; left: Value; op: "eq" | "ne" | "lt" | "lte" | "gt" | "gte"; right: Value };
}
export interface ActionMap {
  DRAW: NodeMeta & { type: "DRAW"; player: Player; count: number };
  SEQUENCE: NodeMeta & { type: "SEQUENCE"; actions: Action[] };
  IF: NodeMeta & { type: "IF"; condition: Predicate; then: Action[]; else: Action[] };
  SELECT: NodeMeta & { type: "SELECT"; selector: Node<"selector">; bindAs: string };
  MOVE_CARD: NodeMeta & { type: "MOVE_CARD"; cards: CardSetRef; destination: { owner: Player; zone: "hand" | "trash" | "deck"; position: "append" | "top" | "bottom"; faceUp: boolean }; cause: "EFFECT" };
  KO: NodeMeta & { type: "KO"; cards: CardSetRef };
  REST: NodeMeta & { type: "REST"; cards: CardSetRef };
  SET_ACTIVE: NodeMeta & { type: "SET_ACTIVE"; cards: CardSetRef };
}
export interface CostMap {
  DON_RETURN: NodeMeta & { type: "DON_RETURN"; count: number; from: DonZone[] };
  REST_SOURCE: NodeMeta & { type: "REST_SOURCE" };
  REST_DON: NodeMeta & { type: "REST_DON"; count: number };
  DISCARD_HAND: NodeMeta & { type: "DISCARD_HAND"; count: number };
}
export interface ReplacementMap {}
export interface SelectorMap {
  CARDS: NodeMeta & {
    type: "CARDS"; owner: Player; controller: Player;
    cardTypes: ("leader" | "character" | "event" | "stage" | "don")[];
    filters: Predicate; excludeSource: boolean;
    min: number; max: number; selectionMode: "SELECT";
    chooser: Player; order: "UNORDERED"; onInsufficient: "fail";
  } & ({ zone: "leader" | "character" | "stage" | "trash" | "public"; visibility: "PUBLIC"; faceUpOnly: true } |
    { zone: DonZone | DonZone[]; visibility: "PUBLIC"; faceUpOnly: true; owner: "SELF"; controller: "SELF"; chooser: "SELF" } |
    { zone: "hand"; visibility: "OWNER_ONLY"; faceUpOnly: false; owner: "SELF"; controller: "SELF"; chooser: "SELF" });
}
export interface DurationMap {}
export interface TimingMap { MAIN: NodeMeta & { type: "MAIN" } }
export interface Categories { predicate: PredicateMap; action: ActionMap; cost: CostMap; replacement: ReplacementMap; selector: SelectorMap; duration: DurationMap; timing: TimingMap }
export type Category = keyof Categories;
export type Node<C extends Category> = Categories[C][keyof Categories[C]];
export type Predicate = Node<"predicate">;
export type Action = Node<"action">;
export type Effect = {
  id: string; kind: "activated"; timing: Node<"timing">;
  sourceZones: ("leader" | "character" | "stage")[]; optional: false;
  activationConditions: Predicate; resolutionConditions: Predicate; costs: Node<"cost">[]; actions: Action[];
};
export type CardDefinition = {
  schemaVersion: "3.0.0-subset.8"; cardId: string; cardVersion: string;
  name: string; cardType: "leader" | "character" | "stage";
  baseStats: { cost: number | null; power: number | null; counter: number | null; life: number | null };
  colors: string[]; traits: string[]; attributes: string[];
  reviewStatus: "needs_review" | "unsupported" | "approved";
  source: { text: string; triggerText: string; displayIds: string[]; datasetSha256: string }; effects: Effect[];
};
export type CompiledCard = DeepReadonly<{
  status: "compiled_not_executable"; compilerVersion: string; registryHash: string;
  definitionHash: string; sourceHash: string; definition: CardDefinition; requiredHandlers: string[];
}>;
