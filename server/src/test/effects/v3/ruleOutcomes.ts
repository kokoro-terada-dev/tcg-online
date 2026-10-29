import { ensureMove } from "../../movement/state";
import type { MovementState } from "../../movement/types";
import type { Progression } from "../../progression/types";

export const DECK_OUT_POLICY = {
  version: "v3-deck-out.1", source: "https://www.onepiece-cardgame.com/pdf/rule_comprehensive.pdf?20260828=",
  reviewedAt: "2026-10-29", clauses: ["1-2-1-1-2", "9-1-2", "9-2-1-2"],
} as const;
export function deckOutOutcome(board: MovementState): Progression["outcome"] {
  const empty = ([0, 1] as const).filter(player => board.players[player].deck.length === 0);
  // Current commands cannot empty both decks together. Do not invent a tie policy for new commands.
  ensureMove(empty.length < 2, "v3-simultaneous-deck-out-policy-unresolved");
  return empty.length ? { winner: (1 - empty[0]!) as 0 | 1, reason: "deck-empty" } : null;
}
