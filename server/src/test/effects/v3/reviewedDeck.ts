import { parseDeck } from "../../game";
import type { DeckInput } from "../../protocol";
import { ensureMove, freezeMovement } from "../../movement/state";
import type { ApprovedV3Catalog } from "./approval";

export function validateReviewedV3Deck(input: unknown, catalog: ApprovedV3Catalog): DeckInput {
  const deck = parseDeck(input); ensureMove(deck, "v3-reviewed-deck-format");
  const leader = catalog.get(deck.leaderCardId)?.definition;
  ensureMove(leader?.cardType === "leader" && leader.baseStats.life !== null && leader.baseStats.power !== null && leader.colors.length > 0 && deck.leaderLifeCount === leader.baseStats.life, "v3-reviewed-leader-unavailable");
  const counts = new Map<string, number>();
  for (const id of deck.mainDeck) {
    const card = catalog.get(id)?.definition, copies = (counts.get(id) ?? 0) + 1; counts.set(id, copies);
    ensureMove(card && card.cardType !== "leader" && deck.cardTypes[id] === card.cardType && card.baseStats.cost !== null &&
      (card.cardType !== "character" || card.baseStats.power !== null), "v3-reviewed-main-card-unavailable");
    ensureMove(copies <= 4, "v3-reviewed-copy-limit");
    ensureMove(card.colors.some(color => leader.colors.includes(color)), "v3-reviewed-color-mismatch");
  }
  return freezeMovement(deck);
}
