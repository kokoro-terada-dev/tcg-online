import { checkTiming, freezeState } from "../progression/state";
import { applySystemEvent } from "../progression/transitions";
import type { Progression } from "../progression/types";
import { ensureMove, freezeMovement, getCard, location } from "../movement/state";
import type { MovementRules, MovementState, Player, TransactionResult } from "../movement/types";
import type { ResolutionIdentity } from "../movement/resolution";
import { PreparedMovementEffect, type SelectionPending } from "./movementActions";
import type { MasterFactOptions } from "./masterFacts";
import { validateEffectDefinition } from "./validation";
import type { SelectionView } from "./selectionTypes";

export type EffectRevisions = Readonly<{ movement: number; progression: number }>;

// Own both independent snapshots; never attach this to a parallel mutable live Match.
// Timing permission is not certification of restrictions, usage limits, or card-specific legality.
export class TimedMovementEffect {
  #effect: PreparedMovementEffect;
  #progression: Progression;
  #identity: ResolutionIdentity;
  #busy = false;
  #intent: "mainEffect" | "counterEffect";
  constructor(board: MovementState, progression: Progression, identity: ResolutionIdentity, input: unknown, masterOptions?: MasterFactOptions) {
    const definition = validateEffectDefinition(input).definition;
    ensureMove(definition.trigger.kind === "activate" && definition.trigger.window !== "trigger", "timed-effect-trigger-not-supported");
    ensureMove(board.turnNumber === progression.turnNumber && progression.version === 1 && Number.isSafeInteger(progression.revision) && progression.revision >= 0, "timed-effect-context-mismatch");
    ensureMove(identity.source !== null, "timed-effect-source-required");
    const source = getCard(board, identity.source!), at = location(board, source.instanceId);
    ensureMove(source.controller === identity.actor && at.player === identity.actor && ["leader", "character", "stage"].includes(at.zone), "timed-effect-board-source-required");
    if (progression.battle) {
      const attack = getCard(board, progression.battle.source), target = getCard(board, progression.battle.target);
      ensureMove(attack.controller === progression.battle.attacker && target.controller === progression.battle.defender &&
        ["leader", "character"].includes(location(board, attack.instanceId).zone) &&
        ["leader", "character"].includes(location(board, target.instanceId).zone), "timed-effect-battle-context-mismatch");
    }
    this.#intent = definition.trigger.window === "main" ? "mainEffect" : "counterEffect";
    this.#identity = freezeMovement(structuredClone(identity));
    this.#progression = freezeState(structuredClone(progression));
    this.#effect = new PreparedMovementEffect(board, identity, definition, masterOptions,
      { turnNumber: progression.turnNumber, activePlayer: progression.activePlayer, phase: progression.phase });
  }
  snapshot(): Readonly<{ movement: MovementState; progression: Progression }> {
    return Object.freeze({ movement: this.#effect.snapshot(), progression: this.#progression });
  }
  view() { return Object.freeze({ ...this.#effect.view(), progressionRevision: this.#progression.revision,
    turnNumber: this.#progression.turnNumber, activePlayer: this.#progression.activePlayer, phase: this.#progression.phase }); }
  selectionViewFor(viewer: Player): SelectionView | null { return this.#effect.selectionViewFor(viewer); }
  toJSON(): never { throw new Error("server-only-timed-effect"); }
  #check(expected: EffectRevisions): void {
    ensureMove(!this.#busy, "reentrant-timed-effect");
    ensureMove(expected.movement === this.#effect.snapshot().revision && expected.progression === this.#progression.revision, "stale-timed-effect-revisions");
    ensureMove(this.#progression.revision <= Number.MAX_SAFE_INTEGER - 2, "timed-effect-revision-limit");
  }
  #sync(next: Progression): Progression {
    if (this.#effect.view().status === "waitingForSelection") {
      const choice = this.#effect.selectionViewFor(0) ?? this.#effect.selectionViewFor(1);
      ensureMove(choice !== null, "timed-effect-missing-selection");
      return applySystemEvent(next, next.revision, { kind: "waitForChoice", resolutionId: this.#identity.resolutionId,
        selectionId: choice.selectionId, chooser: choice.chooser });
    }
    if (this.#effect.view().status === "completed") return applySystemEvent(next, next.revision,
      { kind: "finishResolution", resolutionId: this.#identity.resolutionId });
    return next;
  }
  start(actor: Player, expected: EffectRevisions, rules: MovementRules): TransactionResult {
    this.#check(expected); ensureMove(actor === this.#identity.actor, "wrong-timed-effect-actor");
    // At most 128 selection instructions, each with wait/accept, plus begin/finish.
    ensureMove(this.#progression.revision <= Number.MAX_SAFE_INTEGER - 258, "timed-effect-revision-limit");
    const permission = checkTiming(this.#progression, actor, this.#intent);
    ensureMove(permission.allowed, "timed-effect-window-unavailable");
    // Reserve the gate on a detached progression before charging anything.
    const next = applySystemEvent(this.#progression, expected.progression,
      { kind: "beginResolution", resolutionId: this.#identity.resolutionId, controller: actor });
    this.#busy = true;
    try {
      const result = this.#effect.start(expected.movement, rules);
      this.#progression = this.#sync(next);
      return result;
    } finally { this.#busy = false; }
  }
  advance(actor: Player, expected: EffectRevisions, rules: MovementRules): TransactionResult | SelectionPending {
    this.#check(expected); ensureMove(actor === this.#identity.actor && this.#progression.gate.kind === "resolving", "timed-effect-not-resolving");
    this.#busy = true;
    try {
      const result = this.#effect.advance(expected.movement, rules);
      this.#progression = this.#sync(this.#progression);
      return result;
    } finally { this.#busy = false; }
  }
  answerSelection(actor: Player, expected: EffectRevisions, reply: unknown, rules: MovementRules): TransactionResult {
    this.#check(expected);
    const gate = this.#progression.gate;
    ensureMove(gate.kind === "choice", "timed-effect-not-waiting");
    const next = applySystemEvent(this.#progression, expected.progression,
      { kind: "acceptChoice", resolutionId: this.#identity.resolutionId, selectionId: gate.selectionId, chooser: actor });
    this.#busy = true;
    try {
      const result = this.#effect.answerSelection(actor, reply, rules);
      this.#progression = this.#sync(next);
      return result;
    } catch (error) {
      // A valid consumed answer can fail its movement commit: retain the locked resolution, not a dead choice.
      if (this.#effect.view().status === "blocked") this.#progression = next;
      throw error;
    } finally { this.#busy = false; }
  }
}
