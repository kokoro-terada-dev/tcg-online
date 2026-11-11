import type { DeepReadonly } from "../types";
export type Player = "SELF" | "OPPONENT";
export type PlayerScope = Player | "EITHER";
export const PUBLIC_FIELD_ZONES = ["leader", "character", "stage"] as const;
export type PublicFieldZone = typeof PUBLIC_FIELD_ZONES[number];
export type DonZone = "activeDon" | "restDon" | "attachedDon";
export type SourceSpan = { start: number; end: number };
export type NodeMeta = { id?: string; sourceSpan?: SourceSpan };
export type CardField = "cost" | "power" | "cardType" | "rotated" | "attachedDonCount";
export type MutableStat = "cost" | "power" | "counter";
export type ProtectionRule =
  { type: "RESTRICT"; policy: "CANNOT_TARGET" | "PREVENT_MOVE"; by: Player | "ANY" } |
  { type: "RESTRICT"; policy: "UNAFFECTED_BY"; by: "OPPONENT" } |
  { type: "RESTRICT"; policy: "CANNOT_KO"; by: Player | "ANY"; cause: "EFFECT" | "BATTLE"; sourceAttribute?: string };
export type ContinuousOperation = { type: "ADD_STAT"; stat: MutableStat; amount: number } |
  { type: "SET_BASE_STAT"; stat: "power" | "cost"; value: number } | { type: "GRANT_COUNTER"; value: number } |
  { type: "GRANT_KEYWORD"; keyword: Node<"keyword"> } | ProtectionRule;
export const DON_COUNT_SCOPES = ["fieldCount", "costAreaCount", "activeCount", "restCount", "attachedCount"] as const;
export type DonCountScope = typeof DON_COUNT_SCOPES[number];
export type DonCountRef = `${"SELF" | "OPPONENT"}.don.${DonCountScope}`;
export const PUBLIC_TRIGGER_COUNT_REFS = (["SELF", "OPPONENT"] as const).flatMap(side =>
  [`${side}.lifeCount`, `${side}.handCount`, ...DON_COUNT_SCOPES.map(scope => `${side}.don.${scope}`)]);
