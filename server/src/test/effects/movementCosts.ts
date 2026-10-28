import type { Cost, CostMap, DeepReadonly } from "./types";
import type { CostChoice, CostSnapshot, ResourceCostPlan } from "./costTypes";
import { COST_LIMITS, CostPlanSession, planCosts } from "./costPlan";
import { movementSelectionSnapshot } from "./movementSelection";
import type { FactRecord } from "./facts";
import type { PinnedMasterFacts } from "./masterFacts";
import { ensureMove, MOVEMENT_LIMITS, freezeMovement, location, validateMovementState, player, id } from "../movement/state";
import type { MovementOperation, MovementState, Player } from "../movement/types";
import { createCostRuntimeRegistry, validateRequirement } from "./costs";
import { SelectionSession } from "./selectionSession";
import { prepareSelector } from "./selectors";
import type { SelectionView } from "./selectionTypes";
import { isDeepStrictEqual } from "node:util";

export function movementCostSnapshot(state: MovementState, actor: Player, source: FactRecord, catalog: PinnedMasterFacts): CostSnapshot {
  const selection = movementSelectionSnapshot(state, actor, source, catalog);
  return { ...selection, cards: selection.cards.map(card => ({ ...card,
    kind: state.cards[card.instanceId]!.kind, rotated: state.cards[card.instanceId]!.rotated })) };
}
export function validateMovementPayments(costs: readonly DeepReadonly<Cost>[], snapshot: CostSnapshot, actor: Player): void {
  ensureMove(costs.length <= COST_LIMITS.costs, "action-runtime-cost-count-limit");
  const registry = createCostRuntimeRegistry();
  let maximum = 0;
  for (const cost of costs) {
    ensureMove(["payDon", "restCards", "moveCards"].includes(cost.kind), "action-runtime-cost-kind-not-supported");
    if (cost.kind === "moveCards") ensureMove(cost.destination.position !== "top" || cost.selector.max <= 1, "unsupported-cost-multiple-top-order");
    const requirement = registry.get(cost.kind)!(cost, { actor, snapshot });
    validateRequirement(requirement, { actor, snapshot });
    maximum += requirement.selector.max;
  }
  ensureMove(maximum <= MOVEMENT_LIMITS.operations, "action-runtime-cost-operation-limit");
}
export function costMovementOperations(plan: ResourceCostPlan, state: MovementState): readonly MovementOperation[] {
  return plan.operations.map(operation => {
    if (operation.kind === "rest") return { kind: "setRest", card: operation.card, rotated: true };
    ensureMove(operation.kind === "move", "action-runtime-cost-kind-not-supported");
    return { kind: "move", card: operation.card, from: location(state, operation.card.instanceId),
      to: { player: plan.actor, zone: operation.destination.zone, position: operation.destination.position,
        faceUp: operation.destination.visibility === "faceUp", rotated: false }, cause: "COST_PAYMENT" };
  });
}

