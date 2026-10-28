import type { CardObjectRef } from "./types";
import type { FactRecord } from "./facts";
import type { SelectionSnapshot, Seat } from "./selectionTypes";
import { location, freezeMovement } from "../movement/state";
import type { MovementCard, MovementState } from "../movement/types";

function cardFacts(state: MovementState, card: MovementCard): FactRecord {
  return { id: card.instanceId, zone: location(state, card.instanceId).zone,
    ...(card.kind === "unknown" ? {} : { type: card.kind }), rotated: card.rotated,
    ...(card.enteredTurn === null ? {} : { enteredTurn: card.enteredTurn }) };
}
export function movementSourceFacts(state: MovementState, source: Readonly<CardObjectRef>): FactRecord {
  return freezeMovement(cardFacts(state, state.cards[source.instanceId]!));
}

// Facts absent from Movement (printed cost/power, phase, event, etc.) remain absent/unknown.
export function movementSelectionSnapshot(state: MovementState, actor: Seat, source: FactRecord): SelectionSnapshot {
  const counts = (seat: Seat): FactRecord => ({ lifeCount: state.players[seat].life.length,
    handCount: state.players[seat].hand.length, characterCount: state.players[seat].character.filter(Boolean).length });
  return freezeMovement({ matchId: state.matchId, revision: state.revision,
    cards: Object.values(state.cards).flatMap(card => {
      const zone = location(state, card.instanceId).zone;
      if (zone === "attachedDon") return [];
      return [{ instanceId: card.instanceId, generation: card.generation, owner: card.owner,
        controller: card.controller, zone, cardId: card.cardId, faceUp: card.faceUp, facts: cardFacts(state, card) }];
    }), facts: { self: counts(actor), opponent: counts(actor === 0 ? 1 : 0), source, game: { turnNumber: state.turnNumber } } });
}
