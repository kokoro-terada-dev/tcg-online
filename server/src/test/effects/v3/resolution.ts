import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { dataArray, dataObject, ensureMove, freezeMovement, reference } from "../../movement/state";
import type { CardObjectRef, DeepReadonly } from "../types";
import type { Action, CardSetRef, Effect, Node, Predicate } from "./dsl";
import type { ExternalBodyRef } from "./effectBodyCalls";
import { label, supportsV3RuntimeProfile } from "./compiler";
import { isApprovedV3Card, type ApprovedV3Card } from "./approval";
import { activationCostSelector, movesActivationSource } from "./activationCosts";
import type { FieldStatus } from "./keywordEffects";
import { emptyMoveResult, isCertifiedMoveResult, rememberMoveFacts, type MoveResult, type ResultBindings, type FactBindings, type RememberedMoveFacts } from "./moveResults";
import { replacementLabel, type ReplacementAnswer, type ReplacementPlan } from "./replacementPlans";
import { isLifeTriggerBody } from "./simpleMainEvent";
import { attackAttachmentMinimum } from "./triggerScheduler";

type Ref = Readonly<CardObjectRef>;
type Seat = 0 | 1;
type Bindings = Readonly<Record<string, readonly Ref[]>>;
type A = DeepReadonly<Action>;
type Selector = DeepReadonly<Node<"selector">>;
export type ResolutionCandidate = Readonly<{ ref: Ref; cardId: string; owner: Seat; controller: Seat; zone: string; kind: string; faceUp: boolean; visibleTo: readonly Seat[]; rotated?: boolean; label?: string; attachedTo?: Ref }>;
// Server-owned, pure reads. This interface is not a socket payload or a game-rule implementation.
export interface ResolutionEnvironment {
  bodyCandidates?(maxPrintedCost: number): readonly ExternalBodyRef[];
  bindBody?(ref: ExternalBodyRef): { effect: DeepReadonly<Effect>; environment: ResolutionEnvironment };
  activationAtOccurrence?(): true | "unknown";
  revision(): number;
  now(): number;
  evaluate(predicate: DeepReadonly<Predicate>, bindings: Bindings, candidate?: Ref, results?: ResultBindings, memories?: FactBindings): boolean | "unknown";
  candidates(selector: Selector, bindings: Bindings): readonly ResolutionCandidate[];
  characterPlayPrevented?(): boolean;
  targetProtection?(ref: Ref): boolean | "unknown";
  opponentHand?(owner: Seat): readonly ResolutionCandidate[];
  peekTop?(count: number): readonly Ref[] | "unknown";
  numeric?(value: DeepReadonly<import("./dsl").Value>, bindings: Bindings): number | "unknown";
  lifeMoveCard?(player: Seat, from: "DECK_TOP" | "LIFE_TOP" | "LIFE_BOTTOM"): Ref | null;
  lifeTriggerPlay?(): "OPEN" | "FULL" | "PLAYED";
  effectPlayFull?(): boolean;
  donDeckCount?(): number;
  canPayCosts?(costs: readonly DeepReadonly<Node<"cost">>[], discarded: readonly Ref[] | null, returned: readonly Ref[] | null, selected?: readonly Ref[] | null): boolean | "unknown";
}
export type ResolutionIdentity = Readonly<{ matchId: string; resolutionId: string; effectId: string; actor: Seat; source: Ref }>;
type WorkAction = Exclude<A, { type: "CALL_EFFECT_BODY" | "SEQUENCE" | "IF" | "SELECT" | "ORDER_CARDS" | "BIND_SOURCE" | "MOVE_RESULT" | "REMEMBER_FACTS" | "CHOOSE_MODE" | "ADD_DON_UP_TO" | "OFFER_PAYMENT" | "IF_PAYMENT_SUCCEEDED" | "CONTINUOUS_EFFECT" }>;
type OwnerHandAction = Extract<A, { type: "DISCARD_BY_OWNER" | "ORDER_THEN_MOVE" }>;
type PaymentOffer = Extract<A, { type: "OFFER_PAYMENT" }>;
type ModeBranch = { label: string; to: number; donCount?: number };
function availableDon(environment: ResolutionEnvironment): number {
  const count = environment.donDeckCount?.();
  ensureMove(typeof count === "number" && Number.isSafeInteger(count) && count >= 0 && count <= 10, "v3-unknown-don-deck-count");
  return count;
}
const lifeSlotBinding = "lifeTriggerSlot";
const effectSlotBinding = "$effectPlaySlot";
type Instruction = { type: "CHECK"; predicate: DeepReadonly<Predicate> } | { type: "OCCURRENCE_CHECK" } | { type: "COSTS" } | { type: "OPTIONAL" } |
  { type: "PLAY_SLOT_REVEAL"; action: Extract<A, { type: "PLAY_BY_EFFECT" }> } |
  { type: "BODY_CHOICE"; maxPrintedCost: number } |
  { type: "SELECT"; action: Extract<A, { type: "SELECT" }>; ruleSlot?: true; playCards?: CardSetRef } | { type: "BIND_SOURCE"; bindAs: string } | { type: "MOVE_RESULT"; bindAs: string } | { type: "ORDER"; action: Extract<A, { type: "ORDER_CARDS" }> } | { type: "WORK"; action: WorkAction } |
  { type: "REMEMBER_FACTS"; action: Extract<A, { type: "REMEMBER_FACTS" }> } |
  { type: "BRANCH"; predicate: DeepReadonly<Predicate>; otherwise: number } | { type: "PAYMENT_BRANCH"; payment: string; otherwise: number } |
  { type: "OFFER_PAYMENT"; action: PaymentOffer } | { type: "MODE"; branches: ModeBranch[] } |
  { type: "ENTER" } | { type: "EXIT" } | { type: "JUMP"; to: number } | { type: "TRIGGER_END" } | { type: "END" };
type ChoiceBase = { kind: "choice"; selectionId: string; chooser: Seat; expiresAt: number };
type CardChoice = ChoiceBase & { purpose: "action" | "cost" | "returnCost" | "order" | "ownerDiscard" | "ownerDeckBottom" | "replacementPayment" | "replacementPriority"; filteredCost?: true; min: number; max: number; maxActiveReturn: number | null; bindAs: string | null; candidates: { token: string; cardId: string; zone: string; label: string | null; ref: CardObjectRef; candidateId?: string }[] };
type SingleChoice = ChoiceBase & { min: 1; max: 1; maxActiveReturn: null };
type DecisionChoice<P extends "activation" | "payment" | "replacement"> = SingleChoice & { purpose: P; candidates: { token: string; decision: "accepted" | "declined"; label: string }[] };
type Choice = CardChoice | DecisionChoice<"activation"> | DecisionChoice<"payment"> | DecisionChoice<"replacement"> |
  (SingleChoice & { purpose: "revealConfirmation"; candidates: { token: string; label: string }[]; revealedCardIds: string[] }) |
  (SingleChoice & { purpose: "mode"; candidates: (ModeBranch & { token: string })[] });
type BodyChoice = Omit<CardChoice, "purpose" | "candidates"> & { purpose: "effectBody"; candidates: (CardChoice["candidates"][number] & { body: ExternalBodyRef })[] };
export type WorkRequest = DeepReadonly<{ kind: "work"; workId: string; worldRevision: number } & (
  { type: "PAY_COSTS"; costs: Node<"cost">[]; discarded: CardObjectRef[]; returned: CardObjectRef[]; selected?: CardObjectRef[]; duringEffect?: true } | { type: "DRAW"; player: Seat; count: number } |
  Omit<Extract<Action, { type: "ADD_DON" }>, "id" | "sourceSpan" | "player"> & { player: Seat } |
  Omit<Extract<Action, { type: "SET_DON_STATE" }>, "id" | "sourceSpan" | "cards"> & { cards: CardObjectRef[] } |
  { type: "ATTACH_DON"; from: "ACTIVE" | "REST"; assignments: { card: CardObjectRef; target: CardObjectRef }[] } |
  { type: "RETURN_DON_BY_EFFECT"; cards: CardObjectRef[]; from: Extract<Action, { type: "RETURN_DON_BY_EFFECT" }>["from"] } |
  { type: "LOOK_TOP"; cards: CardObjectRef[]; bindAs: string } | { type: "REVEAL"; cards: CardObjectRef[]; playSlot?: true } |
  { type: "TRASH_DECK_TOP"; count: number } |
  { type: "SHUFFLE_DECK" } |
  { type: "RETURN_TO_DECK"; cards: CardObjectRef[]; position: "top" | "bottom" } | { type: "CLOSE_REVEALS" } | { type: "FINISH_LIFE_TRIGGER" } |
  { type: "MOVE_CARD"; cards: CardObjectRef[]; destination: Extract<Action, { type: "MOVE_CARD" }>["destination"]; cause: "EFFECT"; inspectedOnly?: true } |
  { type: "MOVE_LIFE"; player: Seat; from: Extract<Action, { type: "MOVE_LIFE" }>["from"]; to: Extract<Action, { type: "MOVE_LIFE" }>["to"]; faceUp: boolean; cards: CardObjectRef[] } |
  { type: "EXTRA_TURN" } |
  { type: "PLAY_BY_EFFECT"; cards: CardObjectRef[]; enterState: "ACTIVE" | "REST"; provenance: "EFFECT" } &
    ({ from: "hand" | "trash" | "deck"; replace?: CardObjectRef | null; entrySequence?: string; destination: Extract<Action, { type: "PLAY_BY_EFFECT" }>["destination"] } |
      { from: "resolving"; replace: CardObjectRef | null; destination: { owner: "SELF"; zone: "character" | "stage"; slotPolicy: "FIRST_EMPTY" } }) |
  { type: OwnerHandAction["type"]; owner: Seat; count: number; cards: CardObjectRef[] } |
  { type: "MODIFY_STAT"; cards: CardObjectRef[]; stat: "power" | "cost"; amount: number; duration: Node<"duration">; mode?: "SET_BASE" } |
  { type: "GRANT_KEYWORD"; cards: CardObjectRef[]; keyword: Node<"keyword"> | { type: FieldStatus }; duration: Node<"duration"> } |
  { type: "KO" | "KO_STAGE" | "REST" | "SET_ACTIVE" | "RETARGET_BATTLE"; cards: CardObjectRef[] }
)>;
type State = {
  version: "v3-frame.9"; identity: ResolutionIdentity; definitionHash: string; compilerVersion: string; registryHash: string; rulesetVersion: string;
  revision: number; worldRevision: number; pc: number; status: "ready" | "waitingForChoice" | "waitingForWork" | "completed" | "blocked";
  scopes: Record<string, CardObjectRef[]>[]; pending: Choice | BodyChoice | WorkRequest | null;
  externalBody?: ExternalBodyRef;
  replacement?: { work: WorkRequest } & (ReplacementAnswer | { plan: ReplacementPlan; decision: null } |
    { plans: readonly ReplacementPlan[]; remaining?: readonly ReplacementPlan[]; decision: null });
  appliedReplacements?: { intentId: string; candidateId: string }[];
  costCards: CardObjectRef[] | null; costReturned: CardObjectRef[] | null; paidCostWorkId: string | null;
  costSelected?: CardObjectRef[];
  paymentAccepted?: true;
  paymentScopes?: Record<string, boolean>[];
  activationDecision: "accepted" | "declined" | null;
  activationCommitted: boolean;
  interruptedByGameEnd: boolean;
  revealsOpen: boolean;
  resultScopes?: Record<string, MoveResult>[];
  factScopes?: Record<string, RememberedMoveFacts>[];
  lastMoveResult?: MoveResult | null;
  playSequence?: { firstPc: number; index: number };
  receipts: { requestId: string; fingerprint: string }[];
};
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const relative = (actor: Seat, player: "SELF" | "OPPONENT"): Seat => player === "SELF" ? actor : (1 - actor) as Seat;
const matchesSide = (actual: Seat, actor: Seat, side: "SELF" | "OPPONENT" | "EITHER"): boolean =>
  side === "EITHER" || actual === relative(actor, side);
