import { movementOccurrence } from "../../movement/occurrence";
import { ensureMove, freezeMovement, getCard, location, reference } from "../../movement/state";
import { visibleTo } from "../../movement/engine";
import type { MovementEvent, MovementState, TransactionResult } from "../../movement/types";
import type { CardObjectRef } from "../types";
import type { DerivedCardFacts, EventContext, KnownOrUnknown } from "./readContext";
import { movementReadContext, UNKNOWN } from "./readContext";
import type { ResolutionIdentity } from "./resolution";

type Ref = Readonly<CardObjectRef>;
export type RememberedColors = Readonly<{ status: "KNOWN"; value: readonly string[] }> | Readonly<{ status: "UNKNOWN" }>;
export type MoveResult = Readonly<{
  matchId: string; resolutionId: string; effectId: string; workId: string; transactionId: string | null;
  effectController: 0 | 1; source: Ref;
  beforeRevision: number; afterRevision: number;
  // Transaction grouping is evidence, not a claim about unresolved simultaneous timing rulings.
  rows: readonly Readonly<{ event: MovementEvent; movement: NonNullable<EventContext["movement"]>; beforeColors: RememberedColors; afterColors: RememberedColors;
    beforePrintedColors?: RememberedColors; afterPrintedColors?: RememberedColors }>[];
}>;
export type ResultBindings = Readonly<Record<string, MoveResult>>;
const certified = new WeakSet<object>();
export const isCertifiedMoveResult = (result: MoveResult): boolean => certified.has(result);
export function emptyMoveResult(identity: ResolutionIdentity, workId: string, revision: number): MoveResult {
  const result = freezeMovement({ matchId: identity.matchId, resolutionId: identity.resolutionId, effectId: identity.effectId, effectController: identity.actor, source: { ...identity.source }, workId, transactionId: null,
    beforeRevision: revision, afterRevision: revision, rows: [] });
  certified.add(result); return result;
}

export function captureMoveResult(before: MovementState, result: TransactionResult, identity: ResolutionIdentity, workId: string,
  requested: readonly Ref[], facts: (state: MovementState, ref: Ref, viewer: 0 | 1) => KnownOrUnknown<DerivedCardFacts>, includePrinted = false): MoveResult {
  ensureMove(before.matchId === identity.matchId && result.state.matchId === identity.matchId && result.state.revision === before.revision + 1 &&
    requested.length > 0 && requested.length <= 50 && new Set(requested.map(ref => ref.instanceId)).size === requested.length, "v3-move-result-context");
  const colors = (state: MovementState, ref: Ref, basis: "printed" | "current" = "current"): RememberedColors => {
    const card = getCard(state, ref), at = location(state, ref.instanceId);
    if (!visibleTo(state, card, at, 0) || !visibleTo(state, card, at, 1)) return { status: "UNKNOWN" };
    const derived = facts(state, ref, identity.actor);
    const value = derived === UNKNOWN ? UNKNOWN : derived.metadata[basis].colors;
    return value === UNKNOWN ? { status: "UNKNOWN" } : { status: "KNOWN", value: [...value] };
  };
  let transactionId: string | undefined;
  const rows = requested.map(ref => {
    getCard(before, ref);
    const matches = result.events.filter(event => event.kind === "moved" && event.before?.instanceId === ref.instanceId && event.before.generation === ref.generation);
    ensureMove(matches.length === 1, "v3-move-result-missing-or-ambiguous");
    const event = matches[0]!, occurrence = movementOccurrence(event);
    ensureMove(occurrence && JSON.stringify(occurrence.before) === JSON.stringify(before) && occurrence.after === result.state && occurrence.events.includes(event) &&
      event.after?.instanceId === ref.instanceId && event.after.generation === ref.generation + 1 && event.from && event.to &&
      event.cause.kind === "EFFECT_MOVE" && event.cause.actor === identity.actor && event.cause.effectController === identity.actor &&
      event.cause.resolutionId === identity.resolutionId && event.cause.source?.instanceId === identity.source.instanceId &&
      event.cause.source.generation === identity.source.generation && (!transactionId || transactionId === occurrence.transactionId), "v3-move-result-evidence");
    transactionId = occurrence.transactionId;
    const afterRef = { instanceId: event.after.instanceId, generation: event.after.generation };
    return { event, movement: movementReadContext(event), beforeColors: colors(before, ref), afterColors: colors(result.state, afterRef),
      ...(includePrinted ? { beforePrintedColors: colors(before, ref, "printed"), afterPrintedColors: colors(result.state, afterRef, "printed") } : {}) };
  });
  const memory = freezeMovement({ matchId: identity.matchId, resolutionId: identity.resolutionId, effectId: identity.effectId, effectController: identity.actor, source: { ...identity.source }, workId,
    transactionId: transactionId!, beforeRevision: before.revision, afterRevision: result.state.revision, rows });
  certified.add(memory); return memory;
}

