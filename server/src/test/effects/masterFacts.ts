import type { MasterSnapshot } from "../cardMaster";
import type { MovementCard, MovementState } from "../movement/types";
import { ensureMove, freezeMovement } from "../movement/state";
import type { FactRecord, FactValue } from "./facts";

export type MasterFactOptions = Readonly<{
  master: MasterSnapshot | null;
  // Only a trusted server coordinator can certify the absence of unmodeled numeric effects.
  numericPolicy?: "unresolved" | "certifiedUnmodified";
}>;
export type PinnedMasterFacts = Readonly<{
  version: string | null; numericPolicy: "unresolved" | "certifiedUnmodified";
  cards: Readonly<Record<string, FactRecord>>;
}>;

// Pin only cards in this match, not the entire master, once per resolution.
export function pinMasterFacts(state: MovementState, options?: MasterFactOptions): PinnedMasterFacts {
  const master = options?.master, policy = options?.numericPolicy ?? "unresolved";
  ensureMove(policy === "unresolved" || policy === "certifiedUnmodified", "invalid-master-numeric-policy");
  const cards: Record<string, FactRecord> = Object.create(null);
  for (const card of Object.values(state.cards)) {
    if (Object.hasOwn(cards, card.cardId)) continue;
    const metadata = master?.cards[card.cardId];
    const facts: Record<string, FactValue> = Object.create(null);
    if (metadata) {
      if (metadata.type !== "unknown") facts.type = metadata.type;
      if (metadata.name !== null) facts.name = metadata.name;
      if (metadata.cost !== null) facts.cost = metadata.cost;
      if (metadata.power !== null) facts.power = metadata.power;
      for (const field of ["traits", "attributes", "colors"] as const) {
        if (master?.factPresence?.[card.cardId]?.includes(field)) facts[field] = [...metadata[field]];
      }
      // effectIds are links to definitions, not keyword abilities.
    }
    cards[card.cardId] = facts;
  }
  for (const card of Object.values(state.cards)) {
    const type = cards[card.cardId]?.type;
    ensureMove(type === undefined || card.kind === "unknown" || type === card.kind, "master-movement-kind-mismatch");
  }
  return freezeMovement({ version: master?.version ?? null, numericPolicy: policy, cards });
}

export function masterCardFacts(state: MovementState, card: MovementCard, catalog?: PinnedMasterFacts): FactRecord {
  const printed = catalog?.cards[card.cardId];
  const facts: Record<string, FactValue | undefined> = { ...printed };
  const numericSafe = catalog?.numericPolicy === "certifiedUnmodified" && card.modifierIds.length === 0 && card.grantIds.length === 0;
  if (!numericSafe) { delete facts.cost; delete facts.power; }
  // DON power depends on whose turn it is; that authoritative context is not connected yet.
  if (state.players.some(zones => zones.attachedDon.some(id => {
    const parent = state.cards[id!]!.attachedTo;
    return parent?.instanceId === card.instanceId && parent.generation === card.generation;
  }))) delete facts.power;
  return facts;
}
