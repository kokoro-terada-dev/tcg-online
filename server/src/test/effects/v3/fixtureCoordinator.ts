import { createHash } from "node:crypto";
import { MovementStore, visibleTo } from "../../movement/engine";
import { projectMovementState } from "../../movement/projection";
import { dataArray, dataObject, ensureMove, freezeMovement, getCard, location, MovementError, validateMovementState } from "../../movement/state";
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
import { addStatEffects, pruneStatEffects, validateStatEffects, type StatEffects } from "./statEffects";
import { addKeywordGrants, pruneKeywordGrants, validateKeywordGrants, type KeywordGrants } from "./keywordEffects";
import type { TriggerCause } from "./triggerScheduler";
import { deckOutOutcome } from "./ruleOutcomes";

export type FixtureContext = Readonly<{ frameRevision: number; movementRevision: number; progressionRevision: number }>;
type Receipt = { requestId: string; fingerprint: string };
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

// Isolated, server-only fixture. Never mounted on normal online/solo/test-room endpoints.
export class V3FixtureCoordinator {
  #board: MovementState; #progression: Progression; #machine: V3ResolutionMachine;
  #card: ApprovedV3Card; #identity: ResolutionIdentity; #key: Uint8Array; #facts: PinnedMasterFacts; #now: () => number;
  #definitions: readonly ApprovedV3Card[];
  #statEffects: StatEffects;
  #keywordGrants: KeywordGrants;
  #checkEvents: ((events: readonly MovementEvent[]) => void) | undefined;
  #receipts: Receipt[] = []; #busy = false;
  #events: readonly MovementEvent[] = [];
  constructor(options: Readonly<{ mode: "syntheticNoAbilities"; card: ApprovedV3Card; identity: ResolutionIdentity; movement: MovementState; progression: Progression; signingKey: Uint8Array; master: MasterSnapshot | null; now?: () => number; definitions?: readonly ApprovedV3Card[]; statEffects?: StatEffects; keywordGrants?: KeywordGrants; triggerCause?: TriggerCause; checkEvents?: (events: readonly MovementEvent[]) => void }>) {
    ensureMove(process.env.NODE_ENV !== "production" && options.mode === "syntheticNoAbilities", "v3-fixture-disabled");
    ensureMove(isApprovedV3Card(options.card), "v3-approved-server-plan-required");
    const definitions = options.definitions ?? [options.card]; dataArray(definitions, 128);
    ensureMove(definitions.every(card => isApprovedV3Card(card) && card.rulesetVersion === options.card.rulesetVersion && card.compilerVersion === options.card.compilerVersion && card.registryHash === options.card.registryHash) &&
      new Set(definitions.map(card => card.definition.cardId)).size === definitions.length && definitions.some(card => card.definitionHash === options.card.definitionHash), "v3-fixture-approved-definitions-required");
    this.#definitions = [...definitions];
    validateMovementState(options.movement);
    this.#statEffects = validateStatEffects(options.movement, options.statEffects ?? []);
    this.#keywordGrants = validateKeywordGrants(options.movement, options.keywordGrants ?? []);
    const { identity, movement, progression, card } = options;
    const trigger = options.triggerCause, battle = progression.battle;
    ensureMove([...this.#statEffects, ...this.#keywordGrants].every(effect => effect.battleId === undefined || effect.battleId === battle?.battleId), "v3-stale-battle-duration");
    const triggerTiming = trigger && progression.gate.kind === "idle" && progression.phase === "main" && progression.phaseSettled && !progression.outcome && (!battle || battle.step === "attack" || battle.step === "damage");
    ensureMove(identity.matchId === movement.matchId && movement.turnNumber === progression.turnNumber && (triggerTiming || checkTiming(progression, identity.actor, "mainEffect").allowed), "v3-fixture-timing");
    ensureMove(Object.values(movement.cards).every(card => !card.modifierIds.length && !card.grantIds.length) && movement.players.every(zones => zones.deck.length > 0) && movement.reveals.length === 0, "v3-fixture-unmodeled-board");
    const source = getCard(movement, identity.source), at = location(movement, source.instanceId), effect = card.definition.effects.find(effect => effect.id === identity.effectId);
    const sourceZone = trigger?.type === "ON_KO" ? trigger.event.from?.zone : at.zone;
    ensureMove(effect && source.cardId === card.definition.cardId && source.kind === card.definition.cardType && source.owner === identity.actor && source.controller === identity.actor && source.faceUp && at.player === identity.actor && effect.sourceZones.some(zone => zone === sourceZone), "v3-fixture-source");
    if (trigger) {
      ensureMove(effect.kind === "triggered" && effect.timing.type === trigger.type, "v3-fixture-trigger-type");
      if (trigger.type === "ON_PLAY") {
        const event = trigger.event;
        ensureMove(event.kind === "moved" && event.eventId === trigger.eventId && event.from && event.to && event.from.zone !== event.to.zone &&
          event.to.player === identity.actor && event.to.zone === at.zone && event.after?.instanceId === source.instanceId && event.after.generation === source.generation && event.after.cardId === source.cardId, "v3-fixture-entry-authorization");
      } else if (trigger.type === "ON_KO") {
        const event = trigger.event;
        ensureMove(event.kind === "moved" && event.eventId === trigger.eventId && event.isKO && ["BATTLE_KO", "EFFECT_KO"].includes(event.cause.kind) && event.from?.zone === "character" && event.to?.zone === "trash" &&
          at.zone === "trash" && event.to.player === identity.actor && event.before?.kind === "character" && event.before.faceUp && event.before.owner === identity.actor && event.before.controller === identity.actor &&
          event.after?.instanceId === source.instanceId && event.after.generation === source.generation && event.before.generation + 1 === source.generation && event.after.cardId === source.cardId && event.before.cardId === source.cardId, "v3-fixture-ko-authorization");
      } else ensureMove(battle?.step === "attack" && battle.battleId === trigger.battleId && battle.attacker === trigger.attacker && progression.turnNumber === trigger.turnNumber &&
        battle.source.instanceId === trigger.attackSource.instanceId && battle.source.generation === trigger.attackSource.generation &&
        (trigger.type === "ON_ATTACK" ? identity.actor === battle.attacker && source.instanceId === battle.source.instanceId && source.generation === battle.source.generation : identity.actor === battle.defender), "v3-fixture-attack-authorization");
    } else ensureMove(effect.kind === "activated" && effect.timing.type === "MAIN" && !battle, "v3-fixture-main-authorization");
    this.#checkEvents = options.checkEvents;
    this.#board = freezeMovement(structuredClone(movement)); this.#progression = freezeMovement(structuredClone(progression));
    this.#identity = freezeMovement(structuredClone(identity)); this.#card = card; this.#key = Uint8Array.from(options.signingKey); this.#now = options.now ?? Date.now;
    this.#facts = pinMasterFacts(movement, { master: options.master, numericPolicy: "certifiedUnmodified" });
    this.#machine = new V3ResolutionMachine(card, this.#identity, this.#key, fixtureEnvironment(() => this.#board, this.#identity, card, this.#facts, this.#now, this.#definitions, () => this.#statEffects, this.#progression.activePlayer));
    this.#progression = applySystemEvent(this.#progression, this.#progression.revision, { kind: "beginResolution", resolutionId: identity.resolutionId, controller: identity.actor });
  }
  context(): FixtureContext { return { frameRevision: this.#machine.viewFor(this.#identity.actor).revision, movementRevision: this.#board.revision, progressionRevision: this.#progression.revision }; }
  pendingWorkKind(): WorkRequest["type"] | null { return this.#machine.workForCoordinator()?.type ?? null; }
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
  #run(actor: 0 | 1, requestId: string, expected: FixtureContext, body: object, action: (machine: V3ResolutionMachine, draft: { board: MovementState; events: MovementEvent[]; statEffects: StatEffects; keywordGrants: KeywordGrants }) => void): { replayed: boolean } {
    ensureMove(process.env.NODE_ENV !== "production" && !this.#busy, "v3-fixture-disabled-or-busy"); label(requestId);
    ensureMove(actor === 0 || actor === 1, "v3-fixture-actor"); dataObject(expected, ["frameRevision", "movementRevision", "progressionRevision"]);
    const fingerprint = hash(JSON.stringify([actor, expected.frameRevision, expected.movementRevision, expected.progressionRevision, body]));
    const receipt = this.#receipts.find(receipt => receipt.requestId === requestId);
    if (receipt) { ensureMove(receipt.fingerprint === fingerprint, "v3-fixture-request-conflict"); return { replayed: true }; }
    const current = this.context(); ensureMove(this.#receipts.length < 512 && current.frameRevision === expected.frameRevision && current.movementRevision === expected.movementRevision && current.progressionRevision === expected.progressionRevision, "v3-fixture-stale-or-limited");
    this.#busy = true;
    try {
      const draft = { board: this.#board, events: [...this.#events], statEffects: this.#statEffects, keywordGrants: this.#keywordGrants };
      const environment = fixtureEnvironment(() => draft.board, this.#identity, this.#card, this.#facts, this.#now, this.#definitions, () => draft.statEffects, this.#progression.activePlayer);
      const machine = V3ResolutionMachine.restore(this.#card, this.#identity, this.#key, environment, this.#machine.exportForStorage(), current.frameRevision);
      action(machine, draft); let progression = this.#gate(this.#progression, machine);
      const outcome = deckOutOutcome(draft.board);
      if (outcome) progression = applySystemEvent(progression, progression.revision, { kind: "finishGame", winner: outcome.winner, reason: outcome.reason });
      this.#checkEvents?.(draft.events.slice(this.#events.length));
      // Retain all candidate changes only after frame, movement and progression succeeded.
      this.#board = draft.board; this.#progression = progression; this.#machine = machine; this.#events = freezeMovement(draft.events); this.#statEffects = draft.statEffects; this.#keywordGrants = draft.keywordGrants;
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
      let candidate: TransactionResult & { statEffects?: StatEffects; keywordGrants?: KeywordGrants };
      try { candidate = this.#applyWork(draft.board, work, draft.statEffects, draft.keywordGrants); }
      catch (error) {
        if (!(error instanceof MovementError)) throw error;
        machine.settleWork(requestId, expected.frameRevision, work.workId, "rejected", draft.board.revision); return;
      }
      draft.board = candidate.state; draft.events.push(...candidate.events);
      draft.statEffects = pruneStatEffects(candidate.state, candidate.statEffects ?? draft.statEffects);
      draft.keywordGrants = pruneKeywordGrants(candidate.state, candidate.keywordGrants ?? draft.keywordGrants);
      ensureMove(draft.events.length <= 512, "v3-fixture-event-limit");
      machine.settleWork(requestId, expected.frameRevision, work.workId, "applied", candidate.state.revision);
      if (deckOutOutcome(candidate.state)) machine.finishForGameOutcome(machine.viewFor(actor).revision, candidate.state.revision);
    });
  }
  #applyWork(board: MovementState, work: WorkRequest, statEffects: StatEffects, keywordGrants: KeywordGrants): TransactionResult & { statEffects?: StatEffects; keywordGrants?: KeywordGrants } {
    ensureMove(work.worldRevision === board.revision, "v3-fixture-stale-work");
    const actor = this.#identity.actor, operations: MovementOperation[] = [];
    const inspected = (ref: Readonly<{ instanceId: string; generation: number }>) => board.reveals.some(grant => grant.scopeId === this.#identity.resolutionId &&
      grant.card.instanceId === ref.instanceId && grant.card.generation === ref.generation && grant.viewers.includes(actor));
    if (work.type === "MODIFY_STAT" || work.type === "GRANT_KEYWORD") {
      const battleId = this.#progression.battle?.battleId ?? null;
      const next = work.type === "MODIFY_STAT" ? { statEffects: addStatEffects(board, statEffects, work.workId, this.#identity.source, actor, work.cards, work.stat, work.amount, work.duration, this.#definitions, battleId) } :
        { keywordGrants: addKeywordGrants(board, keywordGrants, work.workId, this.#identity.source, actor, work.cards, work.keyword, work.duration, this.#definitions, battleId) };
      const result = new MovementStore(board).commit({ transactionId: hash(`${board.matchId}:${work.workId}`), matchId: board.matchId, expectedRevision: board.revision,
        turnNumber: board.turnNumber, actor, effectController: actor, source: this.#identity.source, mode: "effect", resolutionId: this.#identity.resolutionId, operations: [] }, { status: "certifiedNone" });
      return { ...result, ...next };
    } else if (work.type === "PAY_COSTS") {
      let amount = 0, discardCount = 0, restSource = 0;
      const returnCosts = work.costs.filter(cost => cost.type === "DON_RETURN"), returnCost = returnCosts[0], returnCount = returnCost?.count ?? 0;
      ensureMove(returnCosts.length <= 1, "v3-fixture-multiple-don-return-costs");
      for (const cost of work.costs) {
        if (cost.type === "REST_DON") amount += cost.count;
        else if (cost.type === "DISCARD_HAND") discardCount += cost.count;
        else if (cost.type === "REST_SOURCE") restSource++;
        else if (cost.type === "DON_RETURN") continue;
        else ensureMove(false, "v3-fixture-unsupported-cost");
      }
      const returned = new Set(work.returned.map(ref => ref.instanceId));
      const activeDon = board.players[actor].activeDon.filter(id => !returned.has(id!));
      ensureMove(Number.isSafeInteger(amount + discardCount) && amount + discardCount + restSource + returnCount > 0 && amount + discardCount + restSource + returnCount <= 64 && restSource <= 1 && activeDon.length >= amount &&
        returned.size === returnCount && work.returned.length === returnCount &&
        work.discarded.length === discardCount && new Set(work.discarded.map(ref => ref.instanceId)).size === discardCount, "v3-fixture-unpayable");
      if (restSource) {
        const card = getCard(board, this.#identity.source), at = location(board, card.instanceId);
        ensureMove(!card.rotated && card.faceUp && card.owner === actor && card.controller === actor && at.player === actor &&
          ["leader", "character", "stage"].includes(at.zone) && card.kind === at.zone && visibleTo(board, card, at, 0) && visibleTo(board, card, at, 1), "v3-fixture-source-cost-unavailable");
        operations.push({ kind: "setRest", card: this.#identity.source, rotated: true });
      }
      for (const id of activeDon.slice(0, amount)) {
        const card = board.cards[id!]!; ensureMove(card.kind === "don" && card.owner === actor && card.controller === actor && !card.rotated, "v3-fixture-don-unavailable");
        operations.push({ kind: "setRest", card: { instanceId: card.instanceId, generation: card.generation }, rotated: true });
      }
      for (const ref of work.discarded) {
        const card = getCard(board, ref), from = location(board, card.instanceId);
        ensureMove(from.zone === "hand" && from.player === actor && card.owner === actor && card.controller === actor && ["character", "stage", "event"].includes(card.kind) && visibleTo(board, card, from, actor) && !visibleTo(board, card, from, (1 - actor) as 0 | 1), "v3-fixture-discard-cost-unavailable");
        operations.push({ kind: "move", card: ref, from, to: { player: actor, zone: "trash", position: "append", faceUp: true, rotated: false }, cause: "COST_PAYMENT" });
      }
      for (const ref of work.returned) {
        const card = getCard(board, ref), from = location(board, ref.instanceId);
        ensureMove(returnCost && returnCost.from.some(zone => zone === from.zone) && from.player === actor && card.kind === "don" && card.owner === actor && card.controller === actor && card.faceUp &&
          visibleTo(board, card, from, 0) && visibleTo(board, card, from, 1), "v3-fixture-return-cost-unavailable");
        operations.push({ kind: "move", card: ref, from, to: { player: actor, zone: "donDeck", position: "bottom", faceUp: false, rotated: false }, cause: "COST_PAYMENT" });
      }
    } else if (work.type === "LOOK_TOP") {
      ensureMove(work.cards.length > 0 && work.cards.length <= 50 && work.cards.every((ref, index) => board.players[actor].deck[index] === ref.instanceId), "v3-fixture-look-top-only");
      for (const ref of work.cards) {
        const card = getCard(board, ref), from = location(board, card.instanceId);
        ensureMove(from.player === actor && from.zone === "deck" && card.owner === actor && card.controller === actor && ["character", "stage", "event"].includes(card.kind), "v3-fixture-look-owner-or-kind");
        const opponent = (1 - actor) as 0 | 1;
        const alreadyPublic = board.reveals.some(grant => grant.scopeId === this.#identity.resolutionId && grant.card.instanceId === ref.instanceId && grant.card.generation === ref.generation && grant.viewers.includes(opponent));
        operations.push({ kind: "reveal", card: ref, scopeId: this.#identity.resolutionId, viewers: alreadyPublic ? [0, 1] : [actor] });
      }
    } else if (work.type === "REVEAL") {
      ensureMove(work.cards.length > 0 && work.cards.length <= 50, "v3-fixture-reveal-count");
      for (const ref of work.cards) {
        const card = getCard(board, ref), from = location(board, card.instanceId);
        ensureMove(from.player === actor && card.owner === actor && card.controller === actor && ["character", "stage", "event"].includes(card.kind) &&
          (from.zone === "hand" || from.zone === "deck" && inspected(ref)) && visibleTo(board, card, from, actor), "v3-fixture-reveal-uninspected-card");
        operations.push({ kind: "reveal", card: ref, scopeId: this.#identity.resolutionId, viewers: [0, 1] });
      }
    } else if (work.type === "RETURN_TO_DECK") {
      ensureMove(work.cards.length > 0 && work.cards.length <= 50 && new Set(work.cards.map(ref => ref.instanceId)).size === work.cards.length, "v3-fixture-return-deck-count");
      for (const ref of work.cards) {
        const card = getCard(board, ref), from = location(board, card.instanceId);
        ensureMove(from.player === actor && from.zone === "deck" && card.owner === actor && card.controller === actor && inspected(ref), "v3-fixture-return-uninspected-card");
      }
      const selected = new Set(work.cards.map(ref => ref.instanceId)), rest = board.players[actor].deck.filter(id => !selected.has(id!));
      const ordered = work.cards.map(ref => ref.instanceId), all = work.position === "top" ? [...ordered, ...rest] : [...rest, ...ordered];
      operations.push({ kind: "reorder", location: { player: actor, zone: "deck" }, cards: all.map(id => ({ instanceId: id!, generation: board.cards[id!]!.generation })), conceal: false });
    } else if (work.type === "CLOSE_REVEALS") {
      operations.push({ kind: "closeReveals", scopeId: this.#identity.resolutionId });
    } else if (work.type === "DRAW") {
      for (const id of board.players[work.player].deck.slice(0, work.count)) {
        const card = board.cards[id!]!;
        operations.push({ kind: "move", card: { instanceId: card.instanceId, generation: card.generation }, from: { player: work.player, zone: "deck" }, to: { player: work.player, zone: "hand", position: "append", faceUp: true, rotated: false }, cause: "EFFECT_MOVE" });
      }
    } else if (work.type === "MOVE_CARD") {
      const destination = work.destination, player = destination.owner === "SELF" ? actor : (1 - actor) as 0 | 1;
      ensureMove(work.cards.length > 0 && work.cards.length <= 50 && (destination.zone !== "deck" || work.cards.length === 1), "v3-fixture-move-count-or-order");
      for (const ref of work.cards) {
        const card = getCard(board, ref), from = location(board, card.instanceId);
        const publicSource = ["character", "stage", "trash", "public"].includes(from.zone) && card.faceUp && visibleTo(board, card, from, 0) && visibleTo(board, card, from, 1);
        const ownHand = from.zone === "hand" && from.player === actor && card.owner === actor && card.controller === actor && visibleTo(board, card, from, actor);
        const lookedDeck = from.zone === "deck" && from.player === actor && card.owner === actor && card.controller === actor && inspected(ref) && visibleTo(board, card, from, actor);
        ensureMove(!lookedDeck || destination.zone !== "deck", "v3-fixture-deck-order-command-required");
        ensureMove(card.owner === player && ["character", "stage", "event"].includes(card.kind) && (publicSource || ownHand || lookedDeck), "v3-fixture-illegal-move");
        operations.push({ kind: "move", card: ref, from, to: { player, zone: destination.zone, position: destination.position, faceUp: destination.faceUp, rotated: false }, cause: "EFFECT_MOVE" });
      }
    } else {
      ensureMove(work.cards.length > 0 && work.cards.length <= 50, "v3-fixture-field-action-count");
      for (const ref of work.cards) {
        const card = getCard(board, ref), from = location(board, card.instanceId);
        ensureMove(card.faceUp && visibleTo(board, card, from, 0) && visibleTo(board, card, from, 1), "v3-fixture-field-action-visibility");
        if (work.type === "KO") {
          ensureMove(card.kind === "character" && from.zone === "character", "v3-fixture-ko-character-only");
          operations.push({ kind: "move", card: ref, from, to: { player: card.owner, zone: "trash", position: "append", faceUp: true, rotated: false }, cause: "EFFECT_KO" });
        } else {
          ensureMove(["REST", "SET_ACTIVE"].includes(work.type) && ["leader", "character", "stage"].includes(from.zone) && card.kind === from.zone, "v3-fixture-rest-field-only");
          operations.push({ kind: "setRest", card: ref, rotated: work.type === "REST" });
        }
      }
    }
    const endsGame = ([0, 1] as const).some(player => {
      const leaving = operations.filter(operation => operation.kind === "move" && operation.from.player === player && operation.from.zone === "deck" && (operation.to.player !== player || operation.to.zone !== "deck")).length;
      const entering = operations.filter(operation => operation.kind === "move" && operation.to.player === player && operation.to.zone === "deck" && (operation.from.player !== player || operation.from.zone !== "deck")).length;
      return board.players[player].deck.length - leaving + entering === 0;
    });
    if (endsGame) operations.push({ kind: "closeReveals", scopeId: this.#identity.resolutionId });
    return new MovementStore(board).commit({ transactionId: hash(`${board.matchId}:${work.workId}`), matchId: board.matchId, expectedRevision: board.revision,
      turnNumber: board.turnNumber, actor, effectController: actor, source: this.#identity.source, mode: work.type === "PAY_COSTS" ? "cost" : "effect", resolutionId: this.#identity.resolutionId, operations }, { status: "certifiedNone" });
  }
  viewFor(viewer: 0 | 1) {
    return freezeMovement({ frame: this.#machine.viewFor(viewer), movement: projectMovementState(this.#board, viewer), outcome: this.#progression.outcome, progression: {
      revision: this.#progression.revision, gate: this.#progression.gate.kind, chooser: this.#progression.gate.kind === "choice" ? this.#progression.gate.chooser : null } });
  }
  snapshotForCoordinator() {
    return freezeMovement({ movement: this.#board, progression: this.#progression, frame: this.#machine.exportForStorage(), receipts: structuredClone(this.#receipts), movementEvents: this.#events, statEffects: this.#statEffects, keywordGrants: this.#keywordGrants });
  }
  toJSON(): never { throw new Error("v3-fixture-server-only"); }
}
