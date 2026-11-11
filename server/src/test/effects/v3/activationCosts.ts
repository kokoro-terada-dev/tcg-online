import type { DeepReadonly } from "../types";
import type { Node } from "./dsl";
import type { ResolutionEnvironment, ResolutionCandidate } from "./resolution";
import { visibleTo } from "../../movement/engine";
import { ensureMove, getCard, location } from "../../movement/state";
import type { MovementOperation, MovementState, Player } from "../../movement/types";
import type { CardObjectRef } from "../types";

type Costs = readonly DeepReadonly<Node<"cost">>[];

export function topLifeCostOperation(board: MovementState, actor: Player, operation: "TO_HAND" | "FACE_UP" | "FACE_DOWN"): MovementOperation | null {
  const id = board.players[actor].life[0], card = id ? board.cards[id] : undefined;
  if (!card || card.owner !== actor || card.controller !== actor) return null;
  const ref = { instanceId: card.instanceId, generation: card.generation };
  if (operation === "TO_HAND") return { kind: "move", card: ref, from: { player: actor, zone: "life" },
    to: { player: actor, zone: "hand", position: "append", faceUp: true, rotated: false }, cause: "COST_PAYMENT" };
  const faceUp = operation === "FACE_UP";
  return card.faceUp === faceUp ? null : { kind: "setTopLifeFace", card: ref, faceUp };
}

export function activationCostSelector(costs: Costs): DeepReadonly<Node<"selector">> | undefined {
  for (const cost of costs) {
    if (cost.type === "REVEAL_CARDS") return cost.selector;
    if (cost.type === "MOVE_AS_COST" && cost.selector !== "SOURCE") return cost.selector;
  }
}

export function movesActivationSource(costs: Costs): boolean {
  return costs.some(cost => cost.type === "MOVE_AS_COST" && cost.selector === "SOURCE");
}

export function filteredCostCandidates(environment: ResolutionEnvironment, selector: DeepReadonly<Node<"selector">>,
  source: Readonly<CardObjectRef>, excluded?: ReadonlySet<string>): ResolutionCandidate[] | "unknown" {
  const matches: ResolutionCandidate[] = [];
  for (const row of environment.candidates(selector, {})) {
    if (excluded?.has(row.ref.instanceId) || selector.excludeSource && row.ref.instanceId === source.instanceId && row.ref.generation === source.generation) continue;
    const eligible = environment.evaluate(selector.filters, {}, row.ref);
    if (eligible === "unknown") return "unknown";
    if (eligible) matches.push(row);
  }
  return matches;
}

export function handDiscardOperation(board: MovementState, actor: Player, ref: Readonly<CardObjectRef>,
  cause: "COST_PAYMENT" | "EFFECT_MOVE"): Extract<MovementOperation, { kind: "move" }> {
  const card = getCard(board, ref), from = location(board, ref.instanceId);
  ensureMove(from.zone === "hand" && from.player === actor && card.owner === actor && card.controller === actor &&
    ["character", "stage", "event"].includes(card.kind) && visibleTo(board, card, from, actor) &&
    !visibleTo(board, card, from, (1 - actor) as Player), "v3-fixture-discard-cost-unavailable");
  return { kind: "move", card: ref, from, to: { player: actor, zone: "trash", position: "append", faceUp: true, rotated: false }, cause };
}
