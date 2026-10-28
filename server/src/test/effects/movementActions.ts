import type { Action, CardObjectRef, DeepReadonly, EffectDefinition } from "./types";
import { validateEffectDefinition } from "./validation";
import { MovementResolution, type ResolutionIdentity } from "../movement/resolution";
import { ensureMove, getCard, location } from "../movement/state";
import type { MovementOperation, MovementRules, MovementState, TransactionResult } from "../movement/types";

type Leaf = DeepReadonly<Extract<Action, { kind: "draw" | "move" }>>;
type Scope = { parent: Scope | null; bindings: Map<string, readonly CardObjectRef[]> };
type Instruction = { action: Leaf; scope: Scope };

// Server-only adapter: activation legality must be established by the future match coordinator.
export class PreparedMovementEffect {
  #resolution: MovementResolution;
  #instructions: Instruction[] = [];
  #cursor = 0;
  #actor: 0 | 1;
  #busy = false;
  constructor(state: MovementState, identity: ResolutionIdentity, input: unknown) {
    const definition = validateEffectDefinition(input).definition;
    ensureMove(definition.costs.length === 0 && definition.condition === undefined, "action-runtime-cost-or-condition-not-supported");
    ensureMove(identity.source !== null, "action-runtime-source-required");
    const source = getCard(state, identity.source!);
    ensureMove(source.cardId === definition.cardId && source.controller === identity.actor, "action-runtime-source-mismatch");
    this.#actor = identity.actor;
    this.#compile(definition.actions, { parent: null, bindings: new Map() });
    this.#resolution = new MovementResolution(state, identity);
  }
  #compile(actions: DeepReadonly<EffectDefinition["actions"]>, scope: Scope): void {
    for (const action of actions) {
      switch (action.kind) {
        case "sequence": this.#compile(action.actions, scope); break;
        case "repeat":
          // Inspect even unreachable bodies; unsupported instructions are never silently accepted.
          if (action.count === 0) this.#checkSupported(action.actions);
          for (let i = 0; i < action.count; i++) this.#compile(action.actions, { parent: scope, bindings: new Map() });
          break;
        case "draw":
        case "move":
          if (action.kind === "move") ensureMove(action.cards.kind === "ref" && action.cards.from === "VARIABLE" && action.cause === "EFFECT_MOVE", "action-runtime-move-form-not-supported");
          ensureMove(this.#instructions.length < 128, "action-runtime-step-limit");
          this.#instructions.push({ action, scope }); break;
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
  view() { return this.#resolution.view(); }
  toJSON(): never { throw new Error("server-only-action-runtime"); }
  start(expectedRevision: number, rules: MovementRules): TransactionResult {
    ensureMove(!this.#busy, "reentrant-action-runtime"); this.#busy = true;
    try {
      const result = this.#resolution.pay(this.#actor, expectedRevision, [], rules);
      if (this.#instructions.length === 0) this.#resolution.complete(this.#actor, result.state.revision);
      return result;
    } finally { this.#busy = false; }
  }
  advance(expectedRevision: number, rules: MovementRules): TransactionResult {
    ensureMove(!this.#busy, "reentrant-action-runtime");
    ensureMove(this.view().status === "resolving" && expectedRevision === this.snapshot().revision, "action-runtime-not-current");
    this.#busy = true;
    try {
      const { action, scope } = this.#instructions[this.#cursor]!;
      const state = this.snapshot();
      const seat = (who: "SELF" | "OPPONENT"): 0 | 1 => who === "SELF" ? this.#actor : this.#actor === 0 ? 1 : 0;
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
        let current: Scope | null = scope, refs: readonly CardObjectRef[] | undefined;
        while (current && !refs) { refs = current.bindings.get(name); current = current.parent; }
        ensureMove(refs !== undefined, "action-runtime-binding-unavailable");
        ensureMove(action.destination.position !== "top" || refs!.length <= 1, "action-runtime-top-order-not-supported");
        operations = refs!.map(reference => {
          const card = getCard(state, reference);
          return { kind: "move", card: reference, from: location(state, card.instanceId),
            to: { player: seat(action.destination.owner), zone: action.destination.zone, position: action.destination.position,
              faceUp: action.destination.visibility === "faceUp", rotated: false }, cause: action.cause };
        });
      }
      const result = this.#resolution.step(this.#actor, expectedRevision, operations, rules);
      if (action.saveAs) scope.bindings.set(action.saveAs, result.events.filter(event => event.kind === "moved" && event.cause.parentEventId === null && event.after !== null)
        .map(event => ({ instanceId: event.after!.instanceId, generation: event.after!.generation })));
      this.#cursor++;
      if (this.#cursor === this.#instructions.length) this.#resolution.complete(this.#actor, result.state.revision);
      return result;
    } catch (error) {
      if (this.view().status === "resolving") this.#resolution.block(this.#actor, this.snapshot().revision);
      throw error;
    } finally { this.#busy = false; }
  }
}
