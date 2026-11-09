import { visibleTo } from "../../movement/engine";
import { ensureMove } from "../../movement/state";
import type { MovementState } from "../../movement/types";
import type { ResolutionCandidate } from "./resolution";

export function ownerHandCandidates(board: MovementState, actor: 0 | 1, owner: 0 | 1): readonly ResolutionCandidate[] {
  ensureMove(owner === 1 - actor, "v3-owner-hand-owner");
  const at = { player: owner, zone: "hand" } as const;
  return board.players[owner].hand.map(id => {
    const card = id === null ? undefined : board.cards[id];
    ensureMove(card && card.owner === owner && card.controller === owner && ["character", "stage", "event"].includes(card.kind) &&
      visibleTo(board, card, at, owner), "v3-owner-hand-unknown");
    return { ref: { instanceId: card.instanceId, generation: card.generation }, cardId: card.cardId, owner, controller: owner,
      zone: at.zone, kind: card.kind, faceUp: card.faceUp, visibleTo: visibleTo(board, card, at, actor) ? [owner, actor] : [owner] };
  });
}
