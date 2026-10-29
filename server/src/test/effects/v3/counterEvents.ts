import { MovementStore } from "../../movement/engine";
import { ensureMove, getCard, location } from "../../movement/state";
import type { MovementEvent, MovementOperation, MovementState } from "../../movement/types";
import type { Progression } from "../../progression/types";
import { checkTiming } from "../../progression/state";
import type { CardObjectRef } from "../types";
import type { ApprovedV3Card } from "./approval";
import { createHash } from "node:crypto";

export type CounterEventCause = Readonly<{ battleId: string; event: MovementEvent }>;
export function counterEventChoices(board: MovementState, progression: Progression, actor: 0 | 1, cards: ReadonlyMap<string, ApprovedV3Card>) {
  if (!checkTiming(progression, actor, "counterEffect").allowed) return [];
  return board.players[actor].hand.flatMap(id => {
    const card = board.cards[id!]!, definition = cards.get(card.cardId)?.definition;
    if (card.kind !== "event" || card.owner !== actor || card.controller !== actor || definition?.cardType !== "event") return [];
    const cost = definition.baseStats.cost;
    return definition.effects.filter(effect => effect.kind === "activated" && effect.timing.type === "COUNTER").map(effect => ({
      card: { instanceId: card.instanceId, generation: card.generation }, cardId: card.cardId, effectId: effect.id, cost,
      enabled: cost !== null && board.players[actor].activeDon.length >= cost,
    }));
  });
}
// Both candidate transactions stay local until the caller also constructs a valid resolution.
export function prepareCounterEvent(board: MovementState, progression: Progression, actor: 0 | 1, source: Readonly<CardObjectRef>, effectId: string,
  cards: ReadonlyMap<string, ApprovedV3Card>, transactionId: string, resolutionId: string) {
  const choice = counterEventChoices(board, progression, actor, cards).find(row => row.card.instanceId === source.instanceId && row.card.generation === source.generation && row.effectId === effectId);
  ensureMove(choice?.enabled && choice.cost !== null, "v3-counter-event-unavailable"); getCard(board, source);
  let candidate = board; const events: MovementEvent[] = [];
  if (choice.cost > 0) {
    const operations: MovementOperation[] = board.players[actor].activeDon.slice(0, choice.cost).map(id => ({ kind: "setRest", card: { instanceId: id!, generation: board.cards[id!]!.generation }, rotated: true }));
    const paid = new MovementStore(board).commit({ transactionId: createHash("sha256").update(`${transactionId}:cost`).digest("hex"), matchId: board.matchId, expectedRevision: board.revision,
      turnNumber: board.turnNumber, actor, effectController: null, source, mode: "cost", resolutionId, operations }, { status: "certifiedNone" });
    candidate = paid.state; events.push(...paid.events);
  }
  const used = new MovementStore(candidate).commit({ transactionId, matchId: candidate.matchId, expectedRevision: candidate.revision, turnNumber: candidate.turnNumber,
    actor, effectController: actor, source, mode: "rule", resolutionId: null, operations: [{ kind: "move", card: source, from: location(candidate, source.instanceId),
      to: { player: actor, zone: "trash", position: "append", faceUp: true, rotated: false }, cause: "OTHER" }] }, { status: "certifiedNone" });
  events.push(...used.events); const event = used.events.find(event => event.kind === "moved" && event.after?.instanceId === source.instanceId)!;
  ensureMove(event?.after, "v3-counter-event-move-missing");
  return { movement: used.state, events, source: { instanceId: event.after.instanceId, generation: event.after.generation }, cause: { battleId: progression.battle!.battleId, event } };
}
