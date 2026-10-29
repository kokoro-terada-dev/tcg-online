import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureMove } from "../../movement/state";
import { loadReviewedV3Catalog } from "./reviewedCatalog";
import { validateReviewedV3Deck } from "./reviewedDeck";

export function loadReviewedV3Preset(id: string, reviewed = loadReviewedV3Catalog()) {
  ensureMove(id === "kid-basic", "v3-reviewed-preset-unavailable");
  const input: unknown = JSON.parse(readFileSync(resolve(__dirname, "../../../../data/effects-v3-reviewed/decks/kid-basic.json"), "utf8"));
  return { id, deck: validateReviewedV3Deck(input, reviewed.catalog), reviewed };
}
