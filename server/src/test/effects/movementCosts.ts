import type { CostMap, DeepReadonly } from "./types";
import type { CostSnapshot } from "./costTypes";
import { COST_LIMITS, CostPlanSession } from "./costPlan";
import { movementSelectionSnapshot } from "./movementSelection";
import type { FactRecord } from "./facts";
import type { PinnedMasterFacts } from "./masterFacts";
import { ensureMove, MOVEMENT_LIMITS } from "../movement/state";
import type { MovementOperation, MovementState, Player } from "../movement/types";

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
