import type { CardObjectRef } from "./types";
import type { FactRecord } from "./facts";
import type { SelectionSnapshot, Seat } from "./selectionTypes";
import { location, freezeMovement } from "../movement/state";
import type { MovementCard, MovementState } from "../movement/types";
import { masterCardFacts, type PinnedMasterFacts } from "./masterFacts";

function cardFacts(state: MovementState, card: MovementCard, catalog?: PinnedMasterFacts): FactRecord {
  return { ...masterCardFacts(state, card, catalog), id: card.instanceId, zone: location(state, card.instanceId).zone,
    ...(card.kind === "unknown" ? {} : { type: card.kind }), rotated: card.rotated,
    ...(card.enteredTurn === null ? {} : { enteredTurn: card.enteredTurn }) };
}
export function movementSourceFacts(state: MovementState, source: Readonly<CardObjectRef>, catalog?: PinnedMasterFacts): FactRecord {
  return freezeMovement(cardFacts(state, state.cards[source.instanceId]!, catalog));
}

// Facts absent from Movement (printed cost/power, phase, event, etc.) remain absent/unknown.
export function movementSelectionSnapshot(state: MovementState, actor: Seat, source: FactRecord, catalog?: PinnedMasterFacts): SelectionSnapshot {
  const counts = (seat: Seat): FactRecord => ({ lifeCount: state.players[seat].life.length,
    handCount: state.players[seat].hand.length, characterCount: state.players[seat].character.filter(Boolean).length });
  return freezeMovement({ matchId: state.matchId, revision: state.revision,
    cards: Object.values(state.cards).flatMap(card => {
      const zone = location(state, card.instanceId).zone;
      if (zone === "attachedDon") return [];
      return [{ instanceId: card.instanceId, generation: card.generation, owner: card.owner,
        controller: card.controller, zone, cardId: card.cardId, faceUp: card.faceUp, facts: cardFacts(state, card, catalog) }];
    }), facts: { self: counts(actor), opponent: counts(actor === 0 ? 1 : 0), source, game: { turnNumber: state.turnNumber } } });
}
