import { visibleTo } from "../../movement/engine";
import { ensureMove } from "../../movement/state";
import type { MovementState, Player } from "../../movement/types";
import type { CardObjectRef, DeepReadonly } from "../types";
import type { ApprovedV3Card } from "./approval";
import type { Effect } from "./dsl";
import { isShareableMainEvent } from "./simpleMainEvent";

export type ExternalBodyRef = Readonly<{ source: Readonly<CardObjectRef>; cardId: string; effectId: string; definitionHash: string }>;
export const effectUsageKey = (turn: number, actor: Player, source: Readonly<CardObjectRef>, effectId: string): string =>
  JSON.stringify([turn, actor, source.instanceId, source.generation, effectId]);

function trashEvent(board: MovementState, actor: Player, id: string, definitions: ReadonlyMap<string, ApprovedV3Card>) {
  const card = board.cards[id], at = { player: actor, zone: "trash" } as const;
  if (!card || card.owner !== actor || card.controller !== actor || card.kind !== "event" || !card.faceUp ||
    !visibleTo(board, card, at, 0) || !visibleTo(board, card, at, 1)) return null;
  const definition = definitions.get(card.cardId);
  return definition?.definition.cardType === "event" ? { card, definition } : null;
}

export function externalBodyChoices(board: MovementState, actor: Player, maxPrintedCost: number,
  definitions: ReadonlyMap<string, ApprovedV3Card>, used: (key: string) => number): ExternalBodyRef[] {
  return board.players[actor].trash.flatMap(id => {
    const object = id && trashEvent(board, actor, id, definitions);
    if (!object) return [];
    const { card, definition } = object, cost = definition.definition.baseStats.cost;
    if (cost === null || cost > maxPrintedCost) return [];
    const source = { instanceId: card.instanceId, generation: card.generation };
    return definition.definition.effects.flatMap(effect =>
      isShareableMainEvent(effect) && (!effect.usageLimit || used(effectUsageKey(board.turnNumber, actor, source, effect.id)) < effect.usageLimit.count) ?
        [{ source, cardId: card.cardId, effectId: effect.id, definitionHash: definition.definitionHash }] : []);
  });
}

export function resolveExternalBody(board: MovementState, actor: Player, ref: ExternalBodyRef,
  definitions: ReadonlyMap<string, ApprovedV3Card>): { definition: ApprovedV3Card; effect: DeepReadonly<Effect> } {
  const object = board.players[actor].trash.includes(ref.source.instanceId) && trashEvent(board, actor, ref.source.instanceId, definitions);
  ensureMove(object && object.card.cardId === ref.cardId && object.card.generation === ref.source.generation &&
    object.definition.definitionHash === ref.definitionHash, "v3-effect-body-stale-source");
  const effect = object.definition.definition.effects.find(row => row.id === ref.effectId);
  ensureMove(effect && isShareableMainEvent(effect), "v3-effect-body-main-target");
  return { definition: object.definition, effect };
}
