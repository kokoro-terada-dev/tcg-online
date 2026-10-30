import { visibleTo } from "../../movement/engine";
import { ensureMove, freezeMovement, getCard, id, location, player } from "../../movement/state";
import type { EventCause, MovementEvent, MovementState, Player } from "../../movement/types";
import type { CardObjectRef, DeepReadonly } from "../types";
import { masterCardFacts, type PinnedMasterFacts } from "../masterFacts";
import type { ApprovedV3Card } from "./approval";
import type { ResolutionIdentity } from "./resolution";
import { statDelta, type StatEffects } from "./statEffects";
import { ABILITY_TAGS } from "./compiler";
import type { AbilityTag } from "./dsl";
import type { KeywordGrants } from "./keywordEffects";

export const UNKNOWN: unique symbol = Symbol("v3-unknown-fact");
export type KnownOrUnknown<T> = T | typeof UNKNOWN;
export type BoundaryEvent = Readonly<{ type: "ON_BLOCK" | "MAIN_START" | "TURN_END"; eventId: string; turnNumber: number; activePlayer: Player;
  phase: "main" | "refresh" | "end"; phaseToken: string; battleId: string | null; blocker: Readonly<CardObjectRef> | null }>;
export type EventContext = Readonly<{
  effectController: Player; chooser: Player | null; sourceOwner: Player; sourceController: Player;
  source: Readonly<CardObjectRef>; eventId: string | null; cause: DeepReadonly<EventCause> | null;
  origin: "activation" | "movement" | "attack" | "boundary"; attack: Readonly<{ battleId: string; attacker: Player }> | null;
  boundary?: BoundaryEvent;
  movement?: Readonly<{ groupId: string; operationIndex: number; targetBefore: Readonly<CardObjectRef> | null;
    targetAfter: Readonly<CardObjectRef> | null; from: MovementEvent["from"]; to: MovementEvent["to"]; isKO: boolean }>;
}>;
export type EventOrigin = Readonly<{ type: "movement"; event: DeepReadonly<MovementEvent> }> |
  Readonly<{ type: "boundary"; event: BoundaryEvent }> |
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
  if (origin?.type === "boundary") { id(origin.event.eventId); id(origin.event.phaseToken); player(origin.event.activePlayer); ensureMove(origin.event.turnNumber === state.turnNumber, "v3-boundary-turn-mismatch"); }
  return freezeMovement({ effectController: identity.actor, chooser, sourceOwner: source.owner, sourceController: source.controller,
    source: { ...identity.source }, eventId: event?.eventId ?? (origin?.type === "attack" ? origin.eventId : origin?.type === "boundary" ? origin.event.eventId : null), cause: event ? structuredClone(event.cause) : null,
    origin: origin?.type ?? "activation", attack: origin?.type === "attack" ? { battleId: origin.battleId, attacker: origin.attacker } : null,
    ...(origin?.type === "boundary" ? { boundary: origin.event } : {}),
    ...(event ? { movement: { groupId: event.groupId, operationIndex: event.operationIndex,
      targetBefore: event.before ? { instanceId: event.before.instanceId, generation: event.before.generation } : null,
      targetAfter: event.after ? { instanceId: event.after.instanceId, generation: event.after.generation } : null,
      from: event.from, to: event.to, isKO: event.isKO } } : {}) });
}

export type CardMetadataFacts = Readonly<{ name: KnownOrUnknown<string>; traits: KnownOrUnknown<readonly string[]>;
  colors: KnownOrUnknown<readonly string[]>; attributes: KnownOrUnknown<readonly string[]> }>;
export type DerivedCardFacts = Readonly<{
  cardType: KnownOrUnknown<string>; rotated: boolean; owner: Player; controller: Player;
  printed: Readonly<Record<"cost" | "power" | "counter" | "life", KnownOrUnknown<number>>>;
  current: Readonly<Record<"cost" | "power", KnownOrUnknown<number>>>;
  metadata: Readonly<{ printed: CardMetadataFacts; current: CardMetadataFacts }>;
  abilities: Readonly<Record<"PRINTED" | "GRANTED" | "CURRENT", Readonly<Record<AbilityTag, KnownOrUnknown<boolean>>>>>;
}>;
type Ref = Readonly<CardObjectRef>;
type ReaderOptions = Readonly<{
  board: () => MovementState; definitions: ReadonlyMap<string, ApprovedV3Card>; master?: PinnedMasterFacts;
  statEffects: () => StatEffects; activePlayer: Player; counterPower?: (ref: Ref) => number;
  keywordGrants?: () => KeywordGrants;
}>;
const numeric = (value: unknown): KnownOrUnknown<number> => typeof value === "number" && Number.isSafeInteger(value) ? value : UNKNOWN;
const keywordTags = new Set<AbilityTag>(["BLOCKER", "RUSH", "RUSH_CHARACTER", "CANNOT_BE_BLOCKED"]);

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
      const definition = known && matching ? known.definition : null;
      const metadata: CardMetadataFacts = { name: definition?.name ?? UNKNOWN, traits: definition ? [...definition.traits] : UNKNOWN,
        colors: definition ? [...definition.colors] : UNKNOWN, attributes: definition ? [...definition.attributes] : UNKNOWN };
      const unmodeled = card.modifierIds.length > 0 || card.grantIds.length > 0;
      const unknownMetadata: CardMetadataFacts = { name: UNKNOWN, traits: UNKNOWN, colors: UNKNOWN, attributes: UNKNOWN };
      const printedAbilities = Object.fromEntries(ABILITY_TAGS.map(tag => [tag, definition ?
        keywordTags.has(tag) ? definition.keywords.some(keyword => keyword.type === tag) : definition.effects.some(effect => effect.timing.type === tag) : UNKNOWN])) as Record<AbilityTag, KnownOrUnknown<boolean>>;
      const grantedAbilities = Object.fromEntries(ABILITY_TAGS.map(tag => [tag, !definition || unmodeled || !keywordTags.has(tag) ? UNKNOWN :
        ["leader", "character"].includes(at.zone) && (options.keywordGrants?.() ?? []).some(grant => grant.target.instanceId === ref.instanceId && grant.target.generation === ref.generation && grant.keyword === tag)])) as Record<AbilityTag, KnownOrUnknown<boolean>>;
      // Timing tags cannot be granted by this engine. Keyword union preserves three-valued facts.
      const currentAbilities = Object.fromEntries(ABILITY_TAGS.map(tag => [tag, !definition || unmodeled ? UNKNOWN : !keywordTags.has(tag) ? printedAbilities[tag] :
        printedAbilities[tag] === true || grantedAbilities[tag] === true ? true : printedAbilities[tag] === UNKNOWN || grantedAbilities[tag] === UNKNOWN ? UNKNOWN : false])) as Record<AbilityTag, KnownOrUnknown<boolean>>;
      return freezeMovement({ cardType: card.kind === "unknown" ? UNKNOWN : card.kind, rotated: card.rotated, owner: card.owner, controller: card.controller,
        printed, current: { cost: current("cost"), power: current("power") }, metadata: { printed: metadata, current: unmodeled ? unknownMetadata : metadata },
        abilities: { PRINTED: printedAbilities, GRANTED: grantedAbilities, CURRENT: currentAbilities } });
    } catch { return UNKNOWN; }
  };
}
