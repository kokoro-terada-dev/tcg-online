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
  const used = prepareEventFromHand(board, actor, source, choice.cost, transactionId, resolutionId);
  return { ...used, cause: { battleId: progression.battle!.battleId, event: used.event } };
}

// Shared event payment/movement only; MAIN and COUNTER keep separate timing authorization.
export function prepareEventFromHand(board: MovementState, actor: 0 | 1, source: Readonly<CardObjectRef>, cost: number,
  transactionId: string, resolutionId: string, reveal = false) {
  const object = getCard(board, source), at = location(board, source.instanceId);
  ensureMove(at.player === actor && at.zone === "hand" && object.kind === "event" && object.owner === actor && object.controller === actor &&
    Number.isSafeInteger(cost) && cost >= 0 && board.players[actor].activeDon.length >= cost, "v3-event-use-unavailable");
  let candidate = board; const events: MovementEvent[] = [];
  if (reveal) {
    const opened = new MovementStore(candidate).commit({ transactionId: createHash("sha256").update(`${transactionId}:reveal`).digest("hex"), matchId: board.matchId, expectedRevision: candidate.revision,
      turnNumber: board.turnNumber, actor, effectController: actor, source, mode: "rule", resolutionId,
      operations: [{ kind: "reveal", card: source, scopeId: resolutionId, viewers: [0, 1] }] }, { status: "certifiedNone" });
    candidate = opened.state; events.push(...opened.events);
  }
  if (cost > 0) {
    const operations: MovementOperation[] = candidate.players[actor].activeDon.slice(0, cost).map(id => ({ kind: "setRest", card: { instanceId: id!, generation: candidate.cards[id!]!.generation }, rotated: true }));
    const paid = new MovementStore(candidate).commit({ transactionId: createHash("sha256").update(`${transactionId}:cost`).digest("hex"), matchId: board.matchId, expectedRevision: candidate.revision,
      turnNumber: board.turnNumber, actor, effectController: null, source, mode: "cost", resolutionId, operations }, { status: "certifiedNone" });
    candidate = paid.state; events.push(...paid.events);
  }
  const used = new MovementStore(candidate).commit({ transactionId, matchId: candidate.matchId, expectedRevision: candidate.revision, turnNumber: candidate.turnNumber,
    actor, effectController: actor, source, mode: "rule", resolutionId: null, operations: [{ kind: "move", card: source, from: location(candidate, source.instanceId),
      to: { player: actor, zone: "trash", position: "append", faceUp: true, rotated: false }, cause: "OTHER" }] }, { status: "certifiedNone" });
  events.push(...used.events); const event = used.events.find(event => event.kind === "moved" && event.after?.instanceId === source.instanceId)!;
  ensureMove(event?.after, "v3-counter-event-move-missing");
  return { movement: used.state, events, source: { instanceId: event.after.instanceId, generation: event.after.generation }, event };
}