export type Value = number | string | boolean | null | { ref: "BOTH.lifeCount" | DonCountRef | "SELF.lifeCount" | "SELF.handCount" | "OPPONENT.lifeCount" | "OPPONENT.handCount" | `SOURCE.${CardField}` | `CANDIDATE.${CardField}` | `${CardSubject}.${"printed" | "base" | "current"}.${MutableStat}` | `bindings.${string}.count` };
export type CardSetRef = { ref: `bindings.${string}` };
export type SchemaVersion = "3.0.0-subset.16" | "3.0.0-subset.17" | "3.0.0-subset.18" | "3.0.0-subset.19" | "3.0.0-subset.20" | "3.0.0-subset.21" | "3.0.0-subset.22" | "3.0.0-subset.23" | "3.0.0-subset.24" | "3.0.0-subset.25" | "3.0.0-subset.26" | "3.0.0-subset.27" | "3.0.0-subset.28" | "3.0.0-subset.29" | "3.0.0-subset.30" | "3.0.0-subset.31" | "3.0.0-subset.32" | "3.0.0-subset.33" | "3.0.0-subset.34" | "3.0.0-subset.35" | "3.0.0-subset.36" | "3.0.0-subset.37" | "3.0.0-subset.38" | "3.0.0-subset.39" | "3.0.0-subset.40" | "3.0.0-subset.41" | "3.0.0-subset.42" | "3.0.0-subset.43" | "3.0.0-subset.44" | "3.0.0-subset.45" | "3.0.0-subset.46" | "3.0.0-subset.47" | "3.0.0-subset.48" | "3.0.0-subset.49" | "3.0.0-subset.50" | "3.0.0-subset.51" | "3.0.0-subset.52" | "3.0.0-subset.53" | "3.0.0-subset.54" | "3.0.0-subset.55" | "3.0.0-subset.56" | "3.0.0-subset.57" | "3.0.0-subset.58";
export type CardSubject = "SOURCE" | "CANDIDATE";
export type MetadataBasis = "PRINTED" | "CURRENT";
export type AbilityTag = "BLOCKER" | "RUSH" | "RUSH_CHARACTER" | "CANNOT_BE_BLOCKED" | "BANISH" | "DOUBLE_ATTACK" | "MAIN" | "ON_PLAY" | "ON_ATTACK" | "ON_OPPONENT_ATTACK" | "ON_KO" | "COUNTER" | "TRIGGER";
// Declaration merging extends the typed vocabulary; parsers must also be registered.
export interface PredicateMap {
  IS_SOURCE: NodeMeta & { type: "IS_SOURCE" };
  REMEMBERED_COLORS: NodeMeta & { type: "REMEMBERED_COLORS"; memory: string; subject: CardSubject; basis: MetadataBasis; match: "OVERLAP" | "DISJOINT" };
  MOVED_COLORS: NodeMeta & { type: "MOVED_COLORS"; result: string; subject: CardSubject; basis: MetadataBasis; match: "OVERLAP" | "DISJOINT" };
  TURN_IS: NodeMeta & { type: "TURN_IS"; player: Player };
  EXISTS: NodeMeta & { type: "EXISTS"; query: Node<"query"> };
  COUNT: NodeMeta & { type: "COUNT"; query: Node<"query">; op: "eq" | "ne" | "lt" | "lte" | "gt" | "gte"; value: number };
  CARD_NAME: NodeMeta & { type: "CARD_NAME"; subject: CardSubject; basis: MetadataBasis; op: "eq" | "ne"; value: string };
  CARD_METADATA: NodeMeta & { type: "CARD_METADATA"; subject: CardSubject; basis: MetadataBasis; field: "traits" | "colors" | "attributes";
    match: "ANY" | "ALL" | "NONE" | "EXACT"; comparison: "EXACT" | "CONTAINS"; values: string[] };
  HAS_ABILITY: NodeMeta & { type: "HAS_ABILITY"; subject: CardSubject; basis: "PRINTED" | "GRANTED" | "CURRENT"; ability: AbilityTag };
  all: NodeMeta & { type: "all"; conditions: Predicate[] };
  any: NodeMeta & { type: "any"; conditions: Predicate[] };
  not: NodeMeta & { type: "not"; condition: Predicate };
  compare: NodeMeta & { type: "compare"; left: Value; op: "eq" | "ne" | "lt" | "lte" | "gt" | "gte"; right: Value };
}
export interface ActionMap {
  PLAY_TRIGGER_SOURCE: NodeMeta & { type: "PLAY_TRIGGER_SOURCE" };
  EXTRA_TURN: NodeMeta & { type: "EXTRA_TURN" };
  KO_STAGE: NodeMeta & { type: "KO_STAGE"; cards: CardSetRef };
  MOVE_LIFE: NodeMeta & { type: "MOVE_LIFE"; player: Player } &
    ({ from: "DECK_TOP"; to: "LIFE_TOP" | "LIFE_BOTTOM"; faceUp: boolean } |
      { from: "BOUND"; cards: CardSetRef; to: "LIFE_TOP" | "LIFE_BOTTOM"; faceUp: boolean } |
      { from: "LIFE_TOP" | "LIFE_BOTTOM"; to: "HAND" | "TRASH" | "DECK_BOTTOM" });
  RETARGET_BATTLE: NodeMeta & { type: "RETARGET_BATTLE"; cards: CardSetRef };
  CALL_EFFECT_BODY: NodeMeta & { type: "CALL_EFFECT_BODY" } &
    ({ effectId: string; from?: never } | { from: "OWN_TRASH"; maxPrintedCost: number; effectId?: never });
  CONTINUOUS_EFFECT: NodeMeta & { type: "CONTINUOUS_EFFECT"; condition: Predicate; affectedQuery: Node<"query">; operation: ContinuousOperation };
  ORDER_THEN_MOVE: NodeMeta & { type: "ORDER_THEN_MOVE"; player: "OPPONENT"; chooser: "OPPONENT"; count: number; destination: "deckBottom" };
  DISCARD_BY_OWNER: NodeMeta & { type: "DISCARD_BY_OWNER"; player: "OPPONENT"; chooser: "OPPONENT"; count: number };
  CHOOSE_MODE: NodeMeta & { type: "CHOOSE_MODE"; modes: { label: string; actions: Action[] }[] };
  OFFER_PAYMENT: NodeMeta & { type: "OFFER_PAYMENT"; costs: Node<"cost">[]; bindAs: string };
  IF_PAYMENT_SUCCEEDED: NodeMeta & { type: "IF_PAYMENT_SUCCEEDED"; payment: string; then: Action[]; else: Action[] };
  ATTACH_DON: NodeMeta & { type: "ATTACH_DON"; from: "ACTIVE" | "REST"; assignments: { cards: CardSetRef; target: CardSetRef }[] };
  RETURN_DON_BY_EFFECT: NodeMeta & { type: "RETURN_DON_BY_EFFECT"; cards: CardSetRef; from: DonZone[] };
  SET_DON_STATE: NodeMeta & { type: "SET_DON_STATE"; cards: CardSetRef; from: "ACTIVE" | "REST"; to: "ACTIVE" | "REST" };
  ADD_DON: NodeMeta & { type: "ADD_DON"; player: "SELF"; count: number; state: "ACTIVE" | "REST"; onInsufficient: "fail" };
  ADD_DON_UP_TO: NodeMeta & { type: "ADD_DON_UP_TO"; player: "SELF"; max: number; state: "ACTIVE" | "REST" };
  PLAY_BY_EFFECT: NodeMeta & { type: "PLAY_BY_EFFECT"; cards: CardSetRef; from: "hand" | "trash" | "deck";
    destination: { owner: "SELF"; zone: "character"; slotPolicy: "FIRST_EMPTY" | "REPLACE_IF_FULL" }; enterState: "ACTIVE" | "REST"; provenance: "EFFECT"; condition: Predicate };
  REMEMBER_FACTS: NodeMeta & { type: "REMEMBER_FACTS"; result: string; cards: CardSetRef | null; snapshot: "BEFORE" | "AFTER"; basis: MetadataBasis; field: "colors"; bindAs: string };
  MOVE_RESULT: NodeMeta & { type: "MOVE_RESULT"; bindAs: string };
  BIND_SOURCE: NodeMeta & { type: "BIND_SOURCE"; bindAs: string };
  GRANT_KEYWORD: NodeMeta & { type: "GRANT_KEYWORD"; cards: CardSetRef; keyword: Node<"keyword">; duration: Node<"duration"> };
  SKIP_REFRESH: NodeMeta & { type: "SKIP_REFRESH"; cards: CardSetRef; duration: DurationMap["UNTIL_BOUNDARY"] };
  DISABLE_CARD_EFFECTS: NodeMeta & { type: "DISABLE_CARD_EFFECTS"; cards: CardSetRef };
  PREVENT_CHARACTER_PLAY: NodeMeta & { type: "PREVENT_CHARACTER_PLAY"; player: "SELF" };
  MODIFY_STAT: NodeMeta & { type: "MODIFY_STAT"; cards: CardSetRef; stat: "power" | "cost"; amount: number; duration: Node<"duration"> };
  LOOK_TOP: NodeMeta & { type: "LOOK_TOP"; player: "SELF"; count: number; bindAs: string; onInsufficient: "fail" | "takeAvailable" };
  TRASH_DECK_TOP: NodeMeta & { type: "TRASH_DECK_TOP"; count: number | { ref: "SOURCE.attachedDonCount" } };
  SHUFFLE_DECK: NodeMeta & { type: "SHUFFLE_DECK" };
  REVEAL: NodeMeta & { type: "REVEAL"; cards: CardSetRef; viewers: "BOTH" };
  ORDER_CARDS: NodeMeta & { type: "ORDER_CARDS"; cards: CardSetRef; excludeCards: CardSetRef | null; bindAs: string; chooser: "SELF" };
  RETURN_TO_DECK: NodeMeta & { type: "RETURN_TO_DECK"; cards: CardSetRef; player: "SELF"; position: "top" | "bottom" };
  DRAW: NodeMeta & { type: "DRAW"; player: Player; count: number };
  SEQUENCE: NodeMeta & { type: "SEQUENCE"; actions: Action[] };
  IF: NodeMeta & { type: "IF"; condition: Predicate; then: Action[]; else: Action[] };
  SELECT: NodeMeta & { type: "SELECT"; selector: Node<"selector">; bindAs: string; automatic?: "ALL" };
  MOVE_CARD: NodeMeta & { type: "MOVE_CARD"; cards: CardSetRef; excludeCards?: CardSetRef; destination: { owner: Player | "CARD_OWNER"; zone: "hand" | "trash" | "deck" | "public"; position: "append" | "top" | "bottom"; faceUp: boolean }; cause: "EFFECT" };
  KO: NodeMeta & { type: "KO"; cards: CardSetRef };
  REST: NodeMeta & { type: "REST"; cards: CardSetRef };
  SET_ACTIVE: NodeMeta & { type: "SET_ACTIVE"; cards: CardSetRef };
}
export interface CostMap {
  REVEAL_CARDS: NodeMeta & { type: "REVEAL_CARDS"; selector: SelectorMap["CARDS"]; confirmation?: "OPPONENT" };
  MOVE_AS_COST: NodeMeta & { type: "MOVE_AS_COST"; selector: "SOURCE" | SelectorMap["CARDS"]; destination: "trash" };
  DON_RETURN: NodeMeta & { type: "DON_RETURN"; count: number; from: DonZone[] };
  REST_SOURCE: NodeMeta & { type: "REST_SOURCE" };
  REST_AS_COST: NodeMeta & { type: "REST_AS_COST"; selector: SelectorMap["CARDS"] };
  LIFE_TOP_COST: NodeMeta & { type: "LIFE_TOP_COST"; operation: "TO_HAND" | "FACE_UP" | "FACE_DOWN" };
  REST_DON: NodeMeta & { type: "REST_DON"; count: number };
  DISCARD_HAND: NodeMeta & { type: "DISCARD_HAND"; count: number };
}
export interface ReplacementMap {
  REPLACE_EVENT: NodeMeta & {
    type: "REPLACE_EVENT"; id: string;
    match: { cause: "EFFECT_KO" | "EFFECT_MOVE"; by: "SELF" | "OPPONENT" | "ANY"; from: "character"; to: "trash" | "hand" | "deck" | "public" };
    condition: Predicate;
    target?: { type: "OWN_CHARACTER"; minPrintedCost: number };
    usageLimit?: "ONCE_PER_TURN";
  } & ({ substitute: { to: "hand" | "trash" }; optionalPayment?: never } |
    { substitute: { type: "PREVENT" }; optionalPayment: (Omit<CostMap["MOVE_AS_COST"], "selector"> & { selector: Extract<SelectorMap["CARDS"], { zone: "hand" }> }) |
      (CostMap["DON_RETURN"] & { count: 1 }) });
}
export interface QueryMap {
  QUERY_CARDS: NodeMeta & { type: "QUERY_CARDS"; owner: Player; controller: Player;
    cardTypes: ("leader" | "character" | "stage" | "event")[]; filters: Predicate; excludeSource: boolean;
  } & ({ zone: "leader" | "character" | "stage" | "trash" | "public"; visibility: "PUBLIC"; faceUpOnly: true } |
    { zone: "hand"; owner: "SELF"; controller: "SELF"; visibility: "OWNER_ONLY"; faceUpOnly: false });
}
export interface SelectorMap {
  BOUND_CARDS: NodeMeta & { type: "BOUND_CARDS"; cards: CardSetRef; excludeCards: CardSetRef | null;
    owner: "SELF"; controller: "SELF"; chooser: "SELF"; zone: "deck"; visibility: "OWNER_ONLY"; faceUpOnly: false;
    cardTypes: ("character" | "event" | "stage")[]; filters: Predicate; excludeSource: boolean; min: number; max: number;
    selectionMode: "SELECT"; order: "UNORDERED"; onInsufficient: "fail" };
  CARDS: NodeMeta & {
    type: "CARDS"; owner: PlayerScope; controller: PlayerScope;
    cardTypes: ("leader" | "character" | "event" | "stage" | "don")[];
    filters: Predicate; excludeSource: boolean;
    min: number; max: number; selectionMode: "SELECT";
    chooser: Player; order: "UNORDERED"; onInsufficient: "fail" | "skip";
  } & ({ zone: PublicFieldZone | PublicFieldZone[] | "trash" | "public"; visibility: "PUBLIC"; faceUpOnly: true } |
    { zone: DonZone | DonZone[]; visibility: "PUBLIC"; faceUpOnly: true; owner: "SELF"; controller: "SELF"; chooser: "SELF" } |
    { zone: "hand"; visibility: "OWNER_ONLY"; faceUpOnly: false; owner: "SELF"; controller: "SELF"; chooser: "SELF" });
}
export interface DurationMap {
  UNTIL_BOUNDARY: NodeMeta & { type: "UNTIL_BOUNDARY"; player: Player; boundary: "TURN_START" | "END_PHASE_END"; occurrence: 1 | 2; includeCurrent: boolean };
  TURN_END: NodeMeta & { type: "TURN_END"; player: Player; occurrence: 1 | 2 };
  BATTLE_END: NodeMeta & { type: "BATTLE_END" };
}
export interface TimingMap {
  ON_BLOCK: NodeMeta & { type: "ON_BLOCK" };
  MAIN_START: NodeMeta & { type: "MAIN_START"; player: Player };
  TURN_END: NodeMeta & { type: "TURN_END"; player: Player };
  ON_EVENT: NodeMeta & ({ type: "ON_EVENT"; event: "DON_RETURNED"; owner: Player; cause: "EFFECT_MOVE" | "COST_PAYMENT" | "ANY"; min: number } |
    { type: "ON_EVENT"; event: "CARD_ENTERED" | "CARD_KO" | "CARD_MOVED";
    snapshot: "TRANSACTION_BEFORE" | "TRANSACTION_AFTER"; relation: "SELF" | "OTHER" | "ANY";
    owner: Player | "ANY"; controller: Player | "ANY";
    fromZones: ("hand" | "deck" | "life" | "trash" | "public" | "character" | "stage" | "resolving")[];
    toZones: ("hand" | "deck" | "life" | "trash" | "public" | "character" | "stage")[];
    cardTypes: ("character" | "stage" | "event")[]; filters: Predicate });
  MAIN: NodeMeta & { type: "MAIN" }; ON_PLAY: NodeMeta & { type: "ON_PLAY" };
  ON_ATTACK: NodeMeta & { type: "ON_ATTACK" }; ON_OPPONENT_ATTACK: NodeMeta & { type: "ON_OPPONENT_ATTACK" };
  ON_KO: NodeMeta & { type: "ON_KO" };
  COUNTER: NodeMeta & { type: "COUNTER" };
  TRIGGER: NodeMeta & { type: "TRIGGER" };
}
export interface KeywordMap {
  BLOCKER: NodeMeta & { type: "BLOCKER" };
  RUSH: NodeMeta & { type: "RUSH" };
  RUSH_CHARACTER: NodeMeta & { type: "RUSH_CHARACTER" };
  CANNOT_BE_BLOCKED: NodeMeta & { type: "CANNOT_BE_BLOCKED" };
  BANISH: NodeMeta & { type: "BANISH" };
  DOUBLE_ATTACK: NodeMeta & { type: "DOUBLE_ATTACK" };
}
export interface Categories { predicate: PredicateMap; action: ActionMap; cost: CostMap; replacement: ReplacementMap; selector: SelectorMap; duration: DurationMap; timing: TimingMap; keyword: KeywordMap; query: QueryMap }
export type Category = keyof Categories;
export type Node<C extends Category> = Categories[C][keyof Categories[C]];
export type Predicate = Node<"predicate">;
export type Action = Node<"action">;
export type Effect = {
  id: string; kind: "activated" | "triggered"; timing: Node<"timing">;
  sourceZones: ("leader" | "character" | "stage" | "hand" | "life")[]; optional: boolean;
  usageLimit: { type: "PER_TURN"; scope: "SOURCE_OBJECT"; count: number } | null;
  activationConditions: Predicate; resolutionConditions: Predicate; costs: Node<"cost">[]; actions: Action[];
};
export type CardDefinition = {
  schemaVersion: SchemaVersion; cardId: string; cardVersion: string;
  name: string; cardType: "leader" | "character" | "stage" | "event";
  baseStats: { cost: number | null; power: number | null; counter: number | null; life: number | null };
  colors: string[]; traits: string[]; attributes: string[]; keywords: Node<"keyword">[];
  reviewStatus: "needs_review" | "unsupported" | "approved";
  source: { text: string; triggerText: string; displayIds: string[]; datasetSha256: string }; effects: Effect[];
  continuousEffects?: ActionMap["CONTINUOUS_EFFECT"][];
  replacementEffects?: Node<"replacement">[];
};
export type CompiledCard = DeepReadonly<{
  status: "compiled_not_executable"; compilerVersion: string; registryHash: string;
  definitionHash: string; sourceHash: string; definition: CardDefinition; requiredHandlers: string[];
}>;
