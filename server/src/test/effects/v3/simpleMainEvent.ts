import type { Action, CardDefinition, Effect } from "./dsl";
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

export function isInteractiveMainEvent(effect: DeepReadonly<Effect>, privateDeck = false): boolean {
  return interactiveMainEvent(effect, false, privateDeck);
}

export function isShareableMainEvent(effect: DeepReadonly<Effect>, privateDeck = false): boolean {
  return interactiveMainEvent(effect, true, privateDeck);
}

export function isLifeTriggerBody(effect: DeepReadonly<Effect>, cardType: CardDefinition["cardType"], schema: CardDefinition["schemaVersion"]): boolean {
  const expanded = (schema === "3.0.0-subset.51" || schema === "3.0.0-subset.52");
  if (effect.timing.type === "MAIN")
    return cardType === "event" && isInteractiveMainEvent(effect, expanded || schema === "3.0.0-subset.50");
  if (!expanded || !(cardType === "event" && effect.timing.type === "COUNTER" ||
      cardType === "character" && (effect.timing.type === "ON_PLAY" || effect.timing.type === "ON_KO"))) return false;
  const usesSourceIdentity = (value: unknown): boolean => value !== null && typeof value === "object" &&
    ((value as Record<string, unknown>).type === "IS_SOURCE" || Object.values(value).some(usesSourceIdentity));
  // Borrow the same source-independent body policy; do not activate the printed timing or pay the printed card cost.
  return !usesSourceIdentity(effect.actions) &&
    isInteractiveMainEvent({ ...effect, kind: "activated", timing: { type: "MAIN" }, sourceZones: ["hand"] }, true);
}

function interactiveMainEvent(effect: DeepReadonly<Effect>, allowLimit: boolean, privateDeck: boolean): boolean {
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
      case "CHOOSE_MODE": return action.modes.every(mode => mode.actions.every(supported));
      case "OFFER_PAYMENT": return action.costs.every(cost => cost.type !== "REST_SOURCE" && !(cost.type === "MOVE_AS_COST" && cost.selector === "SOURCE"));
      case "IF_PAYMENT_SUCCEEDED": return action.then.every(supported) && action.else.every(supported);
      case "LOOK_TOP": case "ORDER_CARDS": case "RETURN_TO_DECK": case "TRASH_DECK_TOP": case "SHUFFLE_DECK": return privateDeck;
      case "SELECT": return privateDeck && action.selector.type === "BOUND_CARDS" || action.selector.type === "CARDS" && !action.selector.cardTypes.includes("don") &&
        (typeof action.selector.zone === "string" ? (privateDeck ? ["leader", "character", "stage", "hand", "trash"] : ["leader", "character", "stage", "hand"]).includes(action.selector.zone) :
          action.selector.zone.every(zone => ["leader", "character", "stage"].includes(zone)));
      case "DRAW": return action.player === "SELF";
      case "ADD_DON_UP_TO": return true;
      case "DISCARD_BY_OWNER": case "ORDER_THEN_MOVE": return true;
      case "KO": case "KO_STAGE": case "MOVE_LIFE": case "REST": case "SET_ACTIVE": case "REVEAL": return true;
      case "MODIFY_STAT": case "GRANT_KEYWORD": return action.duration.type === "TURN_END";
      case "MOVE_CARD": return ["hand", "trash", "public"].includes(action.destination.zone) && action.destination.position === "append" ||
        action.destination.owner === "CARD_OWNER" && action.destination.zone === "deck" && action.destination.position === "bottom";
      case "PLAY_BY_EFFECT": return privateDeck || action.from === "hand" && action.destination.slotPolicy === "FIRST_EMPTY";
      default: return false;
    }
  };
  return effect.kind === "activated" && effect.timing.type === "MAIN" && effect.sourceZones.length === 1 && effect.sourceZones[0] === "hand" &&
    !effect.optional && (effect.usageLimit === null || allowLimit && effect.usageLimit.count === 1) && effect.costs.length === 0 &&
    effect.activationConditions.type === "all" && effect.activationConditions.conditions.length === 0 &&
    effect.resolutionConditions.type === "all" && effect.resolutionConditions.conditions.length === 0 && effect.actions.length > 0 && effect.actions.every(supported);
}
