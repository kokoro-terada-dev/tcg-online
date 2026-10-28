import { applyCommand, type Match } from "../game";
import { checkTiming, freezeState } from "../progression/state";
import type { Progression } from "../progression/types";
import { ensureMove, freezeMovement, id, location, player } from "../movement/state";
import type { MovementRules, MovementState, Player } from "../movement/types";
import type { ResolutionIdentity } from "../movement/resolution";
import { MatchMovementCapture } from "./matchMovement";
import { TimedMovementEffect } from "./timedMovement";
import { EffectCommandHost, type EffectCommandResponse, type EffectTransportView } from "./effectCommandHost";
import type { MasterFactOptions } from "./masterFacts";
import { randomUUID } from "node:crypto";
import { getCard } from "../movement/state";
import type { CardObjectRef } from "./types";
import type { EffectCatalog } from "./effectCatalog";
import type { EffectCatalogQuery, EffectCatalogView } from "../effectProtocol";

type Mode = "legacy" | "automated" | "faulted" | "closed";
type OwnerFailure = Readonly<{ ok: false; code: "owner_unavailable" | "legacy_conflict" }>;

// Server-only ownership boundary. Room integration must route *all* writes through one owner.
export class EffectMatchOwner {
  #legacy: Match;
  #capture: MatchMovementCapture | null = null;
  #mode: Mode = "legacy";
  #board: MovementState | null = null;
  #progression: Progression | null = null;
  #active: { effect: TimedMovementEffect; host: EffectCommandHost; resolutionId: string } | null = null;
  #used = new Set<string>();
  #busy = false;
  #catalog: EffectCatalog | null;
  constructor(match: Match, catalog: EffectCatalog | null = null) { this.#legacy = match; this.#catalog = catalog; }
  #remember(): void {
    if (this.#active) { const state = this.#active.effect.snapshot(); this.#board = state.movement; this.#progression = state.progression; }
  }
  #current(): boolean {
    try { this.#capture!.assertCurrent(this.#legacy); return true; }
    catch { this.#remember(); this.#mode = "faulted"; return false; }
  }
  snapshot() {
    const active = this.#active?.effect.snapshot();
    return Object.freeze({ mode: this.#mode, movement: active?.movement ?? this.#board,
      progression: active?.progression ?? this.#progression, activeResolutionId: this.#active?.resolutionId ?? null, catalogVersion: this.#catalog?.version ?? null });
  }
  toJSON(): never { throw new Error("server-only-effect-match-owner"); }
  applyLegacyCommand(actor: Player, input: unknown): string | null {
    player(actor); ensureMove(!this.#busy && this.#mode === "legacy", "legacy-writes-disabled");
    this.#busy = true;
    try { return applyCommand(this.#legacy, actor, input); }
    finally { this.#busy = false; }
  }
  adopt(progression: Progression): void {
    ensureMove(!this.#busy && this.#mode === "legacy", "owner-cannot-adopt");
    ensureMove(progression.gate.kind === "idle" && progression.battle === null && progression.outcome === null &&
      progression.phase === "main" && progression.phaseSettled, "owner-needs-settled-main-checkpoint");
    const capture = new MatchMovementCapture(this.#legacy, progression.turnNumber);
    const pinned = freezeState(structuredClone(progression));
    capture.assertCurrent(this.#legacy);
    this.#capture = capture; this.#board = capture.snapshot().movement; this.#progression = pinned; this.#mode = "automated";
  }
  openEffect(identity: ResolutionIdentity, definition: unknown, rules: MovementRules,
    numericPolicy?: MasterFactOptions["numericPolicy"]): void {
    ensureMove(!this.#busy && this.#mode === "automated" && this.#active === null, "owner-cannot-open-effect");
    ensureMove(this.#current(), "owner-legacy-conflict");
    id(identity.resolutionId, 64);
    ensureMove(!this.#used.has(identity.resolutionId) && this.#used.size < 1024, "owner-resolution-id-used-or-limit");
    this.#busy = true;
    try {
      const effect = new TimedMovementEffect(this.#board!, this.#progression!, identity, definition,
        { master: this.#legacy.master, ...(numericPolicy === undefined ? {} : { numericPolicy }) });
      this.#active = { effect, host: new EffectCommandHost(effect, rules), resolutionId: identity.resolutionId };
      this.#used.add(identity.resolutionId);
    } finally { this.#busy = false; }
  }
  openRegisteredEffect(effectId: string, actor: Player, source: Readonly<CardObjectRef>, rules: MovementRules,
    numericPolicy?: MasterFactOptions["numericPolicy"]): string {
    player(actor);
    ensureMove(!this.#busy && this.#mode === "automated" && this.#active === null, "owner-cannot-open-effect");
    ensureMove(this.#current() && this.#catalog !== null, "owner-catalog-unavailable");
    const card = getCard(this.#board!, source), definition = this.#catalog!.resolve(effectId, card.cardId);
    ensureMove(definition !== null, "owner-effect-not-registered-for-card");
    const resolutionId = randomUUID();
    this.openEffect({ resolutionId, actor, source }, definition, rules, numericPolicy);
    return resolutionId;
  }
  registeredEffectsFor(actor: Player, query: EffectCatalogQuery): EffectCatalogView {
    player(actor);
    ensureMove(!this.#busy && this.#mode === "automated" && this.#current(), "owner-catalog-unavailable");
    const state = this.snapshot(), board = state.movement!, progression = state.progression!;
    ensureMove(query.matchId === board.matchId && query.expectedMovementRevision === board.revision &&
      query.expectedProgressionRevision === progression.revision, "stale-effect-catalog-query");
    const card = getCard(board, query.source), at = location(board, card.instanceId);
    ensureMove(card.owner === actor && card.controller === actor && at.player === actor && card.faceUp &&
      ["leader", "character", "stage"].includes(at.zone), "effect-catalog-source-not-visible-own-board");
    const effects = (this.#catalog?.listForCard(card.cardId) ?? []).map(entry => ({ ...entry,
      timingAvailable: entry.trigger.kind === "activate" && entry.trigger.window !== "trigger" &&
        checkTiming(progression, actor, entry.trigger.window === "main" ? "mainEffect" : "counterEffect").allowed }));
    return freezeMovement({ matchId: board.matchId, movementRevision: board.revision, progressionRevision: progression.revision,
      catalogVersion: this.#catalog?.version ?? null, source: { ...query.source }, effects });
  }
  handleEffect(actor: Player, input: unknown): EffectCommandResponse | OwnerFailure {
    player(actor);
    if (this.#busy || this.#mode !== "automated" || !this.#active) return { ok: false, code: "owner_unavailable" };
    this.#busy = true;
    try {
      if (!this.#current()) return { ok: false, code: "legacy_conflict" };
      const result = this.#active.host.handle(actor, input);
      this.#remember();
      if (!this.#current()) return { ok: false, code: "legacy_conflict" };
      return result;
    } finally { this.#busy = false; }
  }
  effectViewFor(viewer: Player): EffectTransportView | null {
    player(viewer);
    if (this.#busy || this.#mode !== "automated" || !this.#active || !this.#current()) return null;
    return this.#active.host.viewFor(viewer);
  }
  finishEffect(): void {
    ensureMove(!this.#busy && this.#mode === "automated" && this.#active !== null, "owner-no-active-effect");
    ensureMove(this.#current(), "owner-legacy-conflict");
    ensureMove(this.#active.effect.view().status === "completed" && this.#active.effect.snapshot().progression.gate.kind === "idle", "owner-effect-not-complete");
    this.#remember(); this.#active = null;
  }
  discardPreparedEffect(): void {
    ensureMove(!this.#busy && this.#mode === "automated" && this.#active !== null, "owner-no-active-effect");
    ensureMove(this.#current(), "owner-legacy-conflict");
    ensureMove(this.#active.effect.view().status === "prepared" && this.#active.effect.snapshot().progression.gate.kind === "idle", "owner-effect-already-started");
    this.#remember(); this.#active = null;
  }
  close(): void {
    ensureMove(!this.#busy, "owner-busy"); this.#remember(); this.#active = null; this.#mode = "closed";
  }
}
