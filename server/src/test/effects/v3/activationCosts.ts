import type { DeepReadonly } from "../types";
import type { Node } from "./dsl";

type Costs = readonly DeepReadonly<Node<"cost">>[];

export function activationCostSelector(costs: Costs): DeepReadonly<Node<"selector">> | undefined {
  for (const cost of costs) {
    if (cost.type === "REVEAL_CARDS") return cost.selector;
    if (cost.type === "MOVE_AS_COST" && cost.selector !== "SOURCE") return cost.selector;
  }
}

export function movesActivationSource(costs: Costs): boolean {
  return costs.some(cost => cost.type === "MOVE_AS_COST" && cost.selector === "SOURCE");
}
