import type { Action, CardObjectRef, DeepReadonly, EffectDefinition } from "./types";
import { validateEffectDefinition } from "./validation";
import { MovementResolution, type ResolutionIdentity } from "../movement/resolution";
import { ensureMove, getCard, location } from "../movement/state";
import type { MovementOperation, MovementRules, MovementState, TransactionResult } from "../movement/types";
import { SelectionSession } from "./selectionSession";
import type { SelectionResult, SelectionView, Seat } from "./selectionTypes";
import { known, unknown, type FactRecord, type FactValue } from "./facts";
import type { Evaluation } from "./types";
import { createEvaluationBudget, evaluateCondition } from "./predicates";
import { movementSelectionSnapshot, movementSourceFacts } from "./movementSelection";
import { visibleTo } from "../movement/engine";
import { pinMasterFacts, type MasterFactOptions, type PinnedMasterFacts } from "./masterFacts";
import { prepareDonPayment, validateDonPayments, type DonPayment } from "./movementCosts";

type Leaf = DeepReadonly<Extract<Action, { kind: "draw" | "move" | "select" | "if" | "optional" }>>;
type Scope = { parent: Scope | null; bindings: Map<string, SelectionResult> };
type Guard = Readonly<{ branchId: number; value: boolean }>;
type Instruction = { action: Leaf; scope: Scope; guards: readonly Guard[]; branchId?: number };
export type SelectionPending = Readonly<{ kind: "selectionPending" }>;

