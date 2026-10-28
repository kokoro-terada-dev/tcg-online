import type { TimedMovementEffect } from "./timedMovement";
import { parseEffectCommand, type EffectCommand } from "./effectCommands";
import { freezeMovement, player } from "../movement/state";
import { projectMovementState } from "../movement/projection";
import type { MovementRules, MovementView, Player } from "../movement/types";
import type { SelectionView } from "./selectionTypes";

export const EFFECT_RECEIPT_LIMIT = 1024;
export type EffectTransportView = Readonly<{
  matchId: string; localPlayerIndex: Player; movement: MovementView;
  effect: Readonly<{ resolutionId: string; actor: Player; status: ReturnType<TimedMovementEffect["view"]>["status"];
    completedSteps: number; masterVersion: string | null }>;
  progression: Readonly<{ revision: number; turnNumber: number; activePlayer: Player; phase: string;
    gate: "idle" | "resolving" | "choice"; chooser: Player | null; finished: boolean; winner: Player | null }>;
  selection: SelectionView | null;
}>;
type Code = "applied" | "selection_retry" | "operation_rejected" | "invalid_command" | "wrong_context" | "request_conflict" | "request_limit" | "busy";
export type EffectCommandResponse = Readonly<{ ok: boolean; code: Code; requestId?: string; replayed: boolean; view: EffectTransportView }>;
type Receipt = Readonly<{ fingerprint: string; ok: boolean; code: Code }>;

// Exclusively owns the supplied runtime. The future socket layer supplies the authenticated seat separately.
export class EffectCommandHost {
  #effect: TimedMovementEffect;
  #rules: MovementRules;
  #receipts: [Map<string, Receipt>, Map<string, Receipt>] = [new Map(), new Map()];
  #busy = false;
  constructor(effect: TimedMovementEffect, rules: MovementRules) {
    this.#effect = effect;
    this.#rules = rules.status === "evaluate" ? Object.freeze({ status: "evaluate", check: rules.check.bind(rules) }) : Object.freeze({ status: rules.status });
  }
  toJSON(): never { throw new Error("server-only-effect-command-host"); }
  viewFor(viewer: Player): EffectTransportView {
    player(viewer);
    const state = this.#effect.snapshot(), effect = this.#effect.view(), progression = state.progression;
    return freezeMovement({ matchId: state.movement.matchId, localPlayerIndex: viewer, movement: projectMovementState(state.movement, viewer),
      effect: { resolutionId: effect.resolutionId, actor: effect.actor, status: effect.status,
        completedSteps: effect.completedSteps, masterVersion: effect.masterVersion },
      progression: { revision: progression.revision, turnNumber: progression.turnNumber, activePlayer: progression.activePlayer,
        phase: progression.phase, gate: progression.gate.kind, chooser: progression.gate.kind === "choice" ? progression.gate.chooser : null,
        finished: progression.outcome !== null, winner: progression.outcome?.winner ?? null },
      selection: this.#effect.selectionViewFor(viewer) });
  }
  #response(actor: Player, ok: boolean, code: Code, requestId?: string, replayed = false): EffectCommandResponse {
    return freezeMovement({ ok, code, ...(requestId === undefined ? {} : { requestId }), replayed, view: this.viewFor(actor) });
  }
  handle(actor: Player, input: unknown): EffectCommandResponse {
    player(actor);
    if (this.#busy) return this.#response(actor, false, "busy");
    let command: EffectCommand;
    try { command = parseEffectCommand(input); }
    catch { return this.#response(actor, false, "invalid_command"); }
    const state = this.#effect.snapshot(), effect = this.#effect.view();
    if (command.matchId !== state.movement.matchId || command.resolutionId !== effect.resolutionId) return this.#response(actor, false, "wrong_context", command.requestId);
    const fingerprint = JSON.stringify(command), receipt = this.#receipts[actor].get(command.requestId);
    if (receipt) return receipt.fingerprint === fingerprint
      ? this.#response(actor, receipt.ok, receipt.code, command.requestId, true)
      : this.#response(actor, false, "request_conflict", command.requestId);
    if (this.#receipts[actor].size >= EFFECT_RECEIPT_LIMIT) return this.#response(actor, false, "request_limit", command.requestId);
    this.#busy = true;
    let ok = true, code: Code = "applied";
    try {
      const revisions = { movement: command.expectedMovementRevision, progression: command.expectedProgressionRevision };
      switch (command.kind) {
        case "beginCosts": this.#effect.beginCostSelection(actor, revisions); break;
        case "commitCosts": this.#effect.commitCostSelection(actor, revisions, this.#rules); break;
        case "cancelCosts": this.#effect.cancelCostSelection(actor, revisions); break;
        case "start": this.#effect.start(actor, revisions, this.#rules); break;
        case "advance": this.#effect.advance(actor, revisions, this.#rules); break;
        case "answerCosts":
        case "answerEffect": {
          const reply = { matchId: command.matchId, resolutionId: command.resolutionId, selectionId: command.selectionId,
            revision: command.expectedMovementRevision, tokens: command.tokens };
          if (command.kind === "answerCosts") {
            if (!this.#effect.answerCostSelection(actor, revisions, reply)) { ok = false; code = "selection_retry"; }
          } else this.#effect.answerSelection(actor, revisions, reply, this.#rules);
          break;
        }
      }
    } catch {
      // Internal diagnostics may include private references. Never return error text or assume rollback.
      ok = false; code = "operation_rejected";
    } finally { this.#busy = false; }
    this.#receipts[actor].set(command.requestId, Object.freeze({ fingerprint, ok, code }));
    return this.#response(actor, ok, code, command.requestId);
  }
}
