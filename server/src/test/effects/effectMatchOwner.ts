import { applyCommand, type Match } from "../game";
import { checkTiming, freezeState } from "../progression/state";
import type { Progression } from "../progression/types";
import { dataObject, ensureMove, freezeMovement, id, location, player, reference } from "../movement/state";
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
import type { EffectCatalogQuery, EffectCatalogView, RegisteredEffectCommand } from "../effectProtocol";
import { projectMovementState } from "../movement/projection";
import { nextLocalTurnCheckpoint, openingLocalTurnCheckpoint } from "../localTurnCheckpoint";
import type { TestTurnCommand } from "../effectProtocol";

type Mode = "legacy" | "automated" | "faulted" | "closed";
type OwnerFailure = Readonly<{ ok: false; code: "owner_unavailable" | "legacy_conflict" }>;
type SessionReceipt = Readonly<{ fingerprint: string; ok: boolean; code: EffectCommandResponse["code"] }>;

// Server-only ownership boundary. Room integration must route *all* writes through one owner.
export class EffectMatchOwner {
  #legacy: Match;
  #capture: MatchMovementCapture | null = null;
  #mode: Mode = "legacy";
  #board: MovementState | null = null;
  #progression: Progression | null = null;
  #active: { effect: TimedMovementEffect; host: EffectCommandHost; resolutionId: string; rules: MovementRules; numericPolicy?: MasterFactOptions["numericPolicy"] } | null = null;
  #used = new Set<string>();
  #busy = false;
  #catalog: EffectCatalog | null;
  #activationEnabled: boolean;
  #idle: { resolutionId: string; rules: MovementRules; numericPolicy?: MasterFactOptions["numericPolicy"]; allowTestTurnSwitch: boolean } | null = null;
  #sessionReceipts: [Map<string, SessionReceipt>, Map<string, SessionReceipt>] = [new Map(), new Map()];
  constructor(match: Match, catalog: EffectCatalog | null = null, allowRegisteredActivation = false) {
    ensureMove(typeof allowRegisteredActivation === "boolean", "invalid-activation-policy");
    this.#legacy = match; this.#catalog = catalog; this.#activationEnabled = allowRegisteredActivation;
  }
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
  prepareRegisteredIdle(rules: MovementRules, numericPolicy?: MasterFactOptions["numericPolicy"], allowTestTurnSwitch = false): void {
    ensureMove(!this.#busy && this.#mode === "automated" && this.#active === null && this.#idle === null &&
      this.#activationEnabled && this.#catalog !== null && this.#current(), "owner-cannot-prepare-idle");
    ensureMove(["certifiedNone", "unresolved", "evaluate"].includes(rules.status) &&
      (numericPolicy === undefined || numericPolicy === "unresolved" || numericPolicy === "certifiedUnmodified"), "invalid-idle-policy");
    ensureMove(typeof allowTestTurnSwitch === "boolean" && (!allowTestTurnSwitch || (process.env.NODE_ENV !== "production" && rules.status === "certifiedNone")), "invalid-test-turn-policy");
    const pinnedRules: MovementRules = rules.status === "evaluate" ? Object.freeze({ status: "evaluate", check: rules.check.bind(rules) }) : Object.freeze({ status: rules.status });
    this.#idle = { resolutionId: randomUUID(), rules: pinnedRules, numericPolicy, allowTestTurnSwitch };
  }
  initializeLocalTurnStart(): void {
    ensureMove(!this.#busy && this.#mode === "automated" && !this.#active && this.#idle?.allowTestTurnSwitch &&
      process.env.NODE_ENV !== "production" && this.#current(), "local-opening-unavailable");
    this.#busy = true;
    try {
      const next = openingLocalTurnCheckpoint(this.#board!, this.#progression!, randomUUID());
      ensureMove(this.#current(), "owner-legacy-conflict"); this.#board = next;
    } finally { this.#busy = false; }
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
      const pinnedRules: MovementRules = rules.status === "evaluate" ? Object.freeze({ status: "evaluate", check: rules.check.bind(rules) }) : Object.freeze({ status: rules.status });
      this.#active = { effect, host: new EffectCommandHost(effect, pinnedRules), resolutionId: identity.resolutionId, rules: pinnedRules, numericPolicy };
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
      catalogVersion: this.#catalog?.version ?? null, activationEnabled: this.#activationEnabled && progression.gate.kind === "idle" &&
        (this.#active ? ["prepared", "completed"].includes(this.#active.effect.view().status) : this.#idle !== null), source: { ...query.source }, effects });
  }
  activateRegistered(actor: Player, input: unknown): EffectCommandResponse {
    player(actor);
    const respond = (ok: boolean, code: EffectCommandResponse["code"], requestId?: string, replayed = false): EffectCommandResponse => {
      const view = this.effectViewFor(actor); ensureMove(view !== null, "owner-unavailable");
      return freezeMovement({ ok, code, ...(requestId === undefined ? {} : { requestId }), replayed, view });
    };
    let command: RegisteredEffectCommand;
    try {
      dataObject(input, ["kind", "matchId", "resolutionId", "requestId", "expectedMovementRevision", "expectedProgressionRevision", "catalogVersion", "effectId", "source"]);
      ensureMove(input.kind === "activateRegistered", "invalid-activation-kind");
      id(input.matchId); id(input.resolutionId, 64); id(input.requestId); id(input.catalogVersion); id(input.effectId);
      reference(input.source as CardObjectRef);
      ensureMove(Number.isSafeInteger(input.expectedMovementRevision) && (input.expectedMovementRevision as number) >= 0 &&
        Number.isSafeInteger(input.expectedProgressionRevision) && (input.expectedProgressionRevision as number) >= 0, "invalid-activation-revision");
      command = { kind: "activateRegistered", matchId: input.matchId, resolutionId: input.resolutionId, requestId: input.requestId,
        expectedMovementRevision: input.expectedMovementRevision as number, expectedProgressionRevision: input.expectedProgressionRevision as number,
        catalogVersion: input.catalogVersion, effectId: input.effectId,
        source: { instanceId: (input.source as CardObjectRef).instanceId, generation: (input.source as CardObjectRef).generation } };
    } catch { return respond(false, "invalid_command"); }
    if (this.#busy) return respond(false, "busy", command.requestId);
    if (command.matchId !== this.snapshot().movement?.matchId) return respond(false, "wrong_context", command.requestId);
    const fingerprint = JSON.stringify(command), receipts = this.#sessionReceipts[actor], receipt = receipts.get(command.requestId);
    if (receipt) return receipt.fingerprint === fingerprint ? respond(receipt.ok, receipt.code, command.requestId, true) : respond(false, "request_conflict", command.requestId);
    if (receipts.size >= 1024) return respond(false, "request_limit", command.requestId);
    let ok = false;
    try {
      const catalog = this.registeredEffectsFor(actor, { matchId: command.matchId, expectedMovementRevision: command.expectedMovementRevision,
        expectedProgressionRevision: command.expectedProgressionRevision, source: command.source });
      ensureMove(catalog.activationEnabled && catalog.catalogVersion === command.catalogVersion && command.resolutionId === (this.#active?.resolutionId ?? this.#idle?.resolutionId) &&
        catalog.effects.some(entry => entry.effectId === command.effectId && entry.timingAvailable), "registered-activation-unavailable");
      ensureMove(this.#used.size < 1024, "owner-resolution-limit");
      const previous = this.#active ?? this.#idle!, state = this.snapshot(), card = getCard(state.movement!, command.source);
      const definition = this.#catalog!.resolve(command.effectId, card.cardId);
      ensureMove(definition !== null, "owner-effect-not-registered-for-card");
      this.#busy = true;
      try {
        const resolutionId = this.#active ? randomUUID() : this.#idle!.resolutionId;
        ensureMove(!this.#used.has(resolutionId), "owner-resolution-id-used");
        const effect = new TimedMovementEffect(state.movement!, state.progression!,
          { resolutionId, actor, source: command.source }, definition, { master: this.#legacy.master,
            ...(previous.numericPolicy === undefined ? {} : { numericPolicy: previous.numericPolicy }) });
        // Prepare and validate off to the side. Do not discard the old runtime on failure.
        effect.beginCostSelection(actor, { movement: command.expectedMovementRevision, progression: command.expectedProgressionRevision });
        const host = new EffectCommandHost(effect, previous.rules);
        ensureMove(this.#current(), "owner-legacy-conflict");
        this.#active = { effect, host, resolutionId, rules: previous.rules, numericPolicy: previous.numericPolicy };
        this.#used.add(resolutionId); this.#remember(); ok = true;
      } finally { this.#busy = false; }
    } catch { /* The current view is the only public diagnostic. */ }
    const code = ok ? "applied" : "operation_rejected";
    receipts.set(command.requestId, { fingerprint, ok, code });
    return respond(ok, code, command.requestId);
  }
  handleEffect(actor: Player, input: unknown): EffectCommandResponse | OwnerFailure {
    player(actor);
    if (!this.#active && this.#idle) {
      const view = this.effectViewFor(actor);
      if (view) return freezeMovement({ ok: false, code: "wrong_context", replayed: false, view });
    }
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
  switchTestTurn(actor: Player, input: unknown): EffectCommandResponse {
    player(actor);
    const respond = (ok: boolean, code: EffectCommandResponse["code"], requestId?: string, replayed = false): EffectCommandResponse => {
      const view = this.effectViewFor(actor); ensureMove(view !== null, "owner-unavailable");
      return freezeMovement({ ok, code, ...(requestId === undefined ? {} : { requestId }), replayed, view });
    };
    let command: TestTurnCommand;
    try {
      dataObject(input, ["kind", "matchId", "resolutionId", "requestId", "expectedMovementRevision", "expectedProgressionRevision"]);
      ensureMove(input.kind === "testNextTurn", "invalid-test-turn-command");
      id(input.matchId); id(input.resolutionId, 64); id(input.requestId);
      ensureMove(Number.isSafeInteger(input.expectedMovementRevision) && (input.expectedMovementRevision as number) >= 0 &&
        Number.isSafeInteger(input.expectedProgressionRevision) && (input.expectedProgressionRevision as number) >= 0, "invalid-test-turn-revision");
      command = { kind: "testNextTurn", matchId: input.matchId, resolutionId: input.resolutionId, requestId: input.requestId,
        expectedMovementRevision: input.expectedMovementRevision as number, expectedProgressionRevision: input.expectedProgressionRevision as number };
    } catch { return respond(false, "invalid_command"); }
    if (this.#busy) return respond(false, "busy", command.requestId);
    if (command.matchId !== this.snapshot().movement?.matchId) return respond(false, "wrong_context", command.requestId);
    const fingerprint = JSON.stringify(command), receipts = this.#sessionReceipts[actor], receipt = receipts.get(command.requestId);
    if (receipt) return receipt.fingerprint === fingerprint ? respond(receipt.ok, receipt.code, command.requestId, true) : respond(false, "request_conflict", command.requestId);
    if (receipts.size >= 1024) return respond(false, "request_limit", command.requestId);
    let ok = false;
    try {
      ensureMove(process.env.NODE_ENV !== "production" && this.#mode === "automated" && this.#current() && !this.#active && this.#idle?.allowTestTurnSwitch,
        "local-turn-disabled-or-busy");
      ensureMove(command.resolutionId === this.#idle.resolutionId && command.expectedMovementRevision === this.#board!.revision &&
        command.expectedProgressionRevision === this.#progression!.revision, "stale-local-turn");
      this.#busy = true;
      try {
        const next = nextLocalTurnCheckpoint(this.#board!, this.#progression!, actor, randomUUID()), resolutionId = randomUUID();
        ensureMove(this.#current(), "owner-legacy-conflict");
        this.#board = next.movement; this.#progression = next.progression; this.#idle = { ...this.#idle, resolutionId }; ok = true;
      } finally { this.#busy = false; }
    } catch { /* Return only the current public view, never internal diagnostics. */ }
    const code = ok ? "applied" : "operation_rejected";
    receipts.set(command.requestId, { fingerprint, ok, code });
    return respond(ok, code, command.requestId);
  }
  effectViewFor(viewer: Player): EffectTransportView | null {
    player(viewer);
    if (this.#busy || this.#mode !== "automated" || !this.#current()) return null;
    if (this.#active) return this.#active.host.viewFor(viewer);
    if (!this.#idle || !this.#board || !this.#progression) return null;
    const progression = this.#progression;
    return freezeMovement({ matchId: this.#board.matchId, localPlayerIndex: viewer, movement: projectMovementState(this.#board, viewer),
      testTurnSwitchAvailable: this.#idle.allowTestTurnSwitch && process.env.NODE_ENV !== "production" && checkTiming(progression, viewer, "endMain").allowed,
      effect: { resolutionId: this.#idle.resolutionId, actor: progression.activePlayer, status: "idle", completedSteps: 0, masterVersion: this.#legacy.master?.version ?? null },
      progression: { revision: progression.revision, turnNumber: progression.turnNumber, activePlayer: progression.activePlayer,
        phase: progression.phase, gate: progression.gate.kind, chooser: progression.gate.kind === "choice" ? progression.gate.chooser : null,
        finished: progression.outcome !== null, winner: progression.outcome?.winner ?? null }, selection: null });
  }
  releaseRegisteredEffect(cancelPrepared = false): void {
    if (!this.#idle || !this.#active) return;
    const status = this.#active.effect.view().status;
    if (status === "completed") this.finishEffect();
    else if (cancelPrepared && status === "prepared") this.discardPreparedEffect();
  }
  finishEffect(): void {
    ensureMove(!this.#busy && this.#mode === "automated" && this.#active !== null, "owner-no-active-effect");
    ensureMove(this.#current(), "owner-legacy-conflict");
    ensureMove(this.#active.effect.view().status === "completed" && this.#active.effect.snapshot().progression.gate.kind === "idle", "owner-effect-not-complete");
    this.#remember(); this.#active = null;
    if (this.#idle) this.#idle = { ...this.#idle, resolutionId: randomUUID() };
  }
  discardPreparedEffect(): void {
    ensureMove(!this.#busy && this.#mode === "automated" && this.#active !== null, "owner-no-active-effect");
    ensureMove(this.#current(), "owner-legacy-conflict");
    ensureMove(this.#active.effect.view().status === "prepared" && this.#active.effect.snapshot().progression.gate.kind === "idle", "owner-effect-already-started");
    this.#remember(); this.#active = null;
    if (this.#idle) this.#idle = { ...this.#idle, resolutionId: randomUUID() };
  }
  close(): void {
    ensureMove(!this.#busy, "owner-busy"); this.#remember(); this.#active = null; this.#mode = "closed";
  }
}