function program(card: ApprovedV3Card, effectId: string, external?: DeepReadonly<Effect>): { code: Instruction[]; bodyEffectId: string | null } {
  const effect = card.definition.effects.find(effect => effect.id === effectId); ensureMove(effect, "v3-effect-not-found");
  ensureMove(effect.timing.type !== "ON_EVENT" || ["3.0.0-subset.22", "3.0.0-subset.23", "3.0.0-subset.24", "3.0.0-subset.25", "3.0.0-subset.26", "3.0.0-subset.27", "3.0.0-subset.28", "3.0.0-subset.29", "3.0.0-subset.30", "3.0.0-subset.31", "3.0.0-subset.32", "3.0.0-subset.33", "3.0.0-subset.34", "3.0.0-subset.35", "3.0.0-subset.36", "3.0.0-subset.37", "3.0.0-subset.38", "3.0.0-subset.39", "3.0.0-subset.40", "3.0.0-subset.41", "3.0.0-subset.42", "3.0.0-subset.43", "3.0.0-subset.44", "3.0.0-subset.45", "3.0.0-subset.46", "3.0.0-subset.47", "3.0.0-subset.48", "3.0.0-subset.49", "3.0.0-subset.50", "3.0.0-subset.51", "3.0.0-subset.52", "3.0.0-subset.53", "3.0.0-subset.54", "3.0.0-subset.55", "3.0.0-subset.56", "3.0.0-subset.57", "3.0.0-subset.58", "3.0.0-subset.59", "3.0.0-subset.60", "3.0.0-subset.61", "3.0.0-subset.62"].includes(card.definition.schemaVersion), "v3-conditional-trigger-resolution-deferred-pr06b");
  const occurrence = ["ON_EVENT", "ON_BLOCK", "MAIN_START", "TURN_END"].includes(effect.timing.type) || attackAttachmentMinimum(effect) !== null;
  const code: Instruction[] = [occurrence ? { type: "OCCURRENCE_CHECK" } : { type: "CHECK", predicate: effect.activationConditions }];
  if (effect.optional) code.push({ type: "OPTIONAL" });
  code.push({ type: "COSTS" }, { type: "CHECK", predicate: effect.resolutionConditions });
  const append = (actions: readonly A[]): void => { for (const action of actions) {
    if (action.type === "SEQUENCE") append(action.actions);
    else if (action.type === "IF" || action.type === "IF_PAYMENT_SUCCEEDED") {
      const branch = action.type === "IF" ? { type: "BRANCH" as const, predicate: action.condition, otherwise: 0 } :
        { type: "PAYMENT_BRANCH" as const, payment: action.payment, otherwise: 0 };
      code.push(branch, { type: "ENTER" }); append(action.then); code.push({ type: "EXIT" });
      const jump = { type: "JUMP" as const, to: 0 }; code.push(jump); branch.otherwise = code.length;
      code.push({ type: "ENTER" }); append(action.else); code.push({ type: "EXIT" }); jump.to = code.length;
    } else if (action.type === "CHOOSE_MODE" || action.type === "ADD_DON_UP_TO") {
      const branches: ModeBranch[] = [], exits: { type: "JUMP"; to: number }[] = [];
      code.push({ type: "MODE", branches });
      // A positive count resolves via the same ADD_DON work as a fixed-count effect.
      const modes: readonly { label: string; actions: readonly A[] }[] = action.type === "CHOOSE_MODE" ? action.modes :
        Array.from({ length: action.max + 1 }, (_, count) => ({ label: `DON!!を${count}枚追加`,
          actions: count ? [{ type: "ADD_DON", player: "SELF", count, state: action.state, onInsufficient: "fail" }] : [] }));
      for (const [index, mode] of modes.entries()) {
        branches.push({ label: mode.label, to: code.length, ...(action.type === "ADD_DON_UP_TO" ? { donCount: index } : {}) });
        code.push({ type: "ENTER" }); append(mode.actions); code.push({ type: "EXIT" });
        const exit = { type: "JUMP" as const, to: 0 }; code.push(exit); exits.push(exit);
      }
      for (const exit of exits) exit.to = code.length;
    } else if (action.type === "OFFER_PAYMENT") code.push({ type: "OFFER_PAYMENT", action });
    else if (action.type === "SELECT") code.push({ type: "SELECT", action });
    else if (action.type === "PLAY_BY_EFFECT" && action.destination.slotPolicy === "REPLACE_IF_FULL") {
      if (action.from === "hand" || action.from === "deck") code.push({ type: "PLAY_SLOT_REVEAL", action });
      code.push({ type: "SELECT", ruleSlot: true, playCards: action.cards, action: {
        type: "SELECT", bindAs: effectSlotBinding,
        selector: { type: "CARDS", owner: "SELF", controller: "SELF", chooser: "SELF", zone: "character", cardTypes: ["character"],
          visibility: "PUBLIC", faceUpOnly: true, excludeSource: false, min: 1, max: 1, selectionMode: "SELECT", order: "UNORDERED",
          onInsufficient: "fail", filters: { type: "all", conditions: [] } }
      } }, { type: "WORK", action });
    }
    else if (action.type === "PLAY_TRIGGER_SOURCE") {
      const zone = card.definition.cardType;
      ensureMove(zone === "character" || zone === "stage", "v3-trigger-play-zone");
      code.push({ type: "SELECT", ruleSlot: true, action: { type: "SELECT", bindAs: lifeSlotBinding,
        selector: { type: "CARDS", owner: "SELF", controller: "SELF", chooser: "SELF", zone, cardTypes: [zone],
          visibility: "PUBLIC", faceUpOnly: true, excludeSource: true, min: 1, max: 1, selectionMode: "SELECT", order: "UNORDERED",
          onInsufficient: "fail", filters: { type: "all", conditions: [] } } } }, { type: "WORK", action });
    }
    else if (action.type === "REMEMBER_FACTS") code.push({ type: "REMEMBER_FACTS", action });
    else if (action.type === "MOVE_RESULT") {
      const previous = code.at(-1);
      ensureMove(previous?.type === "WORK" && (previous.action.type === "MOVE_CARD" || previous.action.type === "PLAY_BY_EFFECT" ||
        previous.action.type === "MOVE_LIFE"), "v3-result-must-follow-move");
      code.push({ type: "MOVE_RESULT", bindAs: action.bindAs });
    }
    else if (action.type === "BIND_SOURCE") code.push({ type: "BIND_SOURCE", bindAs: action.bindAs });
    else if (action.type === "ORDER_CARDS") code.push({ type: "ORDER", action });
    else if (["DRAW", "ADD_DON", "SET_DON_STATE", "ATTACH_DON", "RETURN_DON_BY_EFFECT", "MOVE_CARD", "MOVE_LIFE", "PLAY_BY_EFFECT", "DISCARD_BY_OWNER", "ORDER_THEN_MOVE", "KO", "KO_STAGE", "RETARGET_BATTLE", "EXTRA_TURN", "REST", "SET_ACTIVE", "LOOK_TOP", "REVEAL", "TRASH_DECK_TOP", "SHUFFLE_DECK", "RETURN_TO_DECK", "MODIFY_STAT", "GRANT_KEYWORD", "SKIP_REFRESH", "DISABLE_CARD_EFFECTS", "PREVENT_CHARACTER_PLAY", "PREVENT_BLOCKER"].includes(action.type)) code.push({ type: "WORK", action: action as WorkAction });
    else throw new Error("V3_RUNTIME_HANDLER_UNSUPPORTED");
  } };
  const call = effect.actions[0];
  let bodyEffectId: string | null = null;
  if (call?.type === "CALL_EFFECT_BODY" && call.from === "OWN_TRASH") {
    ensureMove(["3.0.0-subset.41", "3.0.0-subset.42", "3.0.0-subset.43", "3.0.0-subset.44", "3.0.0-subset.45", "3.0.0-subset.46", "3.0.0-subset.47", "3.0.0-subset.48", "3.0.0-subset.49", "3.0.0-subset.50", "3.0.0-subset.51", "3.0.0-subset.52", "3.0.0-subset.53", "3.0.0-subset.54", "3.0.0-subset.55", "3.0.0-subset.56", "3.0.0-subset.57", "3.0.0-subset.58", "3.0.0-subset.59", "3.0.0-subset.60", "3.0.0-subset.61", "3.0.0-subset.62"].includes(card.definition.schemaVersion) && card.definition.cardType !== "event" && effect.actions.length === 1,
      "v3-effect-body-external-scope");
    if (external) { bodyEffectId = external.id; append(external.actions); }
    else code.push({ type: "BODY_CHOICE", maxPrintedCost: call.maxPrintedCost });
  } else if (call?.type === "CALL_EFFECT_BODY") {
    const body = card.definition.effects.find(row => row.id === call.effectId);
    ensureMove(["3.0.0-subset.40", "3.0.0-subset.41", "3.0.0-subset.42", "3.0.0-subset.43", "3.0.0-subset.44", "3.0.0-subset.45", "3.0.0-subset.46", "3.0.0-subset.47", "3.0.0-subset.48", "3.0.0-subset.49", "3.0.0-subset.50", "3.0.0-subset.51", "3.0.0-subset.52", "3.0.0-subset.53", "3.0.0-subset.54", "3.0.0-subset.55", "3.0.0-subset.56", "3.0.0-subset.57", "3.0.0-subset.58", "3.0.0-subset.59", "3.0.0-subset.60", "3.0.0-subset.61", "3.0.0-subset.62"].includes(card.definition.schemaVersion) &&
      effect.timing.type === "TRIGGER" && effect.actions.length === 1 && body && isLifeTriggerBody(body, card.definition.cardType, card.definition.schemaVersion),
    "v3-effect-body-main-target");
    // Expand only the body. The outer life-trigger frame owns activation, timing and cleanup.
    bodyEffectId = body.id;
    append(body.actions);
  } else append(effect.actions);
  if (effect.timing.type === "TRIGGER") code.push({ type: "TRIGGER_END" });
  code.push({ type: "END" }); ensureMove(code.length <= 4096, "v3-program-limit"); return { code, bodyEffectId };
}

