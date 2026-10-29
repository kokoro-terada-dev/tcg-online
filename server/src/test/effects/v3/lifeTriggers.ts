import { MovementStore } from "../../movement/engine";
import { ensureMove, getCard } from "../../movement/state";
import type { MovementEvent, MovementState } from "../../movement/types";
import type { Progression } from "../../progression/types";
import type { ApprovedV3Card } from "./approval";
import { acceptLifeDecision, type LifeDecision } from "./battle";

export type LifeTriggerCause = Readonly<{ battleId: string; event: MovementEvent }>;
export function prepareLifeTrigger(board: MovementState, progression: Progression, actor: 0 | 1, pending: LifeDecision, selectionId: string, token: string,
  transactionId: string, now: number, cards: ReadonlyMap<string, ApprovedV3Card>) {
  const next = acceptLifeDecision(board, progression, actor, pending, selectionId, token, now), card = getCard(board, pending.card), definition = cards.get(card.cardId);
  const effect = definition?.definition.effects.find(effect => effect.timing.type === "TRIGGER");
  ensureMove(definition && effect && board.players.every(zones => zones.resolving.length === 0), "v3-life-trigger-unavailable");
  // resolving is an internal transport slot, not a gameplay area. V3 projections omit it.
  const moved = new MovementStore(board).commit({ transactionId, matchId: board.matchId, expectedRevision: board.revision, turnNumber: board.turnNumber,
    actor, effectController: actor, source: pending.card, mode: "rule", resolutionId: pending.resolutionId, operations: [
      { kind: "move", card: pending.card, from: { player: actor, zone: "life" }, to: { player: actor, zone: "resolving", position: "append", faceUp: true, rotated: false }, cause: "DAMAGE" },
      { kind: "closeReveals", scopeId: pending.resolutionId },
    ] }, { status: "certifiedNone" });
  const event = moved.events.find(event => event.kind === "moved" && event.after?.instanceId === pending.card.instanceId)!;
  ensureMove(event?.after, "v3-life-trigger-move-missing");
  return { movement: moved.state, progression: next, events: moved.events, card: definition, effectId: effect.id,
    source: { instanceId: event.after.instanceId, generation: event.after.generation }, cause: { battleId: pending.battleId, event } };
}
