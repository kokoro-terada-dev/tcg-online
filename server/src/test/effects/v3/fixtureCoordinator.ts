import { createHash } from "node:crypto";
import { MovementStore, visibleTo } from "../../movement/engine";
import { projectMovementState } from "../../movement/projection";
import { dataObject, ensureMove, freezeMovement, getCard, location, MovementError, validateMovementState } from "../../movement/state";
import type { MovementEvent, MovementOperation, MovementState, TransactionResult } from "../../movement/types";
import type { Progression } from "../../progression/types";
import { checkTiming } from "../../progression/state";
import { applySystemEvent } from "../../progression/transitions";
import type { MasterSnapshot } from "../../cardMaster";
import { pinMasterFacts, type PinnedMasterFacts } from "../masterFacts";
import type { ApprovedV3Card } from "./approval";
import { isApprovedV3Card } from "./approval";
import { label } from "./compiler";
import { fixtureEnvironment } from "./fixtureEnvironment";
import { V3ResolutionMachine, type ResolutionIdentity, type WorkRequest } from "./resolution";

export type FixtureContext = Readonly<{ frameRevision: number; movementRevision: number; progressionRevision: number }>;
type Receipt = { requestId: string; fingerprint: string };
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

// Isolated, server-only fixture. Never mounted on normal online/solo/test-room endpoints.
export class V3FixtureCoordinator {
  #board: MovementState; #progression: Progression; #machine: V3ResolutionMachine;
  #card: ApprovedV3Card; #identity: ResolutionIdentity; #key: Uint8Array; #facts: PinnedMasterFacts; #now: () => number;
  #receipts: Receipt[] = []; #busy = false;
  #events: readonly MovementEvent[] = [];
  constructor(options: Readonly<{ mode: "syntheticNoAbilities"; card: ApprovedV3Card; identity: ResolutionIdentity; movement: MovementState; progression: Progression; signingKey: Uint8Array; master: MasterSnapshot | null; now?: () => number }>) {
    ensureMove(process.env.NODE_ENV !== "production" && options.mode === "syntheticNoAbilities", "v3-fixture-disabled");
    ensureMove(isApprovedV3Card(options.card), "v3-approved-server-plan-required");
    validateMovementState(options.movement);
    const { identity, movement, progression, card } = options;
    ensureMove(identity.matchId === movement.matchId && movement.turnNumber === progression.turnNumber && checkTiming(progression, identity.actor, "mainEffect").allowed && !progression.battle, "v3-fixture-timing");
    ensureMove(Object.values(movement.cards).every(card => !card.modifierIds.length && !card.grantIds.length) && movement.players.every(zones => zones.deck.length > 0) && movement.reveals.length === 0, "v3-fixture-unmodeled-board");
    const source = getCard(movement, identity.source), at = location(movement, source.instanceId), effect = card.definition.effects.find(effect => effect.id === identity.effectId);
    ensureMove(effect && source.cardId === card.definition.cardId && source.kind === card.definition.cardType && source.owner === identity.actor && source.controller === identity.actor && source.faceUp && at.player === identity.actor && effect.sourceZones.some(zone => zone === at.zone), "v3-fixture-source");
    this.#board = freezeMovement(structuredClone(movement)); this.#progression = freezeMovement(structuredClone(progression));
    this.#identity = freezeMovement(structuredClone(identity)); this.#card = card; this.#key = Uint8Array.from(options.signingKey); this.#now = options.now ?? Date.now;
    this.#facts = pinMasterFacts(movement, { master: options.master, numericPolicy: "certifiedUnmodified" });
    this.#machine = new V3ResolutionMachine(card, this.#identity, this.#key, fixtureEnvironment(() => this.#board, this.#identity, card, this.#facts, this.#now));
    this.#progression = applySystemEvent(this.#progression, this.#progression.revision, { kind: "beginResolution", resolutionId: identity.resolutionId, controller: identity.actor });
  }
  context(): FixtureContext { return { frameRevision: this.#machine.viewFor(this.#identity.actor).revision, movementRevision: this.#board.revision, progressionRevision: this.#progression.revision }; }
  #gate(progression: Progression, machine: V3ResolutionMachine): Progression {
    const view = machine.viewFor(this.#identity.actor); let next = progression;
    if (next.gate.kind === "choice") {
      if (view.choice?.selectionId === next.gate.selectionId) return next;
      next = applySystemEvent(next, next.revision, { kind: "acceptChoice", resolutionId: this.#identity.resolutionId, selectionId: next.gate.selectionId, chooser: next.gate.chooser });
    }
    if (view.choice) return applySystemEvent(next, next.revision, { kind: "waitForChoice", resolutionId: this.#identity.resolutionId, selectionId: view.choice.selectionId, chooser: view.choice.chooser });
    if (view.status === "completed") return applySystemEvent(next, next.revision, { kind: "finishResolution", resolutionId: this.#identity.resolutionId });
    return next;
  }
  #run(actor: 0 | 1, requestId: string, expected: FixtureContext, body: object, action: (machine: V3ResolutionMachine, draft: { board: MovementState; events: MovementEvent[] }) => void): { replayed: boolean } {
    ensureMove(process.env.NODE_ENV !== "production" && !this.#busy, "v3-fixture-disabled-or-busy"); label(requestId);
    ensureMove(actor === 0 || actor === 1, "v3-fixture-actor"); dataObject(expected, ["frameRevision", "movementRevision", "progressionRevision"]);
    const fingerprint = hash(JSON.stringify([actor, expected.frameRevision, expected.movementRevision, expected.progressionRevision, body]));
    const receipt = this.#receipts.find(receipt => receipt.requestId === requestId);
    if (receipt) { ensureMove(receipt.fingerprint === fingerprint, "v3-fixture-request-conflict"); return { replayed: true }; }
    const current = this.context(); ensureMove(this.#receipts.length < 512 && current.frameRevision === expected.frameRevision && current.movementRevision === expected.movementRevision && current.progressionRevision === expected.progressionRevision, "v3-fixture-stale-or-limited");
    this.#busy = true;
    try {
      const draft = { board: this.#board, events: [...this.#events] };
      const environment = fixtureEnvironment(() => draft.board, this.#identity, this.#card, this.#facts, this.#now);
      const machine = V3ResolutionMachine.restore(this.#card, this.#identity, this.#key, environment, this.#machine.exportForStorage(), current.frameRevision);
      action(machine, draft); const progression = this.#gate(this.#progression, machine);
      // Retain all candidate changes only after frame, movement and progression succeeded.
      this.#board = draft.board; this.#progression = progression; this.#machine = machine; this.#events = freezeMovement(draft.events);
      this.#receipts.push({ requestId, fingerprint }); return { replayed: false };
    } finally { this.#busy = false; }
  }
  advance(actor: 0 | 1, requestId: string, expected: FixtureContext) {
    ensureMove(actor === this.#identity.actor, "v3-fixture-controller-only");
    return this.#run(actor, requestId, expected, { kind: "advance" }, machine => { machine.advance(requestId, expected.frameRevision); });
  }
  answer(actor: 0 | 1, requestId: string, expected: FixtureContext, selectionId: string, tokens: readonly string[]) {
    return this.#run(actor, requestId, expected, { kind: "answer", selectionId, tokens }, machine => { machine.answer(actor, requestId, expected.frameRevision, selectionId, tokens); });
  }
  applyPendingWork(actor: 0 | 1, requestId: string, expected: FixtureContext) {
    ensureMove(actor === this.#identity.actor, "v3-fixture-controller-only");
    return this.#run(actor, requestId, expected, { kind: "applyPendingWork" }, (machine, draft) => {
      const work = machine.workForCoordinator(); ensureMove(work, "v3-fixture-no-work");
      let candidate: TransactionResult;
      try { candidate = this.#applyWork(draft.board, work); }
      catch (error) {
        if (!(error instanceof MovementError)) throw error;
        machine.settleWork(requestId, expected.frameRevision, work.workId, "rejected", draft.board.revision); return;
      }
      draft.board = candidate.state; draft.events.push(...candidate.events);
      ensureMove(draft.events.length <= 512, "v3-fixture-event-limit");
      machine.settleWork(requestId, expected.frameRevision, work.workId, "applied", candidate.state.revision);
    });
  }
  #applyWork(board: MovementState, work: WorkRequest): TransactionResult {
    ensureMove(work.worldRevision === board.revision, "v3-fixture-stale-work");
    const actor = this.#identity.actor, operations: MovementOperation[] = [];
    if (work.type === "PAY_COSTS") {
      let amount = 0;
      for (const cost of work.costs) { ensureMove(cost.type === "REST_DON", "v3-fixture-unsupported-cost"); amount += cost.count; }
      ensureMove(Number.isSafeInteger(amount) && amount > 0 && amount <= 64 && board.players[actor].activeDon.length >= amount, "v3-fixture-unpayable");
      for (const id of board.players[actor].activeDon.slice(0, amount)) {
        const card = board.cards[id!]!; ensureMove(card.kind === "don" && card.owner === actor && card.controller === actor && !card.rotated, "v3-fixture-don-unavailable");
        operations.push({ kind: "setRest", card: { instanceId: card.instanceId, generation: card.generation }, rotated: true });
      }
    } else if (work.type === "DRAW") {
      // Deck-out timing is deliberately unimplemented in this isolated fixture.
      ensureMove(board.players[work.player].deck.length > work.count, "v3-fixture-deck-out-policy-unresolved");
      for (const id of board.players[work.player].deck.slice(0, work.count)) {
        const card = board.cards[id!]!;
        operations.push({ kind: "move", card: { instanceId: card.instanceId, generation: card.generation }, from: { player: work.player, zone: "deck" }, to: { player: work.player, zone: "hand", position: "append", faceUp: true, rotated: false }, cause: "EFFECT_MOVE" });
      }
    } else {
      const destination = work.destination, player = destination.owner === "SELF" ? actor : (1 - actor) as 0 | 1;
      ensureMove(work.cards.length > 0 && work.cards.length <= 50 && (destination.zone !== "deck" || work.cards.length === 1), "v3-fixture-move-count-or-order");
      for (const ref of work.cards) {
        const card = getCard(board, ref), from = location(board, card.instanceId);
        ensureMove(card.owner === player && ["character", "stage", "event"].includes(card.kind) && ["character", "stage", "trash", "public"].includes(from.zone) && card.faceUp && visibleTo(board, card, from, 0) && visibleTo(board, card, from, 1), "v3-fixture-illegal-move");
        operations.push({ kind: "move", card: ref, from, to: { player, zone: destination.zone, position: destination.position, faceUp: destination.faceUp, rotated: false }, cause: "EFFECT_MOVE" });
      }
    }
    return new MovementStore(board).commit({ transactionId: hash(`${board.matchId}:${work.workId}`), matchId: board.matchId, expectedRevision: board.revision,
      turnNumber: board.turnNumber, actor, effectController: actor, source: this.#identity.source, mode: work.type === "PAY_COSTS" ? "cost" : "effect", resolutionId: this.#identity.resolutionId, operations }, { status: "certifiedNone" });
  }
  viewFor(viewer: 0 | 1) {
    return freezeMovement({ frame: this.#machine.viewFor(viewer), movement: projectMovementState(this.#board, viewer), progression: {
      revision: this.#progression.revision, gate: this.#progression.gate.kind, chooser: this.#progression.gate.kind === "choice" ? this.#progression.gate.chooser : null } });
  }
  snapshotForCoordinator() {
    return freezeMovement({ movement: this.#board, progression: this.#progression, frame: this.#machine.exportForStorage(), receipts: structuredClone(this.#receipts), movementEvents: this.#events });
  }
  toJSON(): never { throw new Error("v3-fixture-server-only"); }
}
