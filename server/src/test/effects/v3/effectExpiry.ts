import { ensureMove, id } from "../../movement/state";
import type { DeepReadonly } from "../types";
import type { Node } from "./dsl";

export type EffectExpiry = Readonly<{ endPlayer: 0 | 1; remaining: 1 | 2; battleId?: never } | { endPlayer: null; remaining: null; battleId: string }>;
export function expiryFor(duration: DeepReadonly<Node<"duration">>, actor: 0 | 1, battleId: string | null): EffectExpiry {
  if (duration.type === "BATTLE_END") {
    ensureMove(battleId !== null, "v3-battle-duration-outside-battle"); id(battleId);
    return { endPlayer: null, remaining: null, battleId };
  }
  return { endPlayer: duration.player === "SELF" ? actor : (1 - actor) as 0 | 1, remaining: duration.occurrence };
}
export function validateExpiry(value: EffectExpiry): void {
  if (value.battleId !== undefined) {
    id(value.battleId); ensureMove(value.endPlayer === null && value.remaining === null, "v3-invalid-battle-expiry");
  } else ensureMove((value.endPlayer === 0 || value.endPlayer === 1) && (value.remaining === 1 || value.remaining === 2), "v3-invalid-turn-expiry");
}