// Server-only adapter: activation legality must be established by the future match coordinator.
export class PreparedMovementEffect {
  #resolution: MovementResolution;
  #instructions: Instruction[] = [];
  #cursor = 0;
  #actor: 0 | 1;
  #busy = false;
  #pending: SelectionSession | null = null;
  #resolutionId: string;
  #sourceFacts: FactRecord;
  #branches = new Map<number, boolean>();
  #nextBranchId = 0;
  #conditionBudget = createEvaluationBudget();
  #catalog: PinnedMasterFacts;
  #costs: readonly DonPayment[];
  constructor(state: MovementState, identity: ResolutionIdentity, input: unknown, masterOptions?: MasterFactOptions) {
    const definition = validateEffectDefinition(input).definition;
    ensureMove(definition.condition === undefined, "action-runtime-condition-not-supported");
    this.#costs = definition.costs.map(cost => {
      ensureMove(cost.kind === "payDon", "action-runtime-cost-kind-not-supported");
      return cost;
    });
    validateDonPayments(this.#costs);
    ensureMove(identity.source !== null, "action-runtime-source-required");
    const source = getCard(state, identity.source!);
    ensureMove(source.cardId === definition.cardId && source.controller === identity.actor, "action-runtime-source-mismatch");
    this.#actor = identity.actor;
    this.#resolutionId = identity.resolutionId;
    this.#catalog = pinMasterFacts(state, masterOptions);
    this.#sourceFacts = movementSourceFacts(state, identity.source!, this.#catalog);
    this.#compile(definition.actions, { parent: null, bindings: new Map() });
    this.#resolution = new MovementResolution(state, identity);
  }
  #compile(actions: DeepReadonly<EffectDefinition["actions"]>, scope: Scope, guards: readonly Guard[] = []): void {
    for (const action of actions) {
      switch (action.kind) {
        case "sequence": this.#compile(action.actions, scope, guards); break;
        case "repeat":
          // Inspect even unreachable bodies; unsupported instructions are never silently accepted.
          if (action.count === 0) this.#checkSupported(action.actions);
          for (let i = 0; i < action.count; i++) this.#compile(action.actions, { parent: scope, bindings: new Map() }, guards);
          break;
        case "if":
        case "optional": {
          const branchId = this.#nextBranchId++;
          ensureMove(this.#instructions.length < 128, "action-runtime-step-limit");
          this.#instructions.push({ action, scope, guards, branchId });
          this.#compile(action.kind === "if" ? action.then : action.actions,
            { parent: scope, bindings: new Map() }, [...guards, { branchId, value: true }]);
          if (action.kind === "if") this.#compile(action.else,
            { parent: scope, bindings: new Map() }, [...guards, { branchId, value: false }]);
          break;
        }
        case "draw":
        case "move":
        case "select":
          if (action.kind === "move") ensureMove(action.cards.kind === "ref" && action.cards.from === "VARIABLE" && action.cause === "EFFECT_MOVE", "action-runtime-move-form-not-supported");
          ensureMove(this.#instructions.length < 128, "action-runtime-step-limit");
          this.#instructions.push({ action, scope, guards }); break;
        default: throw new Error(`action-runtime-unsupported:${action.kind}`);
      }
    }
  }
  #checkSupported(actions: DeepReadonly<EffectDefinition["actions"]>): void {
    const length = this.#instructions.length;
    this.#compile(actions, { parent: null, bindings: new Map() });
    this.#instructions.length = length;
  }
  snapshot(): MovementState { return this.#resolution.snapshot(); }
  view() {
    const view = this.#resolution.view();
    return Object.freeze({ ...view, masterVersion: this.#catalog.version, status: this.#pending ? "waitingForSelection" as const : view.status });
  }
  selectionViewFor(viewer: Seat): SelectionView | null { return this.#pending?.viewFor(viewer) ?? null; }
  #selectionSnapshot() {
    const snapshot = movementSelectionSnapshot(this.snapshot(), this.#actor, this.#sourceFacts, this.#catalog);
    const variables = new Map<string, Evaluation<FactValue>>();
    let scope: Scope | null = this.#instructions[this.#cursor]?.scope ?? null;
    while (scope) {
      for (const [name, value] of scope.bindings) if (!variables.has(name)) variables.set(name,
        value.kind === "choice" ? known(value.optionId) : unknown("card-set-is-not-scalar"));
      scope = scope.parent;
    }
    return { ...snapshot, facts: { ...snapshot.facts, variables } };
  }
  #finishInstruction(result: TransactionResult): TransactionResult {
    this.#cursor++;
    while (this.#cursor < this.#instructions.length && this.#instructions[this.#cursor]!.guards.some(guard => this.#branches.get(guard.branchId) !== guard.value)) this.#cursor++;
    if (this.#cursor === this.#instructions.length) this.#resolution.complete(this.#actor, result.state.revision);
    return result;
  }
  #commitSelection(result: SelectionResult, rules: MovementRules): TransactionResult {
    const instruction = this.#instructions[this.#cursor]!;
    ensureMove(instruction.action.kind === "select" || instruction.action.kind === "optional", "action-runtime-not-selection");
    if (instruction.action.kind === "optional") ensureMove(result.kind === "choice" && ["accept", "decline"].includes(result.optionId), "action-runtime-invalid-optional-answer");
    const committed = this.#resolution.step(this.#actor, this.snapshot().revision, [], rules);
    if (instruction.action.kind === "select") instruction.scope.bindings.set(instruction.action.saveAs, result);
    else if (result.kind === "choice") this.#branches.set(instruction.branchId!, result.optionId === "accept");
    this.#pending = null;
    return this.#finishInstruction(committed);
  }
  answerSelection(actor: Seat, reply: unknown, rules: MovementRules): TransactionResult {
    ensureMove(!this.#busy && this.#pending !== null, "action-runtime-not-answerable");
    this.#busy = true;
    let accepted = false;
    try {
      const result = this.#pending!.answer(actor, reply, this.#selectionSnapshot());
      accepted = true;
      return this.#commitSelection(result, rules);
    } catch (error) {
      // Invalid answers may be corrected. A valid answer whose commit fails may not be replayed.
      if (accepted) { this.#pending = null; if (this.#resolution.view().status === "resolving") this.#resolution.block(this.#actor, this.snapshot().revision); }
      throw error;
    } finally { this.#busy = false; }
  }
  toJSON(): never { throw new Error("server-only-action-runtime"); }
  start(expectedRevision: number, rules: MovementRules): TransactionResult {
    ensureMove(!this.#busy, "reentrant-action-runtime");
    ensureMove(this.#resolution.view().status === "prepared" && expectedRevision === this.snapshot().revision, "action-runtime-not-prepared-or-current");
    this.#busy = true;
    try {
      const operations = this.#costs.length === 0 ? [] : prepareDonPayment(this.snapshot(), this.#actor,
        this.#resolutionId, this.#costs, this.#sourceFacts, this.#catalog);
      const result = this.#resolution.pay(this.#actor, expectedRevision, operations, rules);
      if (this.#instructions.length === 0) this.#resolution.complete(this.#actor, result.state.revision);
      return result;
    } finally { this.#busy = false; }
  }
  advance(expectedRevision: number, rules: MovementRules): TransactionResult | SelectionPending {
    ensureMove(!this.#busy, "reentrant-action-runtime");
    ensureMove(this.view().status === "resolving" && expectedRevision === this.snapshot().revision, "action-runtime-not-current");
    this.#busy = true;
    try {
      const instruction = this.#instructions[this.#cursor]!;
      const { action, scope } = instruction;
      const state = this.snapshot();
      const seat = (who: "SELF" | "OPPONENT"): 0 | 1 => who === "SELF" ? this.#actor : this.#actor === 0 ? 1 : 0;
      if (action.kind === "if") {
        const evaluated = evaluateCondition(action.condition, this.#selectionSnapshot().facts, undefined, this.#conditionBudget);
        ensureMove(evaluated.state === "known", "action-runtime-condition-data-unavailable");
        const result = this.#resolution.step(this.#actor, expectedRevision, [], rules);
        this.#branches.set(instruction.branchId!, evaluated.value);
        return this.#finishInstruction(result);
      }
      if (action.kind === "select" || action.kind === "optional") {
        const selector = action.kind === "select" ? action.selector : { kind: "choice" as const, chooser: action.player,
          options: [{ id: "accept", label: "使う" }, { id: "decline", label: "使わない" }] };
        const snapshot = this.#selectionSnapshot();
        const chooser = seat(selector.chooser);
        const prepared = SelectionSession.prepare({ matchId: state.matchId, resolutionId: this.#resolutionId,
          actor: this.#actor, selector, snapshot,
          disclosure: { revealToChooser: snapshot.cards.filter(card => selector.kind === "cards" && selector.zones.includes(card.zone) &&
            (selector.owner === "ANY" || card.owner === seat(selector.owner)) &&
            (selector.controller === undefined || selector.controller === "ANY" || card.controller === seat(selector.controller)) &&
            visibleTo(state, state.cards[card.instanceId]!, location(state, card.instanceId), chooser))
            .map(card => ({ instanceId: card.instanceId, generation: card.generation })) } });
        ensureMove(prepared.state === "known", "action-runtime-selection-data-unavailable");
        const session = prepared.value;
        if (selector.kind === "cards" && ["ALL", "RANDOM"].includes(selector.mode)) {
          return this.#commitSelection(session.resolveAutomatic(snapshot), rules);
        }
        this.#pending = session;
        return Object.freeze({ kind: "selectionPending" as const });
      }
      let operations: MovementOperation[];
      if (action.kind === "draw") {
        const owner = seat(action.player), deck = state.players[owner].deck;
        // Empty-deck rule processing is not implemented: do not invent partial draws or a winner.
        ensureMove(deck.length >= action.amount && action.amount <= 64, "action-runtime-draw-unavailable");
        operations = deck.slice(0, action.amount).map(instanceId => ({ kind: "move", card: { instanceId: instanceId!, generation: state.cards[instanceId!]!.generation },
          from: { player: owner, zone: "deck" }, to: { player: owner, zone: "hand", position: "append", faceUp: true, rotated: false }, cause: "EFFECT_MOVE" }));
      } else {
        const expression = action.cards;
        ensureMove(expression.kind === "ref" && expression.from === "VARIABLE", "action-runtime-invalid-binding");
        const name = (expression as { name: string }).name;
        let current: Scope | null = scope, binding: SelectionResult | undefined;
        while (current && !binding) { binding = current.bindings.get(name); current = current.parent; }
        ensureMove(binding?.kind === "cards", "action-runtime-binding-unavailable");
        const refs = binding.cards;
        ensureMove(action.destination.position !== "top" || refs.length <= 1, "action-runtime-top-order-not-supported");
        operations = refs.map(reference => {
          const card = getCard(state, reference);
          return { kind: "move", card: reference, from: location(state, card.instanceId),
            to: { player: seat(action.destination.owner), zone: action.destination.zone, position: action.destination.position,
              faceUp: action.destination.visibility === "faceUp", rotated: false }, cause: action.cause };
        });
      }
      const result = this.#resolution.step(this.#actor, expectedRevision, operations, rules);
      if (action.saveAs) scope.bindings.set(action.saveAs, { kind: "cards", cards: result.events.filter(event => event.kind === "moved" && event.cause.parentEventId === null && event.after !== null)
        .map(event => ({ instanceId: event.after!.instanceId, generation: event.after!.generation })) });
      return this.#finishInstruction(result);
    } catch (error) {
      if (this.view().status === "resolving") this.#resolution.block(this.#actor, this.snapshot().revision);
      throw error;
    } finally { this.#busy = false; }
  }
}
