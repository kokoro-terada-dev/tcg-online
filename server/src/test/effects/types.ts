export type PlayerRef = "SELF" | "OPPONENT";
export type ZoneRef = "deck" | "hand" | "life" | "character" | "leader" | "stage" | "donDeck" | "activeDon" | "restDon" | "trash" | "public" | "resolving";
export type Scalar = string | number | boolean | null;
export type Value =
  | { kind: "literal"; value: Scalar | Scalar[] }
  | { kind: "ref"; from: PlayerRef; field: "lifeCount" | "handCount" | "characterCount" }
  | { kind: "ref"; from: "SOURCE" | "TARGET" | "EVENT_SOURCE"; field: "id" | "name" | "type" | "cost" | "power" | "traits" | "attributes" | "colors" | "abilities" | "zone" | "rotated" | "enteredTurn" }
  | { kind: "ref"; from: "GAME"; field: "turnNumber" | "activePlayer" | "phase" }
  | { kind: "ref"; from: "EVENT"; field: "type" | "cause" | "controller" | "sourceId" }
  | { kind: "ref"; from: "VARIABLE"; name: string };
export type Comparison = "EQ" | "NEQ" | "GT" | "GTE" | "LT" | "LTE" | "IN" | "NOT_IN" | "CONTAINS";

// Declaration merging extends each map while preserving discriminated unions.
export interface TriggerMap {
  event: { kind: "event"; event: "onPlay" | "onAttack" | "onKo" | "turnStart" | "turnEnd" };
  activate: { kind: "activate"; window: "main" | "counter" | "trigger" };
}
export interface PredicateMap {
  compare: { kind: "compare"; operator: Comparison; left: Value; right: Value };
  exists: { kind: "exists"; value: Value };
  all: { kind: "all"; conditions: Predicate[] };
  any: { kind: "any"; conditions: Predicate[] };
  not: { kind: "not"; condition: Predicate };
}
export interface SelectorMap {
  cards: {
    kind: "cards"; chooser: PlayerRef; owner: PlayerRef | "ANY"; controller?: PlayerRef | "ANY";
    zones: ZoneRef[]; min: number; max: number; mode: "SELECT" | "RANDOM" | "BLIND_SELECT" | "ALL" | "ORDER";
    condition?: Predicate; exclude?: Predicate;
  };
  choice: { kind: "choice"; chooser: PlayerRef; options: { id: string; label: string }[] };
}
export type Destination = { zone: ZoneRef; owner: PlayerRef; position: "top" | "bottom" | "append" | "firstEmpty"; visibility: "faceUp" | "faceDown" };
export type MoveCause = "BATTLE_KO" | "EFFECT_KO" | "EFFECT_MOVE" | "COST_PAYMENT" | "RULE_PROCESSING" | "DAMAGE" | "OTHER";
export interface CostMap {
  payDon: { kind: "payDon"; amount: number };
  moveCards: { kind: "moveCards"; selector: SelectorMap["cards"]; destination: Destination; saveAs?: string };
  restCards: { kind: "restCards"; selector: SelectorMap["cards"]; saveAs?: string };
  revealCards: { kind: "revealCards"; selector: SelectorMap["cards"]; saveAs?: string };
}
export interface ModifierMap { power: { kind: "power"; target: Value; amount: number } }
export interface DurationMap {
  thisTurn: { kind: "thisTurn" };
  nextOpponentTurnEnd: { kind: "nextOpponentTurnEnd" };
  permanent: { kind: "permanent" };
}
export interface RestrictionMap { forbid: { kind: "forbid"; target: Value; operation: "attack" | "activate" | "move" } }
export interface ReplacementMap { replaceMove: { kind: "replaceMove"; condition: Predicate; actions: Action[] } }
export interface ActionMap {
  draw: { kind: "draw"; player: PlayerRef; amount: number; saveAs?: string };
  select: { kind: "select"; selector: Selector; saveAs: string };
  move: { kind: "move"; cards: Value; destination: Destination; cause: MoveCause; saveAs?: string };
  sequence: { kind: "sequence"; actions: Action[] };
  if: { kind: "if"; condition: Predicate; then: Action[]; else: Action[] };
  optional: { kind: "optional"; player: PlayerRef; actions: Action[] };
  repeat: { kind: "repeat"; count: number; actions: Action[] };
  modify: { kind: "modify"; modifier: Modifier; duration: Duration };
  installRestriction: { kind: "installRestriction"; restriction: Restriction; duration: Duration };
  installReplacement: { kind: "installReplacement"; replacement: Replacement; duration: Duration };
}
export type Trigger = TriggerMap[keyof TriggerMap];
export type Predicate = PredicateMap[keyof PredicateMap];
export type Selector = SelectorMap[keyof SelectorMap];
export type Cost = CostMap[keyof CostMap];
export type Modifier = ModifierMap[keyof ModifierMap];
export type Duration = DurationMap[keyof DurationMap];
export type Restriction = RestrictionMap[keyof RestrictionMap];
export type Replacement = ReplacementMap[keyof ReplacementMap];
export type Action = ActionMap[keyof ActionMap];
export interface CategoryMaps {
  trigger: TriggerMap; predicate: PredicateMap; selector: SelectorMap; cost: CostMap;
  action: ActionMap; replacement: ReplacementMap; modifier: ModifierMap; duration: DurationMap; restriction: RestrictionMap;
}
export type Category = keyof CategoryMaps;
export type NodeFor<C extends Category> = CategoryMaps[C][keyof CategoryMaps[C]];
export type BindingType = "cards" | "choice" | "result";
export type Scope = { bindings: Map<string, BindingType>; targetAllowed: boolean };
export type EffectDefinition = {
  dslVersion: 1; effectId: string; cardId: string; trigger: Trigger;
  condition?: Predicate; costs: Cost[]; actions: Action[];
};
export type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
export type ValidatedDefinition = { status: "schemaOnly"; definition: DeepReadonly<EffectDefinition>; estimatedSteps: number };

// Runtime evaluators must distinguish unknown information from false or zero.
export type Evaluation<T> = { state: "known"; value: T } | { state: "unknown"; reason: string };
export type CardObjectRef = { instanceId: string; generation: number };
export type PendingSelection = {
  selectionId: string; resolutionId: string; player: 0 | 1; revision: number;
  min: number; max: number; answered: boolean;
};
