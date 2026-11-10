import type { DeepReadonly } from "../types";
import type { Effect } from "./dsl";

export function lifeSelfPlayProgram(actions: DeepReadonly<Effect["actions"]>): boolean {
  if (actions.length === 1) return actions[0]?.type === "PLAY_TRIGGER_SOURCE";
  const [draw, branch] = actions;
  return actions.length === 2 && draw?.type === "DRAW" && draw.player === "SELF" && branch?.type === "IF" &&
    branch.then.length === 1 && branch.then[0]?.type === "PLAY_TRIGGER_SOURCE" && branch.else.length === 0;
}

export function lifeSelfPlayCost(costs: DeepReadonly<Effect["costs"]>): boolean {
  if (costs.length === 0) return true;
  if (costs.length !== 1) return false;
  const cost = costs[0];
  return cost?.type === "DISCARD_HAND" && cost.count <= 3 || cost?.type === "DON_RETURN" && cost.count <= 10;
}