// Private, read-only pre-payment planning. It does not own a progression gate or change the board.
export class CompositeCostSession {
  #state: MovementState;
  #actor: Player;
  #resolutionId: string;
  #costs: readonly DeepReadonly<Cost>[];
  #source: FactRecord;
  #catalog: PinnedMasterFacts;
  #choices: CostChoice[] = [];
  #pending: { index: number; session: SelectionSession } | null = null;
  #plan: CostPlanSession | null = null;
  #status: "selecting" | "ready" | "cancelled" | "consumed" = "selecting";
  #busy = false;
  constructor(state: MovementState, actor: Player, resolutionId: string, costs: readonly DeepReadonly<Cost>[], source: FactRecord, catalog: PinnedMasterFacts) {
    validateMovementState(state); player(actor); id(resolutionId);
    this.#state = freezeMovement(structuredClone(state)); this.#actor = actor; this.#resolutionId = resolutionId;
    this.#costs = freezeMovement(structuredClone(costs)); this.#source = freezeMovement(structuredClone(source)); this.#catalog = freezeMovement(structuredClone(catalog));
    validateMovementPayments(this.#costs, this.#snapshot(), actor);
    this.#prepare();
  }
  #snapshot(state = this.#state): CostSnapshot { return movementCostSnapshot(state, this.#actor, this.#source, this.#catalog); }
  #input(choices = this.#choices) { return { resolutionId: this.#resolutionId, actor: this.#actor, semantics: "independent" as const,
    costs: this.#costs, snapshot: this.#snapshot(), choices }; }
  #prepare(): void {
    for (let work = 0; work <= COST_LIMITS.costs; work++) {
      const result = planCosts(this.#input());
      ensureMove(result.state === "planned" || result.state === "selectionRequired", "composite-cost-not-payable");
      if (result.state === "planned") {
        const plan = CostPlanSession.prepare(this.#input());
        ensureMove(plan instanceof CostPlanSession, "composite-cost-not-planned");
        this.#plan = plan; this.#pending = null; this.#status = "ready"; return;
      }
      // Choose non-DON costs first so automatic DON allocation does not steal their resources.
      const request = result.requests.find(item => this.#costs[item.costIndex]!.kind !== "payDon") ?? result.requests[0]!;
      if (this.#costs[request.costIndex]!.kind === "payDon") {
        const selected = prepareSelector(request.selector, this.#actor, this.#snapshot());
        ensureMove(selected.state === "known" && selected.value.kind === "cards", "composite-cost-data-unavailable");
        this.#choices.push({ costIndex: request.costIndex, cards: selected.value.candidates.slice(0, request.selector.min) });
        continue;
      }
      const session = SelectionSession.prepare({ matchId: this.#state.matchId, resolutionId: this.#resolutionId,
        actor: this.#actor, selector: request.selector, snapshot: this.#snapshot() });
      ensureMove(session.state === "known", "composite-cost-data-unavailable");
      this.#pending = { index: request.costIndex, session: session.value }; return;
    }
    throw new Error("composite-cost-planning-limit");
  }
  view(): Readonly<{ status: "selecting" | "ready" | "cancelled" | "consumed" }> { return Object.freeze({ status: this.#status }); }
  viewFor(viewer: Player): SelectionView | null { return this.#status === "selecting" ? this.#pending?.session.viewFor(viewer) ?? null : null; }
  toJSON(): never { throw new Error("server-only-composite-cost-session"); }
  answer(actor: Player, reply: unknown): boolean {
    ensureMove(!this.#busy && this.#status === "selecting" && this.#pending !== null, "composite-cost-not-answerable");
    this.#busy = true;
    try {
      const pending = this.#pending!, result = pending.session.answer(actor, reply, this.#snapshot());
      ensureMove(result.kind === "cards", "composite-cost-needs-cards");
      const proposed = [...this.#choices, { costIndex: pending.index, cards: result.cards }];
      const combined = planCosts(this.#input(proposed));
      this.#pending = null;
      if (combined.state !== "planned" && combined.state !== "selectionRequired") {
        this.#prepare(); // Reissue opaque tokens; no resource choice or payment was committed.
        return false;
      }
      this.#choices = proposed; this.#prepare(); return true;
    } finally { this.#busy = false; }
  }
  validateForCommit(state: MovementState, actor: Player, resolutionId: string, costs: readonly DeepReadonly<Cost>[]): ResourceCostPlan {
    ensureMove(!this.#busy && this.#status === "ready" && this.#plan !== null && actor === this.#actor && resolutionId === this.#resolutionId &&
      isDeepStrictEqual(costs, this.#costs), "composite-cost-wrong-or-unready-plan");
    validateMovementState(state);
    ensureMove(isDeepStrictEqual(state, this.#state), "composite-cost-source-snapshot-changed");
    return this.#plan!.validateForCommit(this.#snapshot(state));
  }
  commit<T>(state: MovementState, actor: Player, resolutionId: string, costs: readonly DeepReadonly<Cost>[], apply: (plan: ResourceCostPlan) => T): T {
    const plan = this.validateForCommit(state, actor, resolutionId, costs);
    this.#busy = true;
    try { const result = apply(plan); this.#status = "consumed"; return result; }
    finally { this.#busy = false; }
  }
  cancel(actor: Player): void {
    ensureMove(!this.#busy && actor === this.#actor && ["selecting", "ready"].includes(this.#status), "composite-cost-cannot-cancel");
    this.#pending?.session.cancel(); this.#pending = null; this.#plan = null; this.#status = "cancelled";
  }
}

export type DonPayment = DeepReadonly<CostMap["payDon"]>;
export function validateDonPayments(costs: readonly DonPayment[]): void {
  ensureMove(costs.length <= COST_LIMITS.costs, "action-runtime-cost-count-limit");
  ensureMove(costs.reduce((sum, cost) => sum + cost.amount, 0) <= MOVEMENT_LIMITS.operations, "action-runtime-cost-operation-limit");
}

// All payDon groups are independent rests, with no intervening moves or reused resources.
export function prepareDonPayment(state: MovementState, actor: Player, resolutionId: string,
  costs: readonly DonPayment[], sourceFacts: FactRecord, catalog: PinnedMasterFacts): readonly MovementOperation[] {
  validateDonPayments(costs);
  const snapshot = (): CostSnapshot => {
    const selection = movementSelectionSnapshot(state, actor, sourceFacts, catalog);
    return { ...selection, cards: selection.cards.map(card => ({ ...card,
      kind: state.cards[card.instanceId]!.kind, rotated: state.cards[card.instanceId]!.rotated })) };
  };
  const available = state.players[actor].activeDon.filter(id => {
    const card = state.cards[id!]!;
    return card.owner === actor && card.controller === actor && card.kind === "don" && !card.rotated;
  });
  const total = costs.reduce((sum, cost) => sum + cost.amount, 0);
  ensureMove(available.length >= total, "action-runtime-don-cost-unavailable");
  let cursor = 0;
  const choices = costs.map((cost, costIndex) => {
    const cards = available.slice(cursor, cursor + cost.amount).map(id => ({ instanceId: id!, generation: state.cards[id!]!.generation }));
    cursor += cost.amount;
    return { costIndex, cards };
  });
  const prepared = CostPlanSession.prepare({ resolutionId, actor, semantics: "independent", costs,
    snapshot: snapshot(), choices });
  ensureMove(prepared instanceof CostPlanSession, "action-runtime-don-cost-not-planned");
  const plan = prepared.validateForCommit(snapshot());
  return plan.operations.map(operation => {
    ensureMove(operation.kind === "rest", "action-runtime-invalid-don-cost-operation");
    return { kind: "setRest", card: operation.card, rotated: true };
  });
}
