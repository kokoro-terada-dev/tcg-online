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

export function isInteractiveMainEvent(effect: DeepReadonly<Effect>): boolean {
  const sourceFree = (value: unknown): boolean => {
    if (!value || typeof value !== "object") return true;
    if (Array.isArray(value)) return value.every(sourceFree);
    const node = value as Record<string, unknown>;
    return node.subject !== "SOURCE" && !(typeof node.ref === "string" && node.ref.startsWith("SOURCE.")) && Object.values(node).every(sourceFree);
  };
  const supported = (action: DeepReadonly<Action>): boolean => {
    if (!sourceFree(action)) return false;
    switch (action.type) {
      case "SEQUENCE": return action.actions.length > 0 && action.actions.every(supported);
      case "IF": return action.then.every(supported) && action.else.every(supported);
      case "SELECT": return action.selector.type === "CARDS" && ["leader", "character", "stage", "hand"].includes(action.selector.zone as string) && !action.selector.cardTypes.includes("don");
      case "DRAW": return action.player === "SELF";
      case "KO": case "REST": case "SET_ACTIVE": case "REVEAL": return true;
      case "MODIFY_STAT": case "GRANT_KEYWORD": return action.duration.type === "TURN_END";
      case "MOVE_CARD": return ["hand", "trash", "public"].includes(action.destination.zone) && action.destination.position === "append";
      case "PLAY_BY_EFFECT": return true;
      default: return false;
    }
  };
  return effect.kind === "activated" && effect.timing.type === "MAIN" && effect.sourceZones.length === 1 && effect.sourceZones[0] === "hand" &&
    !effect.optional && effect.usageLimit === null && effect.costs.length === 0 &&
    effect.activationConditions.type === "all" && effect.activationConditions.conditions.length === 0 &&
    effect.resolutionConditions.type === "all" && effect.resolutionConditions.conditions.length === 0 && effect.actions.length > 0 && effect.actions.every(supported);
}
