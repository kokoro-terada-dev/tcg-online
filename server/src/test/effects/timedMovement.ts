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
import type { CompositeCostSession } from "./movementCosts";

export type EffectRevisions = Readonly<{ movement: number; progression: number }>;

// Own both independent snapshots; never attach this to a parallel mutable live Match.
// Timing permission is not certification of restrictions, usage limits, or card-specific legality.
export class TimedMovementEffect {
  #effect: PreparedMovementEffect;
  #progression: Progression;
  #identity: ResolutionIdentity;
  #busy = false;
  #intent: "mainEffect" | "counterEffect";
  #costPlanning: CompositeCostSession | null = null;
  #costAnswers = 0;
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
  view() { return Object.freeze({ ...this.#effect.view(), status: this.#costPlanning
    ? this.#costPlanning.view().status === "selecting" ? "waitingForCostSelection" as const : "costsReady" as const
    : this.#effect.view().status, progressionRevision: this.#progression.revision,
    turnNumber: this.#progression.turnNumber, activePlayer: this.#progression.activePlayer, phase: this.#progression.phase }); }
  selectionViewFor(viewer: Player): SelectionView | null { return this.#costPlanning ? this.#costPlanning.viewFor(viewer) : this.#effect.selectionViewFor(viewer); }
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
  #costGate(next: Progression, session: CompositeCostSession): Progression {
    if (session.view().status !== "selecting") return next;
    const choice = session.viewFor(this.#identity.actor);
    ensureMove(choice !== null, "timed-effect-missing-cost-selection");
    return applySystemEvent(next, next.revision, { kind: "waitForChoice", resolutionId: this.#identity.resolutionId,
      selectionId: choice.selectionId, chooser: choice.chooser });
  }
  beginCostSelection(actor: Player, expected: EffectRevisions): void {
    this.#check(expected);
    ensureMove(actor === this.#identity.actor && this.#costPlanning === null, "timed-effect-cannot-plan-costs");
    ensureMove(this.#progression.revision <= Number.MAX_SAFE_INTEGER - 390, "timed-effect-revision-limit");
    ensureMove(checkTiming(this.#progression, actor, this.#intent).allowed, "timed-effect-window-unavailable");
    const next = applySystemEvent(this.#progression, expected.progression,
      { kind: "beginResolution", resolutionId: this.#identity.resolutionId, controller: actor });
    this.#busy = true;
    try {
      const session = this.#effect.createCostSession(expected.movement);
      const locked = this.#costGate(next, session);
      this.#costPlanning = session; this.#costAnswers = 0; this.#progression = locked;
    } finally { this.#busy = false; }
  }
  answerCostSelection(actor: Player, expected: EffectRevisions, reply: unknown): boolean {
    this.#check(expected);
    ensureMove(actor === this.#identity.actor && this.#costPlanning?.view().status === "selecting" && this.#progression.gate.kind === "choice", "timed-effect-not-selecting-costs");
    ensureMove(this.#costAnswers < 64, "timed-effect-cost-answer-limit");
    const gate = this.#progression.gate;
    const next = applySystemEvent(this.#progression, expected.progression,
      { kind: "acceptChoice", resolutionId: this.#identity.resolutionId, selectionId: gate.selectionId, chooser: actor });
    this.#busy = true;
    try {
      const accepted = this.#costPlanning.answer(actor, reply);
      this.#costAnswers++;
      this.#progression = this.#costGate(next, this.#costPlanning);
      return accepted;
    } finally { this.#busy = false; }
  }
  commitCostSelection(actor: Player, expected: EffectRevisions, rules: MovementRules): TransactionResult {
    this.#check(expected);
    ensureMove(actor === this.#identity.actor && this.#costPlanning?.view().status === "ready" && this.#progression.gate.kind === "resolving", "timed-effect-costs-not-ready");
    this.#busy = true;
    try {
      const result = this.#effect.start(expected.movement, rules, this.#costPlanning);
      this.#costPlanning = null;
      this.#progression = this.#sync(this.#progression);
      return result;
    } catch (error) {
      if (this.#effect.view().status !== "prepared") this.#costPlanning = null;
      throw error;
    } finally { this.#busy = false; }
  }
  cancelCostSelection(actor: Player, expected: EffectRevisions): void {
    this.#check(expected);
    ensureMove(actor === this.#identity.actor && this.#costPlanning !== null && this.#effect.view().status === "prepared", "timed-effect-cannot-cancel-costs");
    let next = this.#progression;
    if (next.gate.kind === "choice") next = applySystemEvent(next, next.revision,
      { kind: "acceptChoice", resolutionId: this.#identity.resolutionId, selectionId: next.gate.selectionId, chooser: actor });
    next = applySystemEvent(next, next.revision, { kind: "finishResolution", resolutionId: this.#identity.resolutionId });
    this.#busy = true;
    try {
      this.#costPlanning.cancel(actor); this.#costPlanning = null; this.#progression = next;
    } finally { this.#busy = false; }
  }
  createCostSession(actor: Player, expected: EffectRevisions): CompositeCostSession {
    this.#check(expected); ensureMove(actor === this.#identity.actor, "wrong-timed-effect-actor");
    ensureMove(checkTiming(this.#progression, actor, this.#intent).allowed, "timed-effect-window-unavailable");
    this.#busy = true;
    try { return this.#effect.createCostSession(expected.movement); }
    finally { this.#busy = false; }
  }
  start(actor: Player, expected: EffectRevisions, rules: MovementRules, payment?: CompositeCostSession): TransactionResult {
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
      const result = this.#effect.start(expected.movement, rules, payment);
      this.#progression = this.#sync(next);
      return result;
    } catch (error) {
      if (this.#effect.view().status === "blocked") this.#progression = next;
      throw error;
    } finally { this.#busy = false; }
  }
  advance(actor: Player, expected: EffectRevisions, rules: MovementRules): TransactionResult | SelectionPending {
    this.#check(expected); ensureMove(actor === this.#identity.actor && this.#costPlanning === null && this.#progression.gate.kind === "resolving", "timed-effect-not-resolving");
    this.#busy = true;
    try {
      const result = this.#effect.advance(expected.movement, rules);
      this.#progression = this.#sync(this.#progression);
      return result;
    } finally { this.#busy = false; }
  }
  answerSelection(actor: Player, expected: EffectRevisions, reply: unknown, rules: MovementRules): TransactionResult {
    this.#check(expected);
    ensureMove(this.#costPlanning === null, "timed-effect-use-cost-answer");
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
