import { visibleTo } from "../../movement/engine";
import { ensureMove, freezeMovement, getCard, id, location, player } from "../../movement/state";
import type { EventCause, MovementEvent, MovementState, Player } from "../../movement/types";
import type { CardObjectRef, DeepReadonly } from "../types";
import { masterCardFacts, type PinnedMasterFacts } from "../masterFacts";
import type { ApprovedV3Card } from "./approval";
import type { ResolutionIdentity } from "./resolution";
import { statDelta, type StatEffects } from "./statEffects";

export const UNKNOWN: unique symbol = Symbol("v3-unknown-fact");
export type KnownOrUnknown<T> = T | typeof UNKNOWN;
export type EventContext = Readonly<{
  effectController: Player; chooser: Player | null; sourceOwner: Player; sourceController: Player;
  source: Readonly<CardObjectRef>; eventId: string | null; cause: DeepReadonly<EventCause> | null;
  origin: "activation" | "movement" | "attack"; attack: Readonly<{ battleId: string; attacker: Player }> | null;
}>;
export type EventOrigin = Readonly<{ type: "movement"; event: DeepReadonly<MovementEvent> }> |
  Readonly<{ type: "attack"; eventId: string; battleId: string; attacker: Player }>;

export function withEventChooser(context: EventContext, chooser: Player | null): EventContext {
  if (chooser !== null) player(chooser);
  return freezeMovement({ ...context, chooser });
}

// Server-only snapshot, after coordinator authorization. Not a socket DTO or a new DSL value.
export function readEventContext(state: MovementState, identity: ResolutionIdentity, chooser: Player | null = null, origin?: EventOrigin): EventContext {
  player(identity.actor); if (chooser !== null) player(chooser);
  ensureMove(state.matchId === identity.matchId, "v3-read-context-match-mismatch");
  const source = getCard(state, identity.source);
  const event = origin?.type === "movement" ? origin.event : undefined;
  if (event) { id(event.eventId); player(event.cause.actor); if (event.cause.effectController !== null) player(event.cause.effectController); }
  if (origin?.type === "attack") { id(origin.eventId); id(origin.battleId); player(origin.attacker); }
  return freezeMovement({ effectController: identity.actor, chooser, sourceOwner: source.owner, sourceController: source.controller,
    source: { ...identity.source }, eventId: event?.eventId ?? (origin?.type === "attack" ? origin.eventId : null), cause: event ? structuredClone(event.cause) : null,
    origin: origin?.type ?? "activation", attack: origin?.type === "attack" ? { battleId: origin.battleId, attacker: origin.attacker } : null });
}

export type DerivedCardFacts = Readonly<{
  cardType: KnownOrUnknown<string>; rotated: boolean; owner: Player; controller: Player;
  printed: Readonly<Record<"cost" | "power" | "counter" | "life", KnownOrUnknown<number>>>;
  current: Readonly<Record<"cost" | "power", KnownOrUnknown<number>>>;
}>;
type Ref = Readonly<CardObjectRef>;
type ReaderOptions = Readonly<{
  board: () => MovementState; definitions: ReadonlyMap<string, ApprovedV3Card>; master?: PinnedMasterFacts;
  statEffects: () => StatEffects; activePlayer: Player; counterPower?: (ref: Ref) => number;
}>;
const numeric = (value: unknown): KnownOrUnknown<number> => typeof value === "number" && Number.isSafeInteger(value) ? value : UNKNOWN;

// A hidden card yields no facts, even when its definition happens to be in the catalog.
export function createDerivedCardFactsReader(options: ReaderOptions) {
  player(options.activePlayer);
  return (ref: Ref, viewer: Player): KnownOrUnknown<DerivedCardFacts> => {
    player(viewer);
    try {
      const state = options.board(), card = getCard(state, ref), at = location(state, card.instanceId);
      if (at.zone === "resolving" || !visibleTo(state, card, at, viewer)) return UNKNOWN;
      const known = options.definitions.get(card.cardId), matching = known?.definition.cardType === card.kind;
      const base = known ? matching ? known.definition.baseStats : undefined : options.master?.cards[card.cardId];
      const printed: DerivedCardFacts["printed"] = { cost: numeric(base?.cost), power: numeric(base?.power), counter: numeric(known && matching ? known.definition.baseStats.counter : undefined),
        life: numeric(known && matching ? known.definition.baseStats.life : undefined) };
      const current = (field: "power" | "cost"): KnownOrUnknown<number> => {
        const baseNumber: KnownOrUnknown<number> = known ? matching && !card.modifierIds.length && !card.grantIds.length ? printed[field] : UNKNOWN : numeric(masterCardFacts(state, card, options.master)[field]);
        if (baseNumber === UNKNOWN) return UNKNOWN;
        const don = field === "power" && card.controller === options.activePlayer ? state.players[options.activePlayer].attachedDon.filter(id => {
          const attached = state.cards[id!]!.attachedTo; return attached?.instanceId === ref.instanceId && attached.generation === ref.generation;
        }).length * 1000 : 0;
        const counter = field === "power" ? options.counterPower?.(ref) ?? 0 : 0;
        const result = numeric(baseNumber + statDelta(options.statEffects(), ref, field) + don + counter);
        return result === UNKNOWN ? UNKNOWN : field === "cost" ? Math.max(0, result) : result;
      };
      return freezeMovement({ cardType: card.kind === "unknown" ? UNKNOWN : card.kind, rotated: card.rotated, owner: card.owner, controller: card.controller,
        printed, current: { cost: current("cost"), power: current("power") } });
    } catch { return UNKNOWN; }
  };
}