function paymentLabel(costs: PaymentOffer["costs"]): string {
  return costs.map(cost => {
    switch (cost.type) {
      case "REST_DON": return `DON!! ${cost.count}枚をレスト`;
      case "DON_RETURN": return `DON!! ${cost.count}枚をデッキへ戻す`;
      case "DISCARD_HAND": return `手札${cost.count}枚を捨てる`;
      case "REST_SOURCE": return "発動元をレスト";
      case "REST_AS_COST": return "条件に合うカード1枚をレスト";
      case "KO_AS_COST": return "条件に合う自分のキャラ1枚をKO";
      case "LIFE_TOP_COST": return cost.operation === "TO_HAND" ? "ライフの上から1枚を手札に加える" :
        cost.operation === "FACE_UP" ? "ライフの一番上を表向きにする" : "ライフの一番上を裏向きにする";
      case "REVEAL_CARDS": return `条件に合う手札${cost.selector.min}枚を公開`;
      case "MOVE_AS_COST": return cost.selector === "SOURCE" ? "発動元をトラッシュへ" : `条件に合う手札${cost.selector.min}枚をトラッシュへ`;
    }
  }).join("、");
}

// A persisted control machine only. It never mutates a board, pays costs, or applies game rulings.
export class V3ResolutionMachine {
  #state: State;
  #code: Instruction[];
  #bodyEffectId: string | null;
  #bodyLimited = false;
  #card: ApprovedV3Card;
  #key: Buffer;
  #environment: ResolutionEnvironment;
  constructor(card: ApprovedV3Card, identity: ResolutionIdentity, signingKey: Uint8Array, environment: ResolutionEnvironment) {
    ensureMove(isApprovedV3Card(card), "v3-approved-server-plan-required");
    dataObject(identity, ["matchId", "resolutionId", "effectId", "actor", "source"]);
    label(identity.matchId); label(identity.resolutionId); label(identity.effectId); reference(identity.source);
    ensureMove(identity.actor === 0 || identity.actor === 1, "v3-invalid-actor");
    ensureMove(signingKey instanceof Uint8Array && signingKey.length >= 32 && signingKey.length <= 128, "v3-signing-key-required");
    ensureMove(supportsV3RuntimeProfile(card), "v3-runtime-registry-mismatch");
    this.#key = Buffer.from(signingKey); this.#environment = environment; this.#card = card;
    const compiled = program(card, identity.effectId);
    this.#code = compiled.code; this.#bodyEffectId = compiled.bodyEffectId;
    const worldRevision = environment.revision(); ensureMove(Number.isSafeInteger(worldRevision) && worldRevision >= 0, "v3-invalid-world-revision");
    this.#state = { version: "v3-frame.9", identity: structuredClone(identity), definitionHash: card.definitionHash, compilerVersion: card.compilerVersion, registryHash: card.registryHash, rulesetVersion: card.rulesetVersion,
      revision: 0, worldRevision, pc: 0, status: "ready", scopes: [{}], pending: null, costCards: null, costReturned: null, paidCostWorkId: null, activationDecision: null, activationCommitted: false, interruptedByGameEnd: false, revealsOpen: false, receipts: [] };
  }
  #bindings(state: State): Bindings { return freezeMovement(structuredClone(Object.assign({}, ...state.scopes))); }
  #executionIdentity(state: State): ResolutionIdentity {
    return state.externalBody ? { ...state.identity, source: state.externalBody.source, effectId: state.externalBody.effectId } : state.identity;
  }
  #bindExternalBody(state: State): void {
    if (!state.externalBody) return;
    const bound = this.#environment.bindBody?.(state.externalBody);
    ensureMove(bound, "v3-effect-body-unavailable");
    const compiled = program(this.#card, state.identity.effectId, bound.effect);
    ensureMove(compiled.bodyEffectId === state.externalBody.effectId, "v3-effect-body-program-mismatch");
    this.#code = compiled.code; this.#bodyEffectId = compiled.bodyEffectId;
    this.#bodyLimited = bound.effect.usageLimit !== null;
    this.#environment = bound.environment;
  }
  #results(state: State): ResultBindings { return freezeMovement(structuredClone(Object.assign({}, ...(state.resultScopes ?? [])))); }
  #evaluate(predicate: DeepReadonly<Predicate>, state: State, candidate?: Ref): boolean {
    const memories: FactBindings = freezeMovement(structuredClone(Object.assign({}, ...(state.factScopes ?? []))));
    const result = this.#environment.evaluate(predicate, this.#bindings(state), candidate, this.#results(state), memories);
    ensureMove(result === true || result === false, "v3-unknown-predicate"); return result;
  }
  #choiceExpiry(): number {
    const now = this.#environment.now(); ensureMove(Number.isSafeInteger(now) && now >= 0 && now <= Number.MAX_SAFE_INTEGER - 120000, "v3-invalid-clock");
    return now + 120000;
  }
  #choiceBase(chooser: Seat): ChoiceBase {
    return { kind: "choice", selectionId: randomUUID(), chooser, expiresAt: this.#choiceExpiry() };
  }
  #singleChoice(state: State): SingleChoice {
    return { ...this.#choiceBase(state.identity.actor), min: 1, max: 1, maxActiveReturn: null };
  }
  #ownerHandRows(state: State, action: OwnerHandAction): readonly ResolutionCandidate[] {
    const owner = relative(state.identity.actor, action.player);
    const rows = this.#environment.opponentHand?.(owner);
    ensureMove(rows && relative(state.identity.actor, action.chooser) === owner && owner !== state.identity.actor, "v3-owner-hand-unavailable");
    dataArray(rows, 256);
    const seen = new Set<string>();
    for (const row of rows) {
      reference(row.ref); label(row.cardId);
      ensureMove(!seen.has(row.ref.instanceId) && row.zone === "hand" && row.owner === owner && row.controller === owner &&
        row.visibleTo.includes(owner) && ["character", "stage", "event"].includes(row.kind), "v3-owner-hand-candidate");
      seen.add(row.ref.instanceId);
    }
    return rows;
  }
  #effect(state: State) { return this.#card.definition.effects.find(effect => effect.id === state.identity.effectId)!; }
  #costsAt(state: State): readonly DeepReadonly<Node<"cost">>[] {
    const instruction = this.#code[state.pc];
    return instruction?.type === "OFFER_PAYMENT" ? instruction.action.costs : this.#effect(state).costs;
  }
  #recordPayment(state: State, offer: PaymentOffer, paid: boolean): void {
    state.paymentScopes ??= state.scopes.map(() => ({}));
    state.paymentScopes.at(-1)![offer.bindAs] = paid;
    delete state.paymentAccepted;
  }
  #command(requestId: string, expectedRevision: number, body: object, apply: (state: State) => void): { replayed: boolean } {
    label(requestId); const fingerprint = hash(JSON.stringify([expectedRevision, body]));
    const receipt = this.#state.receipts.find(receipt => receipt.requestId === requestId);
    if (receipt) { ensureMove(receipt.fingerprint === fingerprint, "v3-request-conflict"); return { replayed: true }; }
    ensureMove(Number.isSafeInteger(expectedRevision) && expectedRevision === this.#state.revision && this.#state.revision < Number.MAX_SAFE_INTEGER && this.#state.receipts.length < 512, "v3-stale-or-limited-frame");
    const next = structuredClone(this.#state); apply(next); next.revision++;
    next.receipts.push({ requestId, fingerprint }); ensureMove(Buffer.byteLength(JSON.stringify(next)) <= 262144, "v3-frame-size-limit");
    if (!this.#state.externalBody && next.externalBody) this.#bindExternalBody(next);
    this.#state = next; return { replayed: false };
  }
  advance(requestId: string, expectedRevision: number): { replayed: boolean } {
    return this.#command(requestId, expectedRevision, { kind: "advance" }, state => {
      ensureMove(state.status === "ready" && this.#environment.revision() === state.worldRevision, "v3-not-ready-or-world-changed");
      for (let steps = 0; steps < 256 && state.status === "ready"; steps++) {
        const instruction = this.#code[state.pc]; ensureMove(instruction, "v3-invalid-program-counter");
        const workId = `${state.identity.resolutionId}:${state.pc}${state.playSequence ? `:${state.playSequence.index}` : ""}`;
        if (instruction.type === "OCCURRENCE_CHECK") {
          ensureMove(this.#environment.activationAtOccurrence?.() === true, "v3-trigger-occurrence-not-authorized"); state.pc++;
        } else if (instruction.type === "CHECK") {
          if (!this.#evaluate(instruction.predicate, state)) {
            if (this.#card.definition.effects.find(effect => effect.id === state.identity.effectId)!.timing.type === "TRIGGER") { state.pc = this.#code.length - 2; continue; }
            if (state.revealsOpen) { state.pc = this.#code.length - 1; continue; }
            state.status = "completed"; return;
          } state.pc++;
        } else if (instruction.type === "OPTIONAL") {
          const costs = this.#effect(state).costs;
          if (activationCostSelector(costs) || movesActivationSource(costs) || costs.some(cost => cost.type === "LIFE_TOP_COST")) {
            const payable = this.#environment.canPayCosts?.(costs, null, null) ?? "unknown";
            ensureMove(payable !== "unknown", "v3-cost-feasibility-unknown");
            if (!payable) { state.status = "completed"; return; }
          }
          state.pending = { ...this.#singleChoice(state), purpose: "activation",
            candidates: [{ token: randomUUID(), decision: "accepted", label: "発動する" }, { token: randomUUID(), decision: "declined", label: "発動しない" }] };
          state.status = "waitingForChoice";
        } else if (instruction.type === "BODY_CHOICE") {
          const rows = this.#environment.bodyCandidates?.(instruction.maxPrintedCost);
          ensureMove(rows, "v3-effect-body-unavailable");
          dataArray(rows, 256);
          if (!rows.length) { state.pc++; continue; }
          state.pending = { ...this.#singleChoice(state), purpose: "effectBody", min: 0, bindAs: null,
            candidates: rows.map(body => ({ body, ref: { ...body.source }, cardId: body.cardId, label: body.effectId, zone: "trash", token: randomUUID() })) };
          state.status = "waitingForChoice";
        } else if (instruction.type === "MODE") {
          const don = instruction.branches[0]?.donCount === undefined ? null : availableDon(this.#environment);
          const branches = don === null ? instruction.branches : instruction.branches.filter(branch => branch.donCount! <= don);
          if (don === 0) { state.pc = branches[0]!.to; continue; }
          state.pending = { ...this.#singleChoice(state), purpose: "mode", candidates: branches.map(branch => ({ ...branch, token: randomUUID() })) };
          state.status = "waitingForChoice";
        } else if (instruction.type === "COSTS" || instruction.type === "OFFER_PAYMENT") {
          const offer = instruction.type === "OFFER_PAYMENT" ? instruction.action : null;
          const costs = this.#costsAt(state);
          if (!costs.length) { ensureMove(!offer, "v3-payment-cost-required"); state.activationCommitted = true; state.pc++; continue; }
          const discardCount = costs.reduce((sum, cost) => sum + (cost.type === "DISCARD_HAND" ? cost.count : 0), 0);
          const returnCost = costs.find(cost => cost.type === "DON_RETURN");
          const filtered = activationCostSelector(costs);
          const newCost = !!filtered || movesActivationSource(costs) || costs.some(cost => cost.type === "LIFE_TOP_COST");
          if (offer || newCost || this.#effect(state).optional || discardCount > 0 || returnCost || costs.some(cost => cost.type === "REST_SOURCE")) {
            const payable = this.#environment.canPayCosts?.(costs, state.costCards, state.costReturned, state.costSelected) ?? "unknown";
            ensureMove(payable !== "unknown", "v3-cost-feasibility-unknown");
            if (offer && !state.paymentAccepted) {
              if (!payable) { this.#recordPayment(state, offer, false); state.pc++; continue; }
              state.pending = { ...this.#singleChoice(state), purpose: "payment",
                candidates: [{ token: randomUUID(), decision: "accepted", label: paymentLabel(offer.costs) }, { token: randomUUID(), decision: "declined", label: "支払わない" }] };
              state.status = "waitingForChoice";
              continue;
            }
            if (!payable) { state.status = !offer && newCost && !state.costSelected && state.costCards === null && state.costReturned === null ? "completed" : "blocked"; return; }
            if (filtered && !state.costSelected) { this.#select(state, filtered, null, undefined, true); continue; }
            if (discardCount > 0 && state.costCards === null) {
              this.#select(state, { type: "CARDS", owner: "SELF", controller: "SELF", chooser: "SELF", zone: "hand", cardTypes: ["character", "stage", "event"],
                filters: { type: "all", conditions: [] }, excludeSource: false, faceUpOnly: false, min: discardCount, max: discardCount, visibility: "OWNER_ONLY", selectionMode: "SELECT", order: "UNORDERED", onInsufficient: "fail" }, null);
              continue;
            }
            if (returnCost && state.costReturned === null) {
              this.#select(state, { type: "CARDS", owner: "SELF", controller: "SELF", chooser: "SELF", zone: returnCost.from, cardTypes: ["don"],
                filters: { type: "all", conditions: [] }, excludeSource: false, faceUpOnly: true, min: returnCost.count, max: returnCost.count, visibility: "PUBLIC", selectionMode: "SELECT", order: "UNORDERED", onInsufficient: "fail" }, null, "returnCost");
              continue;
            }
          }
          state.pending = freezeMovement({ kind: "work", workId, worldRevision: state.worldRevision, type: "PAY_COSTS", costs: structuredClone(costs), discarded: structuredClone(state.costCards ?? []), returned: structuredClone(state.costReturned ?? []), ...(state.costSelected ? { selected: structuredClone(state.costSelected) } : {}), ...(offer ? { duringEffect: true as const } : {}) }); state.status = "waitingForWork";
        } else if (instruction.type === "BRANCH") state.pc = this.#evaluate(instruction.predicate, state) ? state.pc + 1 : instruction.otherwise;
        else if (instruction.type === "PAYMENT_BRANCH") {
          const scope = state.paymentScopes?.findLast(scope => Object.hasOwn(scope, instruction.payment));
          ensureMove(scope, "v3-payment-result-not-recorded");
          state.pc = scope[instruction.payment] ? state.pc + 1 : instruction.otherwise;
        }
        else if (instruction.type === "ENTER") { state.scopes.push({}); state.resultScopes?.push({}); state.factScopes?.push({}); state.paymentScopes?.push({}); state.pc++; }
        else if (instruction.type === "EXIT") { ensureMove(state.scopes.length > 1, "v3-invalid-scope-pop"); state.scopes.pop(); state.resultScopes?.pop(); state.factScopes?.pop(); state.paymentScopes?.pop(); state.pc++; }
        else if (instruction.type === "REMEMBER_FACTS") {
          const action = instruction.action, result = this.#results(state)[action.result], selected = action.cards === null ? null : this.#bindings(state)[action.cards.ref.slice("bindings.".length)];
          ensureMove(selected !== undefined, "v3-memory-card-binding-required");
          const memory = rememberMoveFacts(result, state.identity, selected, action.snapshot, action.basis);
          state.factScopes ??= state.scopes.map(() => ({})); state.factScopes.at(-1)![action.bindAs] = memory; state.pc++;
        }
        else if (instruction.type === "MOVE_RESULT") {
          ensureMove(state.lastMoveResult && state.lastMoveResult.afterRevision === state.worldRevision, "v3-move-result-not-current");
          state.resultScopes ??= state.scopes.map(() => ({}));
          state.resultScopes.at(-1)![instruction.bindAs] = state.lastMoveResult; state.lastMoveResult = null; state.pc++;
        }
        else if (instruction.type === "JUMP") state.pc = instruction.to;
        else if (instruction.type === "BIND_SOURCE") { state.scopes.at(-1)![instruction.bindAs] = [{ ...state.identity.source }]; state.pc++; }
        else if (instruction.type === "TRIGGER_END") {
          if (this.#environment.lifeTriggerPlay?.() === "PLAYED") { state.pc++; continue; }
          state.pending = { kind: "work", type: "FINISH_LIFE_TRIGGER", workId, worldRevision: state.worldRevision }; state.status = "waitingForWork";
        }
        else if (instruction.type === "END") {
          if (state.revealsOpen) { state.pending = { kind: "work", type: "CLOSE_REVEALS", workId: `${workId}:cleanup`, worldRevision: state.worldRevision }; state.status = "waitingForWork"; }
          else state.status = "completed";
        }
        else if (instruction.type === "PLAY_SLOT_REVEAL") {
          if (this.#environment.characterPlayPrevented?.()) { state.pc++; continue; }
          const { action } = instruction, cards = this.#bindings(state)[action.cards.ref.slice("bindings.".length)];
          ensureMove(cards && cards.length <= 5, "v3-effect-play-slot-scope");
          if (cards.length > 1 && !state.playSequence) {
            ensureMove(action.from === "hand" && (this.#card.definition.schemaVersion === "3.0.0-subset.53" || (this.#card.definition.schemaVersion === "3.0.0-subset.54" || (this.#card.definition.schemaVersion === "3.0.0-subset.55" || (this.#card.definition.schemaVersion === "3.0.0-subset.56" || (this.#card.definition.schemaVersion === "3.0.0-subset.57" || (this.#card.definition.schemaVersion === "3.0.0-subset.58" || (this.#card.definition.schemaVersion === "3.0.0-subset.59" || (this.#card.definition.schemaVersion === "3.0.0-subset.60" || (this.#card.definition.schemaVersion === "3.0.0-subset.61" || this.#card.definition.schemaVersion === "3.0.0-subset.62"))))))))), "v3-effect-play-sequence-scope");
            if (!cards.every(ref => this.#evaluate(action.condition, state, ref))) { state.status = "blocked"; return; }
            state.playSequence = { firstPc: state.pc, index: 0 };
          }
          const card = state.playSequence ? cards[state.playSequence.index] : cards[0];
          if (!this.#playSlotShortage(card ? 1 : 0)) { state.pc++; continue; }
          ensureMove(card, "v3-effect-play-missing-card");
          if (!state.playSequence && !this.#evaluate(action.condition, state, card)) { state.status = "blocked"; return; }
          const revealId = state.playSequence ? `${state.identity.resolutionId}:${state.pc}:${state.playSequence.index}` : workId;
          state.pending = { kind: "work", type: "REVEAL", workId: revealId, worldRevision: state.worldRevision, cards: [structuredClone(card)], playSlot: true };
          state.status = "waitingForWork";
        }
        else if (instruction.type === "WORK") {
          const action = instruction.action;
          if (action.type === "DRAW") state.pending = { kind: "work", type: "DRAW", workId, worldRevision: state.worldRevision, player: relative(state.identity.actor, action.player), count: action.count };
          else if (action.type === "PREVENT_CHARACTER_PLAY") state.pending = { kind: "work", type: "GRANT_KEYWORD", workId, worldRevision: state.worldRevision,
            cards: [], keyword: { type: action.type }, duration: { type: "TURN_END", player: "SELF", occurrence: 1 } };
          else if (action.type === "PLAY_TRIGGER_SOURCE") {
            if (this.#environment.characterPlayPrevented?.()) { state.pc++; continue; }
            const slot = this.#bindings(state)[lifeSlotBinding], status = this.#environment.lifeTriggerPlay?.(), zone = this.#card.definition.cardType;
            ensureMove((zone === "character" || zone === "stage") && slot &&
              (status === "OPEN" && !slot.length || status === "FULL" && slot.length === 1), "v3-trigger-play-slot");
            state.pending = { kind: "work", type: "PLAY_BY_EFFECT", workId, worldRevision: state.worldRevision, cards: [{ ...state.identity.source }],
              from: "resolving", replace: slot[0] ? { ...slot[0] } : null, destination: { owner: "SELF", zone, slotPolicy: "FIRST_EMPTY" },
              enterState: "ACTIVE", provenance: "EFFECT" };
          }
          else if (action.type === "EXTRA_TURN") state.pending = { kind: "work", type: "EXTRA_TURN", workId, worldRevision: state.worldRevision };
          else if (action.type === "ADD_DON") state.pending = { kind: "work", type: "ADD_DON", workId, worldRevision: state.worldRevision, player: state.identity.actor, count: action.count, state: action.state, onInsufficient: action.onInsufficient };
          else if (action.type === "ATTACH_DON") {
            const bindings = this.#bindings(state);
            const assignments = action.assignments.flatMap(row => {
              const cards = bindings[row.cards.ref.slice("bindings.".length)], target = bindings[row.target.ref.slice("bindings.".length)];
              ensureMove(cards && target && (!cards.length || target.length === 1), "v3-don-attachment-binding");
              return cards.map(card => ({ card, target: target[0]! }));
            });
            if (!assignments.length) { state.pc++; continue; }
            state.pending = { kind: "work", type: "ATTACH_DON", workId, worldRevision: state.worldRevision, from: action.from, assignments: structuredClone(assignments) };
          }
          else if (action.type === "MOVE_LIFE") {
            const player = relative(state.identity.actor, action.player);
            let cards: readonly Ref[];
            if (action.from === "BOUND") {
              const bound = this.#bindings(state)[action.cards.ref.slice("bindings.".length)];
              ensureMove(bound && bound.length <= 1, "v3-life-move-binding");
              cards = bound;
            } else {
              ensureMove(this.#environment.lifeMoveCard, "v3-life-move-unavailable");
              const ref = this.#environment.lifeMoveCard(player, action.from);
              cards = ref ? [ref] : [];
            }
            if (!cards.length) {
              state.lastMoveResult = emptyMoveResult(state.identity, workId, state.worldRevision);
              state.pc++; continue;
            }
            state.pending = { kind: "work", type: "MOVE_LIFE", workId, worldRevision: state.worldRevision, player,
              from: action.from, to: action.to, faceUp: "faceUp" in action ? action.faceUp : action.to !== "DECK_BOTTOM", cards: structuredClone([...cards]) };
          }
          else if (action.type === "LOOK_TOP") {
            const cards = this.#environment.peekTop?.(action.count) ?? "unknown"; ensureMove(cards !== "unknown", "v3-look-candidates-unknown"); dataArray(cards, action.count);
            cards.forEach(reference); ensureMove(new Set(cards.map(ref => ref.instanceId)).size === cards.length && (action.onInsufficient === "takeAvailable" || cards.length === action.count), "v3-invalid-or-insufficient-look-candidates");
            if (!cards.length) { state.scopes.at(-1)![action.bindAs] = []; state.pc++; continue; }
            state.pending = { kind: "work", type: "LOOK_TOP", workId, worldRevision: state.worldRevision, cards: structuredClone(cards), bindAs: action.bindAs };
          }
          else if (action.type === "SHUFFLE_DECK") state.pending = { kind: "work", type: "SHUFFLE_DECK", workId, worldRevision: state.worldRevision };
          else if (action.type === "TRASH_DECK_TOP") {
            const count = typeof action.count === "number" ? action.count : this.#environment.numeric?.(action.count, this.#bindings(state));
            ensureMove(typeof count === "number" && Number.isSafeInteger(count) && count >= 0 && count <= 50, "v3-deck-top-unknown-count");
            if (!count) { state.pc++; continue; }
            const cards = this.#environment.peekTop?.(count) ?? "unknown";
            ensureMove(cards !== "unknown", "v3-deck-top-unknown");
            if (!cards.length) { state.pc++; continue; }
            state.pending = { kind: "work", type: "TRASH_DECK_TOP", workId, worldRevision: state.worldRevision, count };
          }
          else if (action.type === "DISCARD_BY_OWNER" || action.type === "ORDER_THEN_MOVE") {
            const rows = this.#ownerHandRows(state, action), count = Math.min(rows.length, action.count);
            if (!count) { state.pc++; continue; }
            state.pending = { ...this.#choiceBase(relative(state.identity.actor, action.chooser)), purpose: action.type === "ORDER_THEN_MOVE" ? "ownerDeckBottom" : "ownerDiscard",
              min: count, max: count, maxActiveReturn: null, bindAs: null,
              candidates: rows.map(row => ({ token: randomUUID(), cardId: row.cardId, zone: row.zone, label: null, ref: { ...row.ref } })) };
            state.status = "waitingForChoice";
            continue;
          }
          else {
            const bindings = this.#bindings(state);
            let cards = bindings[action.cards.ref.slice("bindings.".length)]; ensureMove(cards, "v3-missing-runtime-binding");
            if (action.type === "MOVE_CARD" && action.excludeCards) {
              const excluded = bindings[action.excludeCards.ref.slice("bindings.".length)];
              const same = (a: Ref, b: Ref) => a.instanceId === b.instanceId && a.generation === b.generation;
              const bound = cards;
              ensureMove(excluded && excluded.every(ref => bound.some(card => same(ref, card))), "v3-move-remainder-outside-binding");
              cards = bound.filter(ref => !excluded.some(card => same(ref, card)));
            }
            if (!cards.length) {
              if ((action.type === "MOVE_CARD" || action.type === "PLAY_BY_EFFECT") && ["3.0.0-subset.25", "3.0.0-subset.26", "3.0.0-subset.27", "3.0.0-subset.28", "3.0.0-subset.29", "3.0.0-subset.30", "3.0.0-subset.31", "3.0.0-subset.32", "3.0.0-subset.33", "3.0.0-subset.34", "3.0.0-subset.35", "3.0.0-subset.36", "3.0.0-subset.37", "3.0.0-subset.38", "3.0.0-subset.39", "3.0.0-subset.40", "3.0.0-subset.41", "3.0.0-subset.42", "3.0.0-subset.43", "3.0.0-subset.44", "3.0.0-subset.45", "3.0.0-subset.46", "3.0.0-subset.47", "3.0.0-subset.48", "3.0.0-subset.49", "3.0.0-subset.50", "3.0.0-subset.51", "3.0.0-subset.52", "3.0.0-subset.53", "3.0.0-subset.54", "3.0.0-subset.55", "3.0.0-subset.56", "3.0.0-subset.57", "3.0.0-subset.58", "3.0.0-subset.59", "3.0.0-subset.60", "3.0.0-subset.61", "3.0.0-subset.62"].includes(this.#card.definition.schemaVersion)) state.lastMoveResult = emptyMoveResult(state.identity, workId, state.worldRevision);
              state.pc++; continue;
            }
            if (action.type === "PLAY_BY_EFFECT") {
              if (this.#environment.characterPlayPrevented?.()) { state.lastMoveResult = emptyMoveResult(state.identity, workId, state.worldRevision); state.pc++; continue; }
              const sequence = state.playSequence;
              if (sequence) {
                const card = cards[sequence.index];
                ensureMove(card && action.from === "hand" && action.destination.slotPolicy === "REPLACE_IF_FULL", "v3-effect-play-sequence-card");
                cards = [card];
              } else if (!cards.every(ref => this.#evaluate(action.condition, state, ref))) { state.status = "blocked"; return; }
              state.pending = { kind: "work", type: "PLAY_BY_EFFECT", workId, worldRevision: state.worldRevision, cards: structuredClone(cards), from: action.from,
                destination: { ...action.destination }, enterState: action.enterState, provenance: action.provenance,
                ...(action.destination.slotPolicy === "REPLACE_IF_FULL" ? { replace: this.#bindings(state)[effectSlotBinding]?.[0] ?? null } : {}),
                ...(sequence ? { entrySequence: `${state.identity.resolutionId}:${sequence.firstPc}` } : {}) };
            } else state.pending = action.type === "SET_DON_STATE" ? { kind: "work", type: "SET_DON_STATE", workId, worldRevision: state.worldRevision, cards: structuredClone(cards), from: action.from, to: action.to } :
              action.type === "RETURN_DON_BY_EFFECT" ? { kind: "work", type: "RETURN_DON_BY_EFFECT", workId, worldRevision: state.worldRevision, cards: structuredClone(cards), from: [...action.from] } :
              action.type === "MOVE_CARD" ? { kind: "work", type: "MOVE_CARD", workId, worldRevision: state.worldRevision, cards: structuredClone(cards),
                destination: { ...action.destination }, cause: "EFFECT", ...(action.excludeCards ? { inspectedOnly: true as const } : {}) } :
              action.type === "MODIFY_STAT" ? { kind: "work", type: "MODIFY_STAT", workId, worldRevision: state.worldRevision, cards: structuredClone(cards),
                stat: action.stat, amount: action.amount, duration: { ...action.duration }, ...(action.mode ? { mode: action.mode } : {}) } :
              action.type === "GRANT_KEYWORD" || action.type === "SKIP_REFRESH" || action.type === "DISABLE_CARD_EFFECTS" || action.type === "PREVENT_BLOCKER" ?
                { kind: "work", type: "GRANT_KEYWORD", workId, worldRevision: state.worldRevision, cards: structuredClone(cards),
                  keyword: action.type === "GRANT_KEYWORD" ? { ...action.keyword } : { type: action.type },
                  duration: action.type === "DISABLE_CARD_EFFECTS" || action.type === "PREVENT_BLOCKER" ?
                    { type: "TURN_END", player: "SELF", occurrence: 1 } : { ...action.duration } } :
              action.type === "RETURN_TO_DECK" ? { kind: "work", type: "RETURN_TO_DECK", workId, worldRevision: state.worldRevision, cards: structuredClone(cards), position: action.position } :
              { kind: "work", type: action.type, workId, worldRevision: state.worldRevision, cards: structuredClone(cards) };
          }
          state.status = "waitingForWork";
        } else if (instruction.type === "SELECT") {
          if (instruction.playCards) {
            const cards = this.#bindings(state)[instruction.playCards.ref.slice("bindings.".length)];
            ensureMove(cards && cards.length <= 5, "v3-effect-play-slot-scope");
            const need = this.#playSlotShortage(cards.length ? 1 : 0);
            if (!need) { state.scopes.at(-1)![effectSlotBinding] = []; state.pc++; continue; }
            this.#select(state, { ...instruction.action.selector, min: need, max: need }, instruction.action.bindAs, undefined, false, true);
            continue;
          } else if (instruction.ruleSlot) {
            const status = this.#environment.lifeTriggerPlay?.();
            ensureMove(status === "OPEN" || status === "FULL", "v3-trigger-play-slot");
            if (status === "OPEN") { state.scopes.at(-1)![lifeSlotBinding] = []; state.pc++; continue; }
          }
          this.#select(state, instruction.action.selector, instruction.action.bindAs, undefined, false, instruction.ruleSlot,
            instruction.action.automatic === "ALL");
        }
        else if (instruction.type === "ORDER") {
          const action = instruction.action, bound = this.#bindings(state)[action.cards.ref.slice("bindings.".length)]; ensureMove(bound, "v3-missing-order-binding");
          this.#select(state, { type: "BOUND_CARDS", cards: action.cards, excludeCards: action.excludeCards, owner: "SELF", controller: "SELF", chooser: "SELF", zone: "deck",
            visibility: "OWNER_ONLY", faceUpOnly: false, cardTypes: ["character", "stage", "event"], filters: { type: "all", conditions: [] }, excludeSource: false,
            min: 0, max: Math.max(1, bound.length), selectionMode: "SELECT", order: "UNORDERED", onInsufficient: "fail" }, action.bindAs, "order");
        }
      }
    });
  }
  #playSlotShortage(count: number): number {
    if (this.#environment.characterPlayPrevented?.()) return 0;
    if (count === 0) return 0;
    const full = this.#environment.effectPlayFull?.();
    ensureMove(count === 1 && full !== undefined, "v3-effect-play-slot-scope");
    return Number(full);
  }
  #select(state: State, selector: Selector, bindAs: string | null, purpose: "returnCost" | "order" | undefined = undefined, filteredCost = false, ruleSlot = false, automatic = false): void {
    const rows = this.#environment.candidates(selector, this.#bindings(state)); dataArray(rows, 256);
    let permittedBound: readonly Ref[] | null = null;
    if (selector.type === "BOUND_CARDS") {
      const bindings = this.#bindings(state), cards = bindings[selector.cards.ref.slice("bindings.".length)], excluded = selector.excludeCards ? bindings[selector.excludeCards.ref.slice("bindings.".length)] : [];
      ensureMove(cards && excluded, "v3-missing-bound-selector-binding");
      permittedBound = cards.filter(ref => !excluded.some(other => other.instanceId === ref.instanceId && other.generation === ref.generation));
    }
    const seen = new Set<string>(), candidates: CardChoice["candidates"] = [];
    const costs = this.#costsAt(state);
    const reserveAttached = purpose === "returnCost" && movesActivationSource(costs);
    for (const row of rows) {
      reference(row.ref); label(row.cardId); ensureMove(!seen.has(row.ref.instanceId), "v3-duplicate-candidate"); seen.add(row.ref.instanceId);
      ensureMove(!permittedBound || permittedBound.some(ref => ref.instanceId === row.ref.instanceId && ref.generation === row.ref.generation), "v3-candidate-outside-bound-set");
      const visible = selector.type === "BOUND_CARDS" ? row.zone === "deck" && row.owner === state.identity.actor && row.controller === state.identity.actor && row.visibleTo.includes(state.identity.actor) : selector.visibility === "PUBLIC" ? row.faceUp === true && row.visibleTo.includes(0) && row.visibleTo.includes(1) :
        row.zone === "hand" && row.owner === state.identity.actor && row.controller === state.identity.actor && row.visibleTo.includes(state.identity.actor) && !row.visibleTo.includes((1 - state.identity.actor) as Seat);
      ensureMove(visible && matchesSide(row.owner, state.identity.actor, selector.owner) &&
        matchesSide(row.controller, state.identity.actor, selector.controller) && (typeof selector.zone === "string" ? row.zone === selector.zone : selector.zone.some(zone => zone === row.zone)) && selector.cardTypes.some(type => type === row.kind), "v3-nonpublic-or-ineligible-candidate");
      if (selector.excludeSource && row.ref.instanceId === state.identity.source.instanceId && row.ref.generation === state.identity.source.generation) continue;
      if (filteredCost && costs.some(cost => cost.type === "REST_AS_COST") && row.rotated !== false) continue;
      if (reserveAttached && row.attachedTo?.instanceId === state.identity.source.instanceId && row.attachedTo.generation === state.identity.source.generation) continue;
      if (bindAs === null && !purpose && !filteredCost && state.costSelected?.some(ref => ref.instanceId === row.ref.instanceId)) continue;
      const protectedTarget = bindAs !== null && !purpose && !ruleSlot && !automatic && selector.visibility === "PUBLIC" ? this.#environment.targetProtection?.(row.ref) ?? false : false;
      if (protectedTarget === true || !this.#evaluate(selector.filters, state, row.ref)) continue;
      ensureMove(protectedTarget !== "unknown", "v3-target-protection-unknown");
      const displayLabel = ruleSlot ? `${row.zone === "stage" ? "ステージ" : `キャラ枠${candidates.length + 1}`}をトラッシュへ` :
        purpose === "returnCost" ? row.label ?? row.zone : null;
      ensureMove(displayLabel === null || typeof displayLabel === "string" && displayLabel.length > 0 && displayLabel.length <= 80, "v3-candidate-label");
      candidates.push({ token: automatic ? "" : randomUUID(), cardId: row.cardId, zone: row.zone, label: displayLabel, ref: { ...row.ref } });
    }
    if (automatic) {
      ensureMove(bindAs !== null && !purpose && !ruleSlot && !filteredCost && selector.visibility === "PUBLIC" &&
        candidates.length <= selector.max, "v3-invalid-automatic-selection");
      state.scopes.at(-1)![bindAs] = candidates.map(candidate => candidate.ref);
      state.pc++;
      return;
    }
    if (purpose === "order" && selector.type === "BOUND_CARDS") {
      const remaining = permittedBound!;
      ensureMove(remaining.length === candidates.length && remaining.every(ref => candidates.some(candidate => candidate.ref.instanceId === ref.instanceId && candidate.ref.generation === ref.generation)), "v3-incomplete-order-candidates");
    }
    ensureMove(candidates.length >= selector.min || selector.onInsufficient === "skip" && !candidates.length && bindAs !== null, "v3-insufficient-candidates");
    if (!candidates.length) { ensureMove(bindAs !== null, "v3-empty-required-cost-selection"); state.scopes.at(-1)![bindAs] = []; state.pc++; return; }
    const rest = costs.reduce((sum, cost) => sum + (cost.type === "REST_DON" ? cost.count : 0), 0);
    const maxActiveReturn = purpose === "returnCost" ? Math.min(selector.max, Math.max(0, candidates.filter(candidate => candidate.zone === "activeDon").length - rest)) : null;
    state.pending = { ...this.#choiceBase(relative(state.identity.actor, selector.chooser)), purpose: purpose ?? (bindAs === null ? "cost" : "action"),
      min: purpose === "order" ? candidates.length : selector.min, max: purpose === "order" ? candidates.length : selector.max, maxActiveReturn, bindAs, candidates, ...(filteredCost ? { filteredCost: true } : {}) };
    state.status = "waitingForChoice";
  }
  #offerReplacementTier(state: State, work: WorkRequest, plans: readonly ReplacementPlan[]): void {
    const priority = Math.min(...plans.map(plan => plan.priority ?? Infinity));
    const current = plans.filter(plan => plan.priority === priority), first = current[0];
    ensureMove(first && current.every(plan => plan.chooser === first.chooser), "v3-replacement-tier-mismatch");
    const candidates: CardChoice["candidates"] = current.flatMap(plan => {
      const payment = plan.payment, source = plan.cause.source;
      ensureMove(source, "v3-replacement-source-required");
      if (!payment) return [{ token: randomUUID(), cardId: plan.sourceCardId, ref: { ...source }, zone: plan.intent.operation.from.zone,
        candidateId: plan.candidateId, label: `${plan.sourceLabel}：${replacementLabel(plan.substitute)}${plan.group ? `（${plan.group.protectedCards.length}枚対象）` : ""}` }];
      return payment.candidates === "unknown" ? [] : payment.candidates.map(row => ({
        token: randomUUID(), cardId: row.cardId, ref: { ...row.ref }, zone: row.zone, candidateId: plan.candidateId,
        label: `${plan.sourceLabel}：${row.label ?? payment.label}`
      }));
    });
    state.replacement = { work, plans: structuredClone(current), remaining: structuredClone(plans.filter(plan => plan.priority !== priority)), decision: null };
    state.pending = { ...this.#singleChoice(state), chooser: first.chooser, purpose: "replacementPriority", min: 0, bindAs: null, candidates };
    state.status = "waitingForChoice";
  }
  offerReplacement(requestId: string, expectedRevision: number, plans: readonly ReplacementPlan[]): { replayed: boolean } {
    return this.#command(requestId, expectedRevision, { kind: "offerReplacement", plans }, state => {
      const plan = plans[0];
      ensureMove(plan && plans.length <= 64 && plans.every(other => other.intent.id === plan.intent.id && other.chooser === plan.chooser) &&
        new Set(plans.map(other => other.candidateId)).size === plans.length, "v3-replacement-offer-mismatch");
      const work = state.pending, intent = plan.intent, target = intent.operation.card;
      ensureMove(state.status === "waitingForWork" && work?.kind === "work" && (work.type === "KO" || work.type === "MOVE_CARD") &&
        work.workId === intent.workId && (plan.group ? plans.every(option => option.group?.protectedCards.length && option.group.protectedCards.every(ref =>
          work.cards.some(card => card.instanceId === ref.instanceId && card.generation === ref.generation))) :
          work.cards.length === 1 && work.cards[0]?.instanceId === target.instanceId && work.cards[0].generation === target.generation) &&
        JSON.stringify(this.#executionIdentity(state)) === JSON.stringify(intent.identity) &&
        state.worldRevision === intent.worldRevision && this.#environment.revision() === state.worldRevision &&
        !state.replacement && !state.appliedReplacements?.some(row => row.intentId === intent.id), "v3-replacement-intent-mismatch");
      if (plan.priority !== undefined) { this.#offerReplacementTier(state, work, plans); return; }
      const choice = { ...this.#singleChoice(state), chooser: plan.chooser };
      if (plan.payment) {
        ensureMove(work.type === "KO" && plans.every(option => option.payment), "v3-paid-replacement-ko-only");
        const candidates = plans.flatMap((option, index) => {
          const payment = option.payment!;
          return payment.candidates === "unknown" ? [] : payment.candidates.map(({ cardId, ref }) => ({
            token: randomUUID(), ref: { ...ref }, cardId, zone: "hand", candidateId: option.candidateId,
            label: plans.length === 1 ? null : `置換${index + 1}：${payment.label}`
          }));
        });
        state.replacement = { work, plans: structuredClone(plans), decision: null };
        state.pending = { ...choice, purpose: "replacementPayment", min: 0, bindAs: null, candidates };
      } else {
        ensureMove(plans.length === 1, "v3-replacement-conflict-unresolved");
        state.replacement = { work, plan: structuredClone(plan), decision: null };
        state.pending = { ...choice, purpose: "replacement", candidates: [
          { token: randomUUID(), decision: "accepted", label: replacementLabel(plan.substitute) },
          { token: randomUUID(), decision: "declined", label: "置換しない" }
        ] };
      }
      state.status = "waitingForChoice";
    });
  }
  replacementForCoordinator(): ReplacementAnswer | null {
    const replacement = this.#state.replacement;
    if (!replacement?.decision) return null;
    const { work: _work, ...answer } = replacement;
    return freezeMovement(structuredClone(answer));
  }
  answer(actor: Seat, requestId: string, expectedRevision: number, selectionId: string, tokens: readonly string[]): { replayed: boolean } {
    label(selectionId); dataArray(tokens, 50); tokens.forEach(token => label(token));
    return this.#command(requestId, expectedRevision, { kind: "answer", actor, selectionId, tokens }, state => {
      const choice = state.pending;
      ensureMove(state.status === "waitingForChoice" && choice?.kind === "choice" && actor === choice.chooser && selectionId === choice.selectionId && this.#environment.revision() === state.worldRevision, "v3-not-current-chooser");
      const now = this.#environment.now(); ensureMove(Number.isSafeInteger(now) && now >= 0 && now < choice.expiresAt, "v3-choice-expired");
      ensureMove(new Set(tokens).size === tokens.length && tokens.length >= choice.min && tokens.length <= choice.max, "v3-choice-count");
      const selected = new Set(tokens); ensureMove(tokens.every(token => choice.candidates.some(candidate => candidate.token === token)), "v3-choice-token");
      if (choice.purpose === "effectBody") {
        const instruction = this.#code[state.pc], chosen = choice.candidates.find(row => selected.has(row.token))?.body;
        ensureMove(instruction?.type === "BODY_CHOICE" && !state.externalBody, "v3-effect-body-program-mismatch");
        if (chosen) {
          ensureMove(this.#environment.bodyCandidates?.(instruction.maxPrintedCost).some(row => JSON.stringify(row) === JSON.stringify(chosen)),
            "v3-effect-body-stale-choice");
          state.externalBody = chosen;
        } else state.pc++;
        state.pending = null; state.status = "ready"; return;
      }
      if (choice.purpose === "replacement") {
        const replacement = state.replacement;
        ensureMove(replacement && "plan" in replacement && replacement.decision === null && replacement.plan.chooser === actor &&
          replacement.plan.intent.worldRevision === state.worldRevision, "v3-replacement-intent-mismatch");
        state.replacement = { ...replacement, decision: choice.candidates.find(candidate => selected.has(candidate.token))!.decision };
        state.pending = replacement.work; state.status = "waitingForWork"; return;
      }
      if (choice.purpose === "replacementPayment" || choice.purpose === "replacementPriority") {
        const replacement = state.replacement, selectedCard = choice.candidates.find(candidate => selected.has(candidate.token));
        ensureMove(replacement && "plans" in replacement, "v3-replacement-intent-mismatch");
        if (!selectedCard && replacement.remaining?.length) { this.#offerReplacementTier(state, replacement.work, replacement.remaining); return; }
        const plan = selectedCard ? replacement.plans.find(row => row.candidateId === selectedCard.candidateId) : replacement.plans[0];
        const cards = plan?.payment?.candidates;
        ensureMove(plan && plan.chooser === actor && plan.intent.worldRevision === state.worldRevision &&
          (!plan.payment || !selectedCard || cards !== "unknown" && cards?.some(row => row.ref.instanceId === selectedCard.ref.instanceId &&
            row.ref.generation === selectedCard.ref.generation && row.cardId === selectedCard.cardId)), "v3-replacement-payment-mismatch");
        state.replacement = { work: replacement.work, plan, decision: selectedCard ? "accepted" : "declined",
          ...(selectedCard && plan.payment ? { paymentCard: { ...selectedCard.ref } } : {}) };
        state.pending = replacement.work; state.status = "waitingForWork"; return;
      }
      if (choice.purpose === "mode") {
        const branch = choice.candidates.find(candidate => selected.has(candidate.token))!;
        const instruction = this.#code[state.pc];
        ensureMove(instruction?.type === "MODE" && instruction.branches.some(row => row.to === branch.to && row.donCount === branch.donCount), "v3-choice-program-mismatch");
        if (branch.donCount !== undefined) ensureMove(branch.donCount <= availableDon(this.#environment), "v3-don-choice-stale");
        state.pc = branch.to; state.pending = null; state.status = "ready"; return;
      }
      if (choice.purpose === "activation" || choice.purpose === "payment") {
        const decision = choice.candidates.find(candidate => selected.has(candidate.token))!.decision;
        if (choice.purpose === "payment") {
          const instruction = this.#code[state.pc];
          ensureMove(instruction?.type === "OFFER_PAYMENT" && !state.paymentAccepted, "v3-choice-program-mismatch");
          if (decision === "accepted") state.paymentAccepted = true;
          else { this.#recordPayment(state, instruction.action, false); state.pc++; }
          state.pending = null; state.status = "ready"; return;
        }
        state.activationDecision = decision; state.pending = null;
        if (decision === "declined") state.status = "completed";
        else { state.status = "ready"; state.pc++; }
        return;
      }
      if (choice.purpose === "revealConfirmation") {
        state.pending = null; state.status = "ready"; return;
      }
      if (choice.purpose === "ownerDiscard" || choice.purpose === "ownerDeckBottom") {
        const instruction = this.#code[state.pc];
        const ordered = choice.purpose === "ownerDeckBottom";
        ensureMove(instruction?.type === "WORK" && (instruction.action.type === "ORDER_THEN_MOVE" || instruction.action.type === "DISCARD_BY_OWNER") &&
          ordered === (instruction.action.type === "ORDER_THEN_MOVE"), "v3-choice-program-mismatch");
        const action = instruction.action, rows = this.#ownerHandRows(state, action);
        const picked = ordered ? tokens.map(token => choice.candidates.find(candidate => candidate.token === token)!) :
          choice.candidates.filter(candidate => selected.has(candidate.token));
        ensureMove(picked.length === Math.min(rows.length, action.count) && picked.every(candidate => rows.some(row =>
          row.ref.instanceId === candidate.ref.instanceId && row.ref.generation === candidate.ref.generation && row.cardId === candidate.cardId)),
        "v3-owner-hand-stale-choice");
        // Public trash order must not encode the order of a hidden hand or of submitted tokens.
        if (!ordered) picked.sort((a, b) => a.cardId < b.cardId ? -1 : a.cardId > b.cardId ? 1 : a.ref.instanceId < b.ref.instanceId ? -1 : 1);
        state.pending = { kind: "work", type: action.type, workId: `${state.identity.resolutionId}:${state.pc}`,
          worldRevision: state.worldRevision, owner: actor, count: action.count, cards: picked.map(candidate => ({ ...candidate.ref })) };
        state.status = "waitingForWork";
        return;
      }
      // UNORDERED input is canonicalized to server candidate order, not client token order.
      const entryOrder = choice.purpose === "action" && choice.max > 1 &&
        (this.#card.definition.schemaVersion === "3.0.0-subset.53" || (this.#card.definition.schemaVersion === "3.0.0-subset.54" || (this.#card.definition.schemaVersion === "3.0.0-subset.55" || (this.#card.definition.schemaVersion === "3.0.0-subset.56" || (this.#card.definition.schemaVersion === "3.0.0-subset.57" || (this.#card.definition.schemaVersion === "3.0.0-subset.58" || (this.#card.definition.schemaVersion === "3.0.0-subset.59" || (this.#card.definition.schemaVersion === "3.0.0-subset.60" || (this.#card.definition.schemaVersion === "3.0.0-subset.61" || this.#card.definition.schemaVersion === "3.0.0-subset.62"))))))))) &&
        this.#code.some(row => row.type === "PLAY_SLOT_REVEAL" && row.action.from === "hand" && row.action.cards.ref === `bindings.${choice.bindAs}`);
      const cards = choice.purpose === "order" || entryOrder ? tokens.map(token => ({ ...choice.candidates.find(candidate => candidate.token === token)!.ref })) : choice.candidates.filter(candidate => selected.has(candidate.token)).map(candidate => ({ ...candidate.ref }));
      if (choice.purpose === "action") {
        const instruction = this.#code[state.pc];
        ensureMove(instruction?.type === "SELECT", "v3-choice-program-mismatch");
        if (!instruction.ruleSlot && instruction.action.selector.visibility === "PUBLIC") ensureMove(
          cards.every(ref => (this.#environment.targetProtection?.(ref) ?? false) === false), "v3-choice-target-protected");
      }
      if (choice.purpose === "action" && (["3.0.0-subset.22", "3.0.0-subset.23", "3.0.0-subset.24", "3.0.0-subset.25", "3.0.0-subset.26", "3.0.0-subset.27", "3.0.0-subset.28", "3.0.0-subset.29", "3.0.0-subset.30", "3.0.0-subset.31", "3.0.0-subset.32", "3.0.0-subset.33", "3.0.0-subset.34", "3.0.0-subset.35", "3.0.0-subset.36", "3.0.0-subset.37", "3.0.0-subset.38", "3.0.0-subset.39", "3.0.0-subset.40", "3.0.0-subset.41", "3.0.0-subset.42", "3.0.0-subset.43", "3.0.0-subset.44", "3.0.0-subset.45", "3.0.0-subset.46", "3.0.0-subset.47", "3.0.0-subset.48", "3.0.0-subset.49", "3.0.0-subset.50", "3.0.0-subset.51", "3.0.0-subset.52", "3.0.0-subset.53", "3.0.0-subset.54", "3.0.0-subset.55", "3.0.0-subset.56", "3.0.0-subset.57", "3.0.0-subset.58", "3.0.0-subset.59", "3.0.0-subset.60", "3.0.0-subset.61", "3.0.0-subset.62"].includes(this.#card.definition.schemaVersion) || ["3.0.0-subset.20", "3.0.0-subset.21"].includes(this.#card.definition.schemaVersion) && this.#card.definition.cardType === "event" && this.#card.definition.effects.find(effect => effect.id === state.identity.effectId)?.timing.type === "MAIN")) {
        const instruction = this.#code[state.pc]; ensureMove(instruction?.type === "SELECT", "v3-choice-program-mismatch");
        const selector = instruction.action.selector, rows = this.#environment.candidates(selector, this.#bindings(state));
        for (const ref of cards) {
          const original = choice.candidates.find(row => row.ref.instanceId === ref.instanceId && row.ref.generation === ref.generation)!;
          const current = rows.find(row => row.ref.instanceId === ref.instanceId && row.ref.generation === ref.generation && row.cardId === original.cardId && row.zone === original.zone);
          ensureMove(current && matchesSide(current.owner, state.identity.actor, selector.owner) && matchesSide(current.controller, state.identity.actor, selector.controller) &&
            (selector.visibility === "PUBLIC" ? current.faceUp && current.visibleTo.includes(0) && current.visibleTo.includes(1) : current.visibleTo.includes(state.identity.actor) && !current.visibleTo.includes((1 - state.identity.actor) as Seat)) &&
            selector.cardTypes.some(kind => kind === current.kind) && this.#evaluate(selector.filters, state, ref), "v3-choice-target-stale");
        }
      }
      if (choice.purpose === "cost") {
        if (choice.filteredCost || state.costSelected) {
          const costs = this.#costsAt(state);
          ensureMove(this.#environment.canPayCosts?.(costs, choice.filteredCost ? state.costCards : cards, state.costReturned, choice.filteredCost ? cards : state.costSelected) === true, "v3-filtered-cost-unpayable-selection");
        }
        if (choice.filteredCost) state.costSelected = cards;
        else state.costCards = cards;
      }
      else if (choice.purpose === "returnCost") {
        ensureMove(choice.maxActiveReturn !== null && choice.candidates.filter(candidate => selected.has(candidate.token) && candidate.zone === "activeDon").length <= choice.maxActiveReturn, "v3-return-cost-active-reserved");
        const costs = this.#costsAt(state);
        ensureMove(this.#environment.canPayCosts?.(costs, state.costCards, cards, state.costSelected) === true, "v3-return-cost-unpayable-selection");
        state.costReturned = cards;
      }
      else { ensureMove(choice.bindAs !== null, "v3-action-binding-required"); state.scopes.at(-1)![choice.bindAs] = cards; state.pc++; }
      state.pending = null; state.status = "ready";
    });
  }
  settleWork(requestId: string, expectedRevision: number, workId: string, outcome: "applied" | "rejected", worldRevision: number, result?: MoveResult, revealedCardIds?: readonly string[]): { replayed: boolean } {
    if (result) ensureMove(isCertifiedMoveResult(result), "v3-untrusted-move-result");
    return this.#command(requestId, expectedRevision, { kind: "settleWork", workId, outcome, worldRevision, ...(result ? { result } : {}), ...(revealedCardIds ? { revealedCardIds } : {}) }, state => {
      const work = state.pending; ensureMove(state.status === "waitingForWork" && work?.kind === "work" && work.workId === workId, "v3-work-not-pending");
      const acceptedGroup = state.replacement?.decision === "accepted" ? state.replacement.plan.group : undefined;
      const steps = work.type === "PLAY_BY_EFFECT" && work.replace || acceptedGroup?.remaining.length ? 2 : 1;
      ensureMove((outcome === "applied" || outcome === "rejected") && Number.isSafeInteger(worldRevision) && this.#environment.revision() === worldRevision &&
        worldRevision === state.worldRevision + (outcome === "applied" ? steps : 0), "v3-work-version-or-outcome");
      const replacement = state.replacement;
      if (replacement) {
        ensureMove(replacement.decision && replacement.work.workId === workId, "v3-replacement-intent-mismatch");
        if (outcome === "applied" && replacement.decision === "accepted") {
          (state.appliedReplacements ??= []).push({ intentId: replacement.plan.intent.id, candidateId: replacement.plan.candidateId });
        }
        delete state.replacement;
      }
      ensureMove(!result?.replaced || replacement?.decision === "accepted" && result.replaced.length === (acceptedGroup?.protectedCards.length ?? 1), "v3-replacement-result-mismatch");
      state.worldRevision = worldRevision; state.pending = null; state.status = outcome === "applied" ? "ready" : "blocked";
      const identity = this.#executionIdentity(state);
      if (result) ensureMove(outcome === "applied" && (work.type === "MOVE_CARD" || work.type === "PLAY_BY_EFFECT" || work.type === "MOVE_LIFE") && result.workId === workId && result.matchId === identity.matchId &&
        result.resolutionId === identity.resolutionId && result.effectId === identity.effectId && result.beforeRevision === work.worldRevision && result.afterRevision === worldRevision &&
        result.effectController === identity.actor && result.source.instanceId === identity.source.instanceId && result.source.generation === identity.source.generation &&
        result.rows.length + (result.prevented?.length ?? 0) + (result.replaced?.length ?? 0) === work.cards.length && work.cards.every(ref =>
          result.rows.some(row => row.event.before?.instanceId === ref.instanceId && row.event.before.generation === ref.generation) ||
          result.prevented?.some(row => row.instanceId === ref.instanceId && row.generation === ref.generation) ||
          result.replaced?.some(row => row.instanceId === ref.instanceId && row.generation === ref.generation)), "v3-move-result-work-mismatch");
      if (outcome === "applied" && (work.type === "MOVE_CARD" || work.type === "PLAY_BY_EFFECT" && work.from === "hand" && work.destination.slotPolicy === "FIRST_EMPTY" || work.type === "MOVE_LIFE") && ["3.0.0-subset.25", "3.0.0-subset.26", "3.0.0-subset.27", "3.0.0-subset.28", "3.0.0-subset.29", "3.0.0-subset.30", "3.0.0-subset.31", "3.0.0-subset.32", "3.0.0-subset.33", "3.0.0-subset.34", "3.0.0-subset.35", "3.0.0-subset.36", "3.0.0-subset.37", "3.0.0-subset.38", "3.0.0-subset.39", "3.0.0-subset.40", "3.0.0-subset.41", "3.0.0-subset.42", "3.0.0-subset.43", "3.0.0-subset.44", "3.0.0-subset.45", "3.0.0-subset.46", "3.0.0-subset.47", "3.0.0-subset.48", "3.0.0-subset.49", "3.0.0-subset.50", "3.0.0-subset.51", "3.0.0-subset.52", "3.0.0-subset.53", "3.0.0-subset.54", "3.0.0-subset.55", "3.0.0-subset.56", "3.0.0-subset.57", "3.0.0-subset.58", "3.0.0-subset.59", "3.0.0-subset.60", "3.0.0-subset.61", "3.0.0-subset.62"].includes(this.#card.definition.schemaVersion)) {
        ensureMove(result, "v3-move-result-required"); state.lastMoveResult = result;
      }
      if (outcome === "applied" && work.type === "PLAY_BY_EFFECT" && work.destination.slotPolicy === "REPLACE_IF_FULL") state.lastMoveResult = null;
      if (outcome === "applied") {
        if (work.type === "PAY_COSTS") {
          state.costCards = null; state.costReturned = null; delete state.costSelected;
          const instruction = this.#code[state.pc];
          if (work.duringEffect) {
            ensureMove(instruction?.type === "OFFER_PAYMENT" && state.paymentAccepted, "v3-payment-work-mismatch");
            this.#recordPayment(state, instruction.action, true);
          } else { state.paidCostWorkId = work.workId; state.activationCommitted = true; }
          if (work.costs.some(cost => cost.type === "REVEAL_CARDS")) state.revealsOpen = true;
          if (work.costs.some(cost => cost.type === "REVEAL_CARDS" && cost.confirmation === "OPPONENT")) {
            ensureMove(revealedCardIds?.length && revealedCardIds.length === work.selected?.length, "v3-reveal-confirmation-cards");
            const chooser = relative(this.#executionIdentity(state).actor, "OPPONENT");
            state.pending = { ...this.#singleChoice(state), chooser, purpose: "revealConfirmation",
              revealedCardIds: [...revealedCardIds].sort(), candidates: [{ token: randomUUID(), label: "確認して承認" }] };
            state.status = "waitingForChoice";
          }
        }
        if (work.type === "LOOK_TOP") state.scopes.at(-1)![work.bindAs] = work.cards.map(ref => ({ ...ref }));
        if (work.type === "LOOK_TOP" || work.type === "REVEAL") state.revealsOpen = true;
        if (work.type === "CLOSE_REVEALS") state.revealsOpen = false;
        else if (work.type === "PLAY_BY_EFFECT" && work.from !== "resolving" && work.entrySequence) {
          const sequence = state.playSequence, instruction = this.#code[state.pc];
          ensureMove(sequence && instruction?.type === "WORK" && instruction.action.type === "PLAY_BY_EFFECT", "v3-effect-play-sequence-work");
          const cards = this.#bindings(state)[instruction.action.cards.ref.slice("bindings.".length)];
          ensureMove(cards && sequence.index < cards.length, "v3-effect-play-sequence-binding");
          if (++sequence.index < cards.length) state.pc = sequence.firstPc;
          else { delete state.playSequence; state.pc++; }
        } else state.pc++;
      }
    });
  }
  finishForGameOutcome(expectedRevision: number, worldRevision: number): void {
    ensureMove(this.#state.revision === expectedRevision && this.#state.status === "ready" && this.#state.pending === null && this.#state.worldRevision === worldRevision &&
      this.#environment.revision() === worldRevision && this.#state.revision < Number.MAX_SAFE_INTEGER, "v3-game-end-context-mismatch");
    this.#state = { ...this.#state, revision: this.#state.revision + 1, status: "completed", interruptedByGameEnd: true, revealsOpen: false };
  }
  workForCoordinator(): WorkRequest | null { return this.#state.pending?.kind === "work" ? freezeMovement(structuredClone(this.#state.pending)) : null; }
  bodyEffectForCoordinator(): string | null { return this.#bodyEffectId; }
  externalBodyForCoordinator(): Readonly<{ identity: ResolutionIdentity; limited: boolean; target: ExternalBodyRef }> | null {
    return this.#state.externalBody ? freezeMovement(structuredClone({ identity: this.#executionIdentity(this.#state),
      limited: this.#bodyLimited, target: this.#state.externalBody })) : null;
  }
  viewFor(viewer: Seat) {
    ensureMove(viewer === 0 || viewer === 1, "v3-invalid-viewer"); const choice = this.#state.pending?.kind === "choice" ? this.#state.pending : null;
    const common = choice ? { selectionId: choice.selectionId, chooser: choice.chooser, min: choice.min, max: choice.max, maxActiveReturn: choice.maxActiveReturn, expiresAt: choice.expiresAt } : null;
    const projected = choice?.purpose === "revealConfirmation" ? { ...common!, purpose: choice.purpose,
      revealedCardIds: viewer === choice.chooser ? choice.revealedCardIds : [],
      options: viewer === choice.chooser ? choice.candidates : [] } :
      choice?.purpose === "activation" || choice?.purpose === "payment" || choice?.purpose === "mode" || choice?.purpose === "replacement" ? { ...common!, purpose: choice.purpose,
      options: viewer === choice.chooser ? choice.candidates.map(candidate => ({ token: candidate.token, label: candidate.label })) : [] } : choice ? { ...common!, purpose: choice.purpose,
      ...(choice.filteredCost && this.#costsAt(this.#state).some(cost => cost.type === "REVEAL_CARDS") ? { revealCost: true as const } : {}),
      ...(choice.filteredCost && this.#costsAt(this.#state).some(cost => cost.type === "KO_AS_COST") ? { koCost: true as const } : {}),
      options: viewer === choice.chooser ? choice.candidates.map(candidate => ({ token: candidate.token, cardId: candidate.cardId, zone: candidate.zone, label: candidate.label })) : [] } : null;
    return freezeMovement({ mode: "work_requests_only" as const, resolutionId: this.#state.identity.resolutionId, revision: this.#state.revision, worldRevision: this.#state.worldRevision, status: this.#state.status,
      activationDecision: this.#state.activationDecision, activationCommitted: this.#state.activationCommitted, interruptedByGameEnd: this.#state.interruptedByGameEnd, choice: projected });
  }
  exportForStorage(): string {
    const payload = JSON.stringify(this.#state); return JSON.stringify({ payload, signature: createHmac("sha256", this.#key).update(payload).digest("hex") });
  }
  static restore(card: ApprovedV3Card, identity: ResolutionIdentity, signingKey: Uint8Array, environment: ResolutionEnvironment, saved: string, expectedFrameRevision: number): V3ResolutionMachine {
    ensureMove(typeof saved === "string" && Buffer.byteLength(saved) <= 1048576, "v3-saved-frame-too-large");
    const machine = new V3ResolutionMachine(card, identity, signingKey, environment), envelope: unknown = JSON.parse(saved);
    dataObject(envelope, ["payload", "signature"]); ensureMove(typeof envelope.payload === "string" && typeof envelope.signature === "string" && /^[a-f0-9]{64}$/.test(envelope.signature), "v3-invalid-saved-envelope");
    const expected = createHmac("sha256", machine.#key).update(envelope.payload).digest();
    ensureMove(timingSafeEqual(expected, Buffer.from(envelope.signature, "hex")), "v3-saved-signature-mismatch");
    const state = JSON.parse(envelope.payload) as State;
    ensureMove(Number.isSafeInteger(expectedFrameRevision) && expectedFrameRevision >= 0 && state.revision === expectedFrameRevision && state.version === "v3-frame.9" && typeof state.interruptedByGameEnd === "boolean" && (!state.interruptedByGameEnd || state.status === "completed") && state.definitionHash === card.definitionHash && state.compilerVersion === card.compilerVersion && state.registryHash === card.registryHash && state.rulesetVersion === card.rulesetVersion &&
      state.identity.matchId === identity.matchId && state.identity.resolutionId === identity.resolutionId && state.identity.effectId === identity.effectId && state.identity.actor === identity.actor && state.identity.source.instanceId === identity.source.instanceId && state.identity.source.generation === identity.source.generation && state.worldRevision === environment.revision(), "v3-saved-context-mismatch");
    machine.#bindExternalBody(state);
    machine.#state = state; return machine;
  }
}
