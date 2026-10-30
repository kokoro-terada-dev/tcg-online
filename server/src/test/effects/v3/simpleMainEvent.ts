import type { Action, Effect } from "./dsl";
import type { DeepReadonly } from "../types";

// PR05a exposes only bounded, choice-free programs. This is not another interpreter.
export function isSimpleMainEvent(effect: DeepReadonly<Effect>): boolean {
  const draws = (action: DeepReadonly<Action>): number => action.type === "DRAW" && action.player === "SELF" ? action.count :
    action.type === "SEQUENCE" && action.actions.length ? action.actions.reduce((sum, child) => sum + draws(child), 0) : Infinity;
  const total = effect.actions.reduce((sum, action) => sum + draws(action), 0);
  return effect.kind === "activated" && effect.timing.type === "MAIN" && effect.sourceZones.length === 1 && effect.sourceZones[0] === "hand" &&
    !effect.optional && effect.usageLimit === null && effect.costs.length === 0 &&
    effect.activationConditions.type === "all" && effect.activationConditions.conditions.length === 0 &&
    effect.resolutionConditions.type === "all" && effect.resolutionConditions.conditions.length === 0 && Number.isSafeInteger(total) && total > 0 && total <= 50;
}