// Only explicitly remembered public facts survive movement. Never resolves an old ref to its latest generation.
export function rememberedColors(result: MoveResult | undefined, identity: ResolutionIdentity): KnownOrUnknown<readonly string[]> {
  if (!result || !matchesIdentity(result, identity) || !result.rows.length) return UNKNOWN;
  if (result.rows.some(row => row.beforeColors.status !== "KNOWN")) return UNKNOWN;
  return [...new Set(result.rows.flatMap(row => row.beforeColors.status === "KNOWN" ? row.beforeColors.value : []))];
}

function matchesIdentity(result: MoveResult, identity: ResolutionIdentity): boolean {
  return result.matchId === identity.matchId && result.resolutionId === identity.resolutionId && result.effectId === identity.effectId &&
    result.effectController === identity.actor && result.source.instanceId === identity.source.instanceId && result.source.generation === identity.source.generation;
}

export function currentMovedRef(result: MoveResult, rowIndex: number, board: MovementState, identity: ResolutionIdentity, viewer: 0 | 1): KnownOrUnknown<Ref> {
  if (!isCertifiedMoveResult(result) || !matchesIdentity(result, identity) || board.matchId !== identity.matchId || !Number.isSafeInteger(rowIndex)) return UNKNOWN;
  const row = result.rows[rowIndex]; if (!row?.event.after || !row.event.to) return UNKNOWN;
  try {
    const ref = { instanceId: row.event.after.instanceId, generation: row.event.after.generation }, card = getCard(board, ref), at = location(board, ref.instanceId);
    if (at.player !== row.event.to.player || at.zone !== row.event.to.zone || !visibleTo(board, card, at, viewer) || !row.event.visibleAfter.includes(viewer)) return UNKNOWN;
    return freezeMovement(ref);
  } catch { return UNKNOWN; }
}

export type RememberedMoveFacts = Readonly<{
  identity: ResolutionIdentity; workId: string; transactionId: string | null;
  snapshot: "BEFORE" | "AFTER"; basis: "PRINTED" | "CURRENT"; field: "colors";
  rows: readonly Readonly<{ eventId: string; movement: NonNullable<EventContext["movement"]>; cause: MovementEvent["cause"]; value: RememberedColors }>[];
}>;
export type FactBindings = Readonly<Record<string, RememberedMoveFacts>>;

// Called only with coordinator-captured results from a trusted/signed resolution frame.
export function rememberMoveFacts(result: MoveResult | undefined, identity: ResolutionIdentity, selected: readonly Ref[] | null,
  snapshot: "BEFORE" | "AFTER", basis: "PRINTED" | "CURRENT"): RememberedMoveFacts {
  ensureMove(result && matchesIdentity(result, identity), "v3-memory-result-identity");
  ensureMove((snapshot === "BEFORE" || snapshot === "AFTER") && (basis === "PRINTED" || basis === "CURRENT"), "v3-memory-snapshot-or-basis");
  if (selected !== null) {
    ensureMove(Array.isArray(selected) && selected.length <= 50 && new Set(selected.map(ref => ref.instanceId)).size === selected.length, "v3-memory-row-selection");
    for (const ref of selected) {
      reference(ref);
      ensureMove(result.rows.filter(row => row.movement.targetBefore?.instanceId === ref.instanceId && row.movement.targetBefore?.generation === ref.generation).length === 1, "v3-memory-row-not-in-result");
    }
  }
  const rows = result.rows.filter(row => selected === null || selected.some(ref => ref.instanceId === row.movement.targetBefore?.instanceId && ref.generation === row.movement.targetBefore?.generation));
  return freezeMovement({ identity: structuredClone(identity), workId: result.workId, transactionId: result.transactionId, snapshot, basis, field: "colors",
    rows: rows.map(row => ({ eventId: row.event.eventId, movement: row.movement, cause: row.event.cause,
      value: (snapshot === "BEFORE" ? basis === "CURRENT" ? row.beforeColors : row.beforePrintedColors : basis === "CURRENT" ? row.afterColors : row.afterPrintedColors) ?? { status: "UNKNOWN" } })) });
}

export function readRememberedColors(memory: RememberedMoveFacts | undefined, identity: ResolutionIdentity): KnownOrUnknown<readonly string[]> {
  const expected = memory?.identity;
  if (!memory || !expected || expected.matchId !== identity.matchId || expected.resolutionId !== identity.resolutionId || expected.effectId !== identity.effectId ||
    expected.actor !== identity.actor || expected.source.instanceId !== identity.source.instanceId || expected.source.generation !== identity.source.generation ||
    memory.field !== "colors" || !memory.rows.length || memory.rows.some(row => row.value.status !== "KNOWN")) return UNKNOWN;
  return [...new Set(memory.rows.flatMap(row => row.value.status === "KNOWN" ? row.value.value : []))];
}
