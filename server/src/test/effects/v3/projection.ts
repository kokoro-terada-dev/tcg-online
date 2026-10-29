import { projectMovementState } from "../../movement/projection";
import { freezeMovement } from "../../movement/state";
import type { MovementState, MovementView } from "../../movement/types";

export function projectV3Movement(board: MovementState, viewer: 0 | 1): MovementView {
  const projected = projectMovementState(board, viewer);
  return freezeMovement({ ...projected, players: projected.players.map(zones => ({ ...zones, resolving: [] })) });
}
