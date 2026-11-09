import { visibleTo } from "../../movement/engine";
import type { Location, MovementCard, MovementState, Player } from "../../movement/types";
import { pinMasterFacts, type PinnedMasterFacts } from "../masterFacts";
import type { ApprovedV3Card } from "./approval";
import type { Node } from "./dsl";
import { fixtureEnvironment } from "./fixtureEnvironment";

export type ContinuousAdjustments = {
  power: number | "unknown"; cost: number | "unknown";
  keywords: Partial<Record<Node<"keyword">["type"], true | "unknown">>;
};

// Read from the committed board, never from a mutable grant ledger. Stable predicates use the
// same evaluator as actions, with continuous adjustments disabled for their fact reads.
export function continuousAdjustments(board: MovementState, target: MovementCard, at: Location, activePlayer: Player,
  definitions: ReadonlyMap<string, ApprovedV3Card>, master?: PinnedMasterFacts): ContinuousAdjustments {
  const result: ContinuousAdjustments = { power: 0, cost: 0, keywords: {} };
  if (target.kind !== at.zone || !["leader", "character", "stage"].includes(at.zone) ||
    !target.faceUp || !visibleTo(board, target, at, 0) || !visibleTo(board, target, at, 1)) return result;
  const all = [...definitions.values()], targetRef = { instanceId: target.instanceId, generation: target.generation };
  let facts = master;
  for (const actor of [0, 1] as const) for (const zone of ["leader", "character", "stage"] as const) for (const id of board.players[actor][zone]) {
    if (id === null) continue;
    const source = board.cards[id], definition = source && definitions.get(source.cardId), effects = definition?.definition.continuousEffects;
    if (!definition || !effects?.length || !source || source.kind !== zone || definition.definition.cardType !== zone || source.owner !== actor ||
      source.controller !== actor || !source.faceUp || !visibleTo(board, source, { player: actor, zone }, 0) ||
      !visibleTo(board, source, { player: actor, zone }, 1)) continue;
    const seat = (side: "SELF" | "OPPONENT") => side === "SELF" ? actor : 1 - actor;
    for (const [index, effect] of effects.entries()) {
      const q = effect.affectedQuery;
      if (q.zone !== at.zone || !q.cardTypes.some(kind => kind === target.kind) || seat(q.owner) !== at.player ||
        seat(q.owner) !== target.owner || seat(q.controller) !== target.controller || q.excludeSource && id === target.instanceId) continue;
      facts ??= pinMasterFacts(board, { master: null, numericPolicy: "certifiedUnmodified" });
      const environment = fixtureEnvironment(() => board, { matchId: board.matchId, resolutionId: "continuous-read", effectId: effect.id ?? `continuous-${index}`,
        actor, source: { instanceId: id, generation: source.generation } }, definition, facts, () => 0, all, () => [], activePlayer,
        undefined, undefined, undefined, false, false);
      const condition = environment.evaluate(effect.condition, {});
      if (condition === false) continue;
      const matches = environment.evaluate(q.filters, {}, targetRef);
      if (matches === false) continue;
      const known = condition === true && matches === true && !source.modifierIds.length && !source.grantIds.length;
      const op = effect.operation;
      if (op.type === "ADD_STAT") {
        const previous = result[op.stat];
        result[op.stat] = known && previous !== "unknown" ? previous + op.amount : "unknown";
      } else if (result.keywords[op.keyword.type] !== true) result.keywords[op.keyword.type] = known ? true : "unknown";
    }
  }
  return result;
}
