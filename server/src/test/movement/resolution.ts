import type { CardObjectRef } from "../effects/types";
import { MovementStore } from "./engine";
import { ensureMove, freezeMovement, id, player, reference } from "./state";
import type { MovementOperation, MovementRules, MovementState, Player, TransactionResult } from "./types";

export type ResolutionStatus = "prepared" | "resolving" | "completed" | "cancelled" | "blocked";
export type ResolutionIdentity = Readonly<{ resolutionId: string; actor: Player; source: Readonly<CardObjectRef> | null }>;
export type ResolutionView = Readonly<{ resolutionId: string; actor: Player; status: ResolutionStatus; revision: number; completedSteps: number }>;

// Own the store so unrelated mutations cannot slip between payment and resolution.
// Plans and rule evaluators are trusted server inputs, never socket payloads.
export class MovementResolution {
  #store: MovementStore;
  #identity: ResolutionIdentity;
  #status: ResolutionStatus = "prepared";
  #steps = 0;
  #busy = false;
  constructor(state: MovementState, identity: ResolutionIdentity) {
    id(identity.resolutionId, 64); player(identity.actor);
    if (identity.source !== null) reference(identity.source);
    this.#identity = freezeMovement(structuredClone(identity));
    this.#store = new MovementStore(state);
  }
  snapshot(): MovementState { return this.#store.snapshot(); }
  view(): ResolutionView {
    return freezeMovement({ resolutionId: this.#identity.resolutionId, actor: this.#identity.actor,
      status: this.#status, revision: this.snapshot().revision, completedSteps: this.#steps });
  }
  toJSON(): never { throw new Error("server-only-resolution"); }
  #authorize(actor: Player, expectedRevision: number): void {
    ensureMove(!this.#busy, "reentrant-resolution");
    ensureMove(actor === this.#identity.actor, "wrong-resolution-actor");
    ensureMove(expectedRevision === this.snapshot().revision, "stale-resolution-request");
  }
  #commit(mode: "cost" | "effect", operations: readonly MovementOperation[], rules: MovementRules): TransactionResult {
    const state = this.snapshot();
    return this.#store.commit({ transactionId: `${this.#identity.resolutionId}:${state.revision}`,
      matchId: state.matchId, expectedRevision: state.revision, turnNumber: state.turnNumber,
      actor: this.#identity.actor, effectController: this.#identity.actor, source: this.#identity.source,
      mode, resolutionId: this.#identity.resolutionId, operations }, rules);
  }
  pay(actor: Player, expectedRevision: number, operations: readonly MovementOperation[], rules: MovementRules): TransactionResult {
    this.#authorize(actor, expectedRevision);
    ensureMove(this.#status === "prepared", "resolution-not-prepared");
    this.#busy = true;
    try {
      const result = this.#commit("cost", operations, rules);
      this.#status = "resolving";
      return result;
    } finally { this.#busy = false; }
  }
  step(actor: Player, expectedRevision: number, operations: readonly MovementOperation[], rules: MovementRules): TransactionResult {
    this.#authorize(actor, expectedRevision);
    ensureMove(this.#status === "resolving", "resolution-not-resolving");
    ensureMove(this.#steps < 128, "resolution-step-limit");
    this.#busy = true;
    try {
      const result = this.#commit("effect", operations, rules);
      this.#steps++;
      return result;
    } catch (error) {
      // Earlier committed payment/effects remain intact; no automatic retry or refund.
      this.#status = "blocked";
      throw error;
    } finally { this.#busy = false; }
  }
  cancel(actor: Player, expectedRevision: number): void {
    this.#authorize(actor, expectedRevision);
    ensureMove(this.#status === "prepared", "cannot-cancel-paid-resolution");
    this.#status = "cancelled";
  }
  block(actor: Player, expectedRevision: number): void {
    this.#authorize(actor, expectedRevision);
    ensureMove(this.#status === "resolving", "resolution-not-resolving");
    this.#status = "blocked";
  }
  complete(actor: Player, expectedRevision: number): void {
    this.#authorize(actor, expectedRevision);
    ensureMove(this.#status === "resolving", "resolution-not-resolving");
    ensureMove(!this.snapshot().reveals.some(grant => grant.scopeId === this.#identity.resolutionId), "resolution-reveals-still-open");
    this.#status = "completed";
  }
}
