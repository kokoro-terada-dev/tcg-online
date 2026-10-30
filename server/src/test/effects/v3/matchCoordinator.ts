import { createHash, createHmac, randomUUID } from "node:crypto";
import type { MasterSnapshot } from "../../cardMaster";
import type { CardObjectRef } from "../types";
import type { MovementEvent, MovementOperation, MovementState } from "../../movement/types";
import { MovementStore, visibleTo } from "../../movement/engine";
import { projectV3Movement } from "./projection";
import { dataArray, dataObject, ensureMove, freezeMovement, getCard, location, reference, validateMovementState } from "../../movement/state";
import type { Progression } from "../../progression/types";
import { checkTiming, phaseWork } from "../../progression/state";
import { applyPlayerIntent, applySystemEvent } from "../../progression/transitions";
import { isApprovedV3Card, type ApprovedV3Card } from "./approval";
import { label } from "./compiler";
import { V3FixtureCoordinator } from "./fixtureCoordinator";
import { endTurnStatEffects, pruneStatEffects, retainBattleStatEffects, statDelta, type StatEffects } from "./statEffects";
import { availableTriggers, enqueueAttackTriggers, enqueueMovementTriggers, movementTriggerCandidates, triggerChooser, SYNTHETIC_TRIGGER_POLICY, type ScheduledTrigger } from "./triggerScheduler";
import { decideLocalBattle } from "../../localBattle";
import { attackOptions, declareAttack, finishAttackStep, finishCounterStep, finishDamageStep, blockerOptions, declareBlock, battlePower, counterCandidates, useCounter, damage, takeLife, V3_BASE_BATTLE_RULES, type BattleCounters, type LifeDecision } from "./battle";
import { effectiveKeywords, endTurnKeywordGrants, pruneKeywordGrants, retainBattleKeywordGrants, type KeywordGrants } from "./keywordEffects";
import { deckOutOutcome, DECK_OUT_POLICY } from "./ruleOutcomes";
import { counterEventChoices, prepareCounterEvent } from "./counterEvents";
import { prepareLifeTrigger } from "./lifeTriggers";
import { isReviewedV3Catalog, type ReviewedV3Catalog } from "./reviewedCatalog";
import { pinMasterFacts } from "../masterFacts";
import { fixtureEnvironment } from "./fixtureEnvironment";

type Seat = 0 | 1;
export type V3MatchContext = Readonly<{ revision: number; movementRevision: number; progressionRevision: number; resolutionId: string | null; frameRevision: number | null }>;
type Active = { coordinator: V3FixtureCoordinator; actor: Seat; cardId: string; effectId: string; source: Readonly<CardObjectRef>; resolutionId: string; usageKey: string; counted: boolean; eventCount: number; triggerEventId: string | null };
type History = Readonly<{ turnNumber: number; actor: Seat; cardId: string; effectId: string; resolutionId: string; committed: boolean; declined: boolean; triggerEventId: string | null }>;
type Receipt = { requestId: string; fingerprint: string };
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

// Isolated development kernel. Reviewed mode also requires a server-loaded catalog brand.
export class V3SyntheticMatchCoordinator {
  #board: MovementState; #progression: Progression; #cards = new Map<string, ApprovedV3Card>();
  #usage = new Map<string, number>();
  #active: Active | null = null; #history: History[] = []; #receipts: Receipt[] = [];
  #ruleEvents: readonly MovementEvent[] = [];
  #statEffects: StatEffects = [];
  #keywordGrants: KeywordGrants = [];
  #triggers: readonly ScheduledTrigger[] = [];
  #battleCounters: BattleCounters = []; #lifeDecision: LifeDecision | null = null;
  #damageSettling = false;
  #reviewed: boolean;
  #revision = 0; #busy = false; #key: Uint8Array; #master: MasterSnapshot | null; #now: () => number;
  constructor(options: Readonly<{ mode: "syntheticNoAbilities" | "reviewedLimited"; movement: MovementState; progression: Progression; cards: readonly ApprovedV3Card[];
    signingKey: Uint8Array; master: MasterSnapshot | null; now?: () => number; reviewed?: ReviewedV3Catalog }>) {
    ensureMove(process.env.NODE_ENV !== "production" && (options.mode === "syntheticNoAbilities" || options.mode === "reviewedLimited"), "v3-match-disabled");
    dataObject(options, ["mode", "movement", "progression", "cards", "signingKey", "master"], ["now", "reviewed"]);
    this.#reviewed = options.mode === "reviewedLimited";
    ensureMove(this.#reviewed ? isReviewedV3Catalog(options.reviewed) : options.reviewed === undefined, "v3-match-reviewed-catalog-required");
    ensureMove(!Object.hasOwn(options, "now") || typeof options.now === "function", "v3-match-invalid-clock");
    validateMovementState(options.movement); dataArray(options.cards, 128);
    ensureMove(options.signingKey instanceof Uint8Array && options.signingKey.length >= 32 && options.signingKey.length <= 128, "v3-signing-key-required");
    ensureMove(options.progression.gate.kind === "idle" && !options.progression.battle && !options.progression.outcome &&
      options.movement.turnNumber === options.progression.turnNumber && checkTiming(options.progression, options.progression.activePlayer, "mainEffect").allowed, "v3-match-main-required");
    ensureMove(Object.values(options.movement.cards).every(card => !card.modifierIds.length && !card.grantIds.length) && options.movement.reveals.length === 0 && options.movement.players.every(zones => zones.resolving.length === 0), "v3-match-unmodeled-board");
    for (const card of options.cards) {
      ensureMove(isApprovedV3Card(card) && !this.#cards.has(card.definition.cardId), "v3-match-approved-card-required"); this.#cards.set(card.definition.cardId, card);
      if (this.#reviewed) ensureMove(options.reviewed!.catalog.get(card.definition.cardId) === card, "v3-match-reviewed-card-mismatch");
    }
    if (this.#reviewed) ensureMove(Object.values(options.movement.cards).every(card => card.kind === "don" || this.#cards.get(card.cardId)?.definition.cardType === card.kind), "v3-match-unreviewed-board-card");
    this.#board = freezeMovement(structuredClone(options.movement)); this.#progression = freezeMovement(structuredClone(options.progression));
    this.#key = Uint8Array.from(options.signingKey); this.#master = options.master; this.#now = options.now ?? Date.now;
  }
  context(): V3MatchContext {
    const frame = this.#active?.coordinator.viewFor(this.#active.actor).frame;
    return { revision: this.#revision, movementRevision: this.#board.revision, progressionRevision: this.#progression.revision,
      resolutionId: frame?.resolutionId ?? null, frameRevision: frame?.revision ?? null };
  }
  pendingWorkKind() { return this.#active?.coordinator.pendingWorkKind() ?? null; }
  #run(actor: Seat, requestId: string, expected: V3MatchContext, body: object, apply: () => void): { replayed: boolean } {
    ensureMove(process.env.NODE_ENV !== "production" && !this.#busy && (actor === 0 || actor === 1), "v3-match-disabled-or-invalid-actor"); label(requestId);
    dataObject(expected, ["revision", "movementRevision", "progressionRevision", "resolutionId", "frameRevision"]);
    const fingerprint = hash(JSON.stringify([actor, expected.revision, expected.movementRevision, expected.progressionRevision, expected.resolutionId, expected.frameRevision, body]));
    const receipt = this.#receipts.find(receipt => receipt.requestId === requestId);
    if (receipt) { ensureMove(receipt.fingerprint === fingerprint, "v3-match-request-conflict"); return { replayed: true }; }
    const current = this.context();
    ensureMove(this.#receipts.length < 2048 && this.#revision < Number.MAX_SAFE_INTEGER && (Object.keys(current) as (keyof V3MatchContext)[]).every(key => current[key] === expected[key]), "v3-match-stale-or-limited");
    this.#busy = true;
    try {
      apply();
      const battleId = this.#progression.outcome ? null : this.#progression.battle?.battleId ?? null;
      this.#statEffects = retainBattleStatEffects(this.#statEffects, battleId);
      this.#keywordGrants = retainBattleKeywordGrants(this.#keywordGrants, battleId);
      this.#revision++; this.#receipts.push({ requestId, fingerprint }); return { replayed: false };
    }
    finally { this.#busy = false; }
  }
  #settled(allowTriggers = false, allowBattleTriggers = false): void {
    ensureMove(!this.#active || this.#active.coordinator.viewFor(this.#active.actor).frame.status === "completed", "v3-match-resolution-pending");
    ensureMove(this.#progression.gate.kind === "idle" && (!this.#progression.battle || allowBattleTriggers && (this.#progression.battle.step === "attack" || this.#progression.battle.step === "counter" || this.#damageSettling && this.#progression.battle.step === "damage")) && !this.#progression.outcome, "v3-match-not-idle");
    ensureMove(allowTriggers || !this.#triggers.length, "v3-match-triggers-pending");
  }
  #checkNewEvents = (events: readonly MovementEvent[]): void => {
    ensureMove(this.#triggers.length + movementTriggerCandidates(events, this.#cards).length <= 128, "v3-trigger-queue-limit");
  };
  #archive(): void {
    if (!this.#active) return;
    const frame = this.#active.coordinator.viewFor(this.#active.actor).frame;
    this.#history.push(freezeMovement({ turnNumber: this.#board.turnNumber, actor: this.#active.actor, cardId: this.#active.cardId, effectId: this.#active.effectId,
      resolutionId: frame.resolutionId, committed: frame.activationCommitted, declined: frame.activationDecision === "declined", triggerEventId: this.#active.triggerEventId }));
    this.#active = null;
  }
  activate(actor: Seat, requestId: string, expected: V3MatchContext, source: Readonly<CardObjectRef>, effectId: string) {
    reference(source); label(effectId);
    return this.#run(actor, requestId, expected, { kind: "activate", source: { instanceId: source.instanceId, generation: source.generation }, effectId }, () => this.#startMain(actor, source, effectId, false));
  }
  activateMain(actor: Seat, requestId: string, expected: V3MatchContext, sourceToken: string, effectId: string) {
    label(sourceToken); label(effectId);
    return this.#run(actor, requestId, expected, { kind: "activateMain", sourceToken, effectId }, () => {
      const choice = this.mainEffectsFor(actor).find(entry => entry.sourceToken === sourceToken && entry.effectId === effectId && entry.enabled);
      ensureMove(choice, "v3-main-source-token-unavailable");
      this.#startMain(actor, choice.source, effectId, true);
    });
  }
  #startMain(actor: Seat, source: Readonly<CardObjectRef>, effectId: string, preflight: boolean): void {
    this.#settled(); ensureMove(this.#history.length < 256 && checkTiming(this.#progression, actor, "mainEffect").allowed, "v3-match-cannot-activate");
    const object = getCard(this.#board, source), card = this.#cards.get(object.cardId), effect = card?.definition.effects.find(effect => effect.id === effectId);
    const at = location(this.#board, object.instanceId);
    ensureMove(card && card.definition.cardType === object.kind && ["leader", "character", "stage"].includes(at.zone) && object.kind === at.zone &&
      at.player === actor && object.owner === actor && object.controller === actor && object.faceUp && visibleTo(this.#board, object, at, 0) && visibleTo(this.#board, object, at, 1), "v3-main-source-policy");
    ensureMove(card && effect && effect.kind === "activated" && effect.timing.type === "MAIN", "v3-match-unregistered-effect"); const limit = effect.usageLimit?.count ?? null;
    ensureMove(effect.sourceZones.some(zone => zone === at.zone), "v3-main-source-zone");
    if (this.#reviewed || preflight) ensureMove(this.#canStartMainEffect(actor, source, card, effectId), "v3-reviewed-activation-unavailable");
    const usageKey = JSON.stringify([this.#board.turnNumber, actor, source.instanceId, source.generation, effectId]);
    ensureMove(limit === null || (this.#usage.get(usageKey) ?? 0) < limit, "v3-match-usage-exhausted");
    const resolutionId = randomUUID(), coordinator = new V3FixtureCoordinator({ mode: "syntheticNoAbilities", card,
      identity: { matchId: this.#board.matchId, resolutionId, effectId, actor, source }, movement: this.#board, progression: this.#progression,
      signingKey: this.#key, master: this.#master, now: this.#now, definitions: [...this.#cards.values()], statEffects: this.#statEffects, keywordGrants: this.#keywordGrants, checkEvents: this.#checkNewEvents });
    this.#archive(); this.#active = { coordinator, actor, cardId: object.cardId, effectId, source: { ...source }, resolutionId, usageKey, counted: false, eventCount: 0, triggerEventId: null };
    this.#progression = coordinator.snapshotForCoordinator().progression;
  }
  resolveTrigger(actor: Seat, requestId: string, expected: V3MatchContext, token: string) {
    label(token);
    return this.#run(actor, requestId, expected, { kind: "trigger", token }, () => {
      this.#settled(true, true); ensureMove(this.#history.length < 256 && triggerChooser(this.#triggers, this.#progression.activePlayer) === actor, "v3-trigger-wrong-controller-or-limit");
      const pending = availableTriggers(this.#triggers, this.#progression.activePlayer).find(entry => entry.token === token && entry.actor === actor);
      ensureMove(pending, "v3-trigger-not-pending");
      const card = this.#cards.get(pending.cardId)!;
      const source = { ...pending.source }, effectId = pending.effectId;
      const effect = card.definition.effects.find(effect => effect.id === effectId)!;
      const usageKey = JSON.stringify([this.#board.turnNumber, actor, source.instanceId, source.generation, effectId]);
      ensureMove(effect.usageLimit === null || (this.#usage.get(usageKey) ?? 0) < effect.usageLimit.count, "v3-match-usage-exhausted");
      const resolutionId = randomUUID(), coordinator = new V3FixtureCoordinator({ mode: "syntheticNoAbilities", card,
        identity: { matchId: this.#board.matchId, resolutionId, effectId, actor, source }, movement: this.#board, progression: this.#progression,
        signingKey: this.#key, master: this.#master, now: this.#now, definitions: [...this.#cards.values()], statEffects: this.#statEffects, keywordGrants: this.#keywordGrants,
        triggerCause: pending.cause, battleCounters: this.#battleCounters, checkEvents: this.#checkNewEvents });
      this.#archive(); this.#triggers = this.#triggers.filter(entry => entry.token !== token);
      this.#active = { coordinator, actor, cardId: pending.cardId, effectId, source, resolutionId, usageKey, counted: false, eventCount: 0, triggerEventId: pending.cause.eventId };
      this.#progression = coordinator.snapshotForCoordinator().progression;
    });
  }
  #control(actor: Seat, requestId: string, expected: V3MatchContext, body: object, action: (coordinator: V3FixtureCoordinator) => void) {
    return this.#run(actor, requestId, expected, body, () => {
      ensureMove(this.#active, "v3-match-no-resolution"); const active = this.#active;
      action(active.coordinator); const snapshot = active.coordinator.snapshotForCoordinator(), frame = active.coordinator.viewFor(active.actor).frame;
      const triggers = enqueueMovementTriggers(snapshot.movementEvents.slice(active.eventCount), this.#cards);
      this.#triggers = freezeMovement([...this.#triggers, ...triggers]); active.eventCount = snapshot.movementEvents.length;
      this.#board = snapshot.movement; this.#progression = snapshot.progression; this.#statEffects = snapshot.statEffects; this.#keywordGrants = snapshot.keywordGrants;
      if (frame.activationCommitted && !active.counted) {
        this.#usage.set(active.usageKey, (this.#usage.get(active.usageKey) ?? 0) + 1); active.counted = true;
      }
      if (this.#progression.outcome) {
        this.#triggers = []; this.#battleCounters = []; this.#lifeDecision = null; this.#damageSettling = false; return;
      }
      if (frame.status === "completed" && !this.#triggers.length && (this.#progression.battle?.step === "attack" || this.#damageSettling)) {
        const progression = this.#damageSettling ? finishDamageStep(this.#progression) : finishAttackStep(this.#board, this.#progression);
        this.#archive(); this.#progression = progression; this.#damageSettling = false; if (!progression.battle) this.#battleCounters = [];
      }
      if (frame.status === "completed" && !this.#triggers.length && this.#progression.battle?.step === "counter") this.#archive();
    });
  }
  advance(actor: Seat, requestId: string, expected: V3MatchContext) {
    return this.#control(actor, requestId, expected, { kind: "advance" }, coordinator => { coordinator.advance(actor, requestId, coordinator.context()); });
  }
  answer(actor: Seat, requestId: string, expected: V3MatchContext, selectionId: string, tokens: readonly string[]) {
    return this.#control(actor, requestId, expected, { kind: "answer", selectionId, tokens }, coordinator => { coordinator.answer(actor, requestId, coordinator.context(), selectionId, tokens); });
  }
  applyPendingWork(actor: Seat, requestId: string, expected: V3MatchContext) {
    return this.#control(actor, requestId, expected, { kind: "work" }, coordinator => { coordinator.applyPendingWork(actor, requestId, coordinator.context()); });
  }
  playCard(actor: Seat, requestId: string, expected: V3MatchContext, cardRef: Readonly<CardObjectRef>, slotIndex?: number) {
    reference(cardRef);
    return this.#run(actor, requestId, expected, { kind: "play", card: { instanceId: cardRef.instanceId, generation: cardRef.generation }, slotIndex: slotIndex ?? null }, () => {
      this.#settled(); ensureMove(this.#history.length < 256 && checkTiming(this.#progression, actor, "playCard").allowed, "v3-match-cannot-play");
      const object = getCard(this.#board, cardRef), at = location(this.#board, object.instanceId), card = this.#cards.get(object.cardId);
      ensureMove(at.player === actor && at.zone === "hand" && object.owner === actor && object.controller === actor && card &&
        (card.definition.cardType === "character" || card.definition.cardType === "stage") && object.kind === card.definition.cardType, "v3-match-unregistered-play");
      const zone = card.definition.cardType, cost = card.definition.baseStats.cost;
      ensureMove(cost !== null && Number.isSafeInteger(cost) && cost >= 0 && this.#board.players[actor].activeDon.length >= cost, "v3-match-play-cost-unavailable");
      const slot = slotIndex === undefined ? this.#board.players[actor][zone].indexOf(null) : slotIndex;
      ensureMove(Number.isSafeInteger(slot) && slot >= 0 && slot < this.#board.players[actor][zone].length && this.#board.players[actor][zone][slot] === null, "v3-match-no-play-slot");
      let candidate = this.#board; const events: MovementEvent[] = [];
      const transactionId = hash(`${this.#board.matchId}:${requestId}:play`), resolutionId = `play:${transactionId.slice(0, 40)}`;
      if (cost > 0) {
        const operations: MovementOperation[] = candidate.players[actor].activeDon.slice(0, cost).map(id => ({ kind: "setRest", card: { instanceId: id!, generation: candidate.cards[id!]!.generation }, rotated: true }));
        const payment = new MovementStore(candidate).commit({ transactionId: hash(`${transactionId}:cost`), matchId: candidate.matchId, expectedRevision: candidate.revision,
          turnNumber: candidate.turnNumber, actor, effectController: null, source: cardRef, mode: "cost", resolutionId, operations }, { status: "certifiedNone" });
        candidate = payment.state; events.push(...payment.events);
      }
      const played = new MovementStore(candidate).commit({ transactionId, matchId: candidate.matchId, expectedRevision: candidate.revision, turnNumber: candidate.turnNumber,
        actor, effectController: null, source: cardRef, mode: "rule", resolutionId: null, operations: [{ kind: "move", card: cardRef, from: at,
          to: { player: actor, zone, position: "slot", slotIndex: slot, faceUp: true, rotated: false }, cause: "RULE_PROCESSING" }] }, { status: "certifiedNone" });
      events.push(...played.events); ensureMove(this.#ruleEvents.length + events.length <= 512, "v3-match-rule-event-limit");
      this.#checkNewEvents(events); const triggers = enqueueMovementTriggers(events, this.#cards);
      this.#archive(); this.#board = played.state; this.#ruleEvents = freezeMovement([...this.#ruleEvents, ...events]); this.#statEffects = pruneStatEffects(this.#board, this.#statEffects);
      this.#keywordGrants = pruneKeywordGrants(this.#board, this.#keywordGrants);
      this.#triggers = freezeMovement([...this.#triggers, ...triggers]);
    });
  }
  playableCardsFor(actor: Seat) {
    ensureMove(actor === 0 || actor === 1, "v3-match-actor");
    const ready = !this.#triggers.length && (!this.#active || this.#active.coordinator.viewFor(actor).frame.status === "completed") && checkTiming(this.#progression, actor, "playCard").allowed;
    return this.#board.players[actor].hand.flatMap(id => {
      const object = this.#board.cards[id!]!, card = this.#cards.get(object.cardId);
      if (!card || !["character", "stage"].includes(card.definition.cardType) || object.kind !== card.definition.cardType) return [];
      const zone = card.definition.cardType as "character" | "stage", cost = card.definition.baseStats.cost, slot = this.#board.players[actor][zone].indexOf(null);
      return [{ card: { instanceId: object.instanceId, generation: object.generation }, cardId: object.cardId, cost, zone, slotIndex: slot,
        enabled: ready && object.owner === actor && object.controller === actor && slot >= 0 && cost !== null && this.#board.players[actor].activeDon.length >= cost }];
    });
  }
  attackChoicesFor(actor: Seat) {
    if (this.#triggers.length || this.#lifeDecision || this.#active && this.#active.coordinator.viewFor(actor).frame.status !== "completed") return { sources: [], targets: [], pairs: [] };
    return attackOptions(this.#board, this.#progression, actor, this.#cards, this.#keywordGrants);
  }
  attack(actor: Seat, requestId: string, expected: V3MatchContext, source: Readonly<CardObjectRef>, target: Readonly<CardObjectRef>) {
    reference(source); reference(target);
    return this.#run(actor, requestId, expected, { kind: "attack", source: { ...source }, target: { ...target } }, () => {
      this.#settled(); ensureMove(this.#history.length < 256, "v3-match-history-limit");
      const choices = this.attackChoicesFor(actor), includes = (rows: typeof choices.sources, ref: Readonly<CardObjectRef>) => rows.some(row => row.card.instanceId === ref.instanceId && row.card.generation === ref.generation);
      ensureMove(includes(choices.sources, source) && includes(choices.targets, target), "v3-battle-attack-unavailable");
      const result = declareAttack(this.#board, this.#progression, actor, source, target, this.#cards, this.#keywordGrants, randomUUID(), hash(`${this.#board.matchId}:${requestId}:attack`), true);
      const triggers = enqueueAttackTriggers(result.movement, result.progression, this.#cards); ensureMove(triggers.length <= 128 && this.#ruleEvents.length + result.events.length <= 512, "v3-match-attack-event-limit");
      const progression = triggers.length ? result.progression : finishAttackStep(result.movement, result.progression);
      this.#archive(); this.#board = result.movement; this.#progression = progression; this.#battleCounters = []; this.#triggers = freezeMovement(triggers); this.#ruleEvents = freezeMovement([...this.#ruleEvents, ...result.events]);
    });
  }
  attachDon(actor: Seat, requestId: string, expected: V3MatchContext, target: Readonly<CardObjectRef>, count: number) {
    reference(target);
    return this.#run(actor, requestId, expected, { kind: "attachDon", target: { ...target }, count }, () => {
      this.#settled(); ensureMove(checkTiming(this.#progression, actor, "attachDon").allowed && Number.isSafeInteger(count) && count >= 1 && count <= 10 && this.#board.players[actor].activeDon.length >= count, "v3-don-attachment-unavailable");
      const object = getCard(this.#board, target), definition = this.#cards.get(object.cardId)?.definition;
      ensureMove(definition && definition.cardType === object.kind && definition.baseStats.power !== null, "v3-don-attachment-unregistered-target");
      const existing = this.#board.players[actor].attachedDon.filter(id => { const parent = this.#board.cards[id!]!.attachedTo; return parent?.instanceId === target.instanceId && parent.generation === target.generation; }).length;
      ensureMove(Number.isSafeInteger(definition.baseStats.power + statDelta(this.#statEffects, target, "power") + (existing + count) * 1000), "v3-don-power-overflow");
      const result = new MovementStore(this.#board).commit({ transactionId: hash(`${this.#board.matchId}:${requestId}:attach`), matchId: this.#board.matchId, expectedRevision: this.#board.revision,
        turnNumber: this.#board.turnNumber, actor, effectController: null, source: null, mode: "rule", resolutionId: null,
        operations: this.#board.players[actor].activeDon.slice(0, count).map(id => ({ kind: "attachDon", card: { instanceId: id!, generation: this.#board.cards[id!]!.generation }, target })) }, { status: "certifiedNone" });
      ensureMove(this.#ruleEvents.length + result.events.length <= 512, "v3-match-rule-event-limit");
      this.#archive(); this.#board = result.state; this.#ruleEvents = freezeMovement([...this.#ruleEvents, ...result.events]);
    });
  }
  #battleIdle(): void {
    ensureMove(!this.#triggers.length && !this.#active && !this.#lifeDecision && this.#progression.gate.kind === "idle" && !this.#progression.outcome, "v3-battle-operation-pending");
  }
  #acceptBattle(result: { movement: MovementState; progression: Progression; events: readonly MovementEvent[]; deferredKO?: boolean }, counters: BattleCounters, pendingLife: LifeDecision | null) {
    ensureMove(this.#ruleEvents.length + result.events.length <= 512, "v3-match-rule-event-limit"); this.#checkNewEvents(result.events);
    const triggers = enqueueMovementTriggers(result.events, this.#cards);
    const progression = result.deferredKO && !triggers.length ? finishDamageStep(result.progression) : result.progression;
    this.#board = result.movement; this.#progression = progression; this.#ruleEvents = freezeMovement([...this.#ruleEvents, ...result.events]);
    this.#statEffects = pruneStatEffects(this.#board, this.#statEffects); this.#triggers = freezeMovement([...this.#triggers, ...triggers]);
    this.#keywordGrants = pruneKeywordGrants(this.#board, this.#keywordGrants);
    this.#battleCounters = progression.battle ? counters : []; this.#lifeDecision = pendingLife; this.#damageSettling = !!result.deferredKO && triggers.length > 0;
  }
  battleDecision(actor: Seat, requestId: string, expected: V3MatchContext, decision: "passBlock" | "endCounter") {
    return this.#run(actor, requestId, expected, { kind: decision }, () => {
      this.#battleIdle(); const battle = this.#progression.battle; ensureMove(battle, "v3-battle-required");
      const result = decision === "endCounter" ? { movement: this.#board, progression: finishCounterStep(this.#board, this.#progression, actor) } : decideLocalBattle(this.#board, this.#progression, actor, battle.battleId, decision);
      this.#acceptBattle({ ...result, events: [] }, this.#battleCounters, null);
    });
  }
  block(actor: Seat, requestId: string, expected: V3MatchContext, card: Readonly<CardObjectRef>) {
    reference(card);
    return this.#run(actor, requestId, expected, { kind: "block", card: { ...card } }, () => {
      this.#battleIdle(); const result = declareBlock(this.#board, this.#progression, actor, card, this.#cards, this.#keywordGrants, hash(`${this.#board.matchId}:${requestId}:block`));
      this.#acceptBattle(result, this.#battleCounters, null);
    });
  }
  useCounterEvent(actor: Seat, requestId: string, expected: V3MatchContext, cardRef: Readonly<CardObjectRef>, effectId: string) {
    reference(cardRef); label(effectId);
    return this.#run(actor, requestId, expected, { kind: "counterEvent", card: { ...cardRef }, effectId }, () => {
      this.#battleIdle(); ensureMove(this.#history.length < 256, "v3-match-history-limit");
      const object = getCard(this.#board, cardRef), card = this.#cards.get(object.cardId);
      ensureMove(card, "v3-counter-event-unregistered");
      const resolutionId = randomUUID(), candidate = prepareCounterEvent(this.#board, this.#progression, actor, cardRef, effectId, this.#cards, hash(`${this.#board.matchId}:${requestId}:event`), resolutionId);
      ensureMove(this.#ruleEvents.length + candidate.events.length <= 512, "v3-match-rule-event-limit"); this.#checkNewEvents(candidate.events);
      const coordinator = new V3FixtureCoordinator({ mode: "syntheticNoAbilities", card,
        identity: { matchId: this.#board.matchId, resolutionId, effectId, actor, source: candidate.source }, movement: candidate.movement, progression: this.#progression,
        signingKey: this.#key, master: this.#master, now: this.#now, definitions: [...this.#cards.values()], statEffects: this.#statEffects, keywordGrants: this.#keywordGrants,
        counterEventCause: candidate.cause, battleCounters: this.#battleCounters, checkEvents: this.#checkNewEvents });
      const usageKey = JSON.stringify([this.#board.turnNumber, actor, candidate.source.instanceId, candidate.source.generation, effectId]);
      this.#board = candidate.movement; this.#ruleEvents = freezeMovement([...this.#ruleEvents, ...candidate.events]);
      this.#active = { coordinator, actor, cardId: object.cardId, effectId, source: candidate.source, resolutionId, usageKey, counted: false, eventCount: 0, triggerEventId: null };
      this.#progression = coordinator.snapshotForCoordinator().progression;
    });
  }
  counter(actor: Seat, requestId: string, expected: V3MatchContext, card: Readonly<CardObjectRef>, target: Readonly<CardObjectRef>) {
    reference(card); reference(target);
    return this.#run(actor, requestId, expected, { kind: "counter", card: { ...card }, target: { ...target } }, () => {
      this.#battleIdle(); const result = useCounter(this.#board, this.#progression, actor, card, target, this.#cards, this.#battleCounters, this.#statEffects, hash(`${this.#board.matchId}:${requestId}:counter`));
      this.#acceptBattle({ movement: result.state, progression: this.#progression, events: result.events }, result.counters, null);
    });
  }
  resolveDamage(actor: Seat, requestId: string, expected: V3MatchContext) {
    return this.#run(actor, requestId, expected, { kind: "damage" }, () => {
      this.#battleIdle(); const result = damage(this.#board, this.#progression, actor, this.#cards, this.#statEffects, this.#battleCounters, hash(`${this.#board.matchId}:${requestId}:damage`), this.#now(), true);
      this.#acceptBattle(result, this.#battleCounters, result.pendingLife);
    });
  }
  takeDamageLife(actor: Seat, requestId: string, expected: V3MatchContext, selectionId: string, token: string) {
    label(selectionId); label(token);
    return this.#run(actor, requestId, expected, { kind: "life", selectionId, token }, () => {
      ensureMove(this.#lifeDecision, "v3-life-decision-required");
      const result = takeLife(this.#board, this.#progression, actor, this.#lifeDecision, selectionId, token, hash(`${this.#board.matchId}:${requestId}:life`), this.#now());
      this.#acceptBattle(result, this.#battleCounters, null);
    });
  }
  useLifeTrigger(actor: Seat, requestId: string, expected: V3MatchContext, selectionId: string, token: string) {
    label(selectionId); label(token);
    return this.#run(actor, requestId, expected, { kind: "lifeTrigger", selectionId, token }, () => {
      ensureMove(this.#lifeDecision && this.#history.length < 256 && !this.#active && !this.#triggers.length, "v3-life-trigger-not-pending");
      const candidate = prepareLifeTrigger(this.#board, this.#progression, actor, this.#lifeDecision, selectionId, token, hash(`${this.#board.matchId}:${requestId}:trigger`), this.#now(), this.#cards);
      ensureMove(this.#ruleEvents.length + candidate.events.length <= 512, "v3-match-rule-event-limit"); this.#checkNewEvents(candidate.events);
      const resolutionId = randomUUID(), source = candidate.source, effectId = candidate.effectId;
      const coordinator = new V3FixtureCoordinator({ mode: "syntheticNoAbilities", card: candidate.card,
        identity: { matchId: this.#board.matchId, resolutionId, effectId, actor, source }, movement: candidate.movement, progression: candidate.progression,
        signingKey: this.#key, master: this.#master, now: this.#now, definitions: [...this.#cards.values()], statEffects: this.#statEffects, keywordGrants: this.#keywordGrants,
        lifeTriggerCause: candidate.cause, battleCounters: this.#battleCounters, checkEvents: this.#checkNewEvents });
      const usageKey = JSON.stringify([this.#board.turnNumber, actor, source.instanceId, source.generation, effectId]);
      this.#board = candidate.movement; this.#ruleEvents = freezeMovement([...this.#ruleEvents, ...candidate.events]);
      this.#active = { coordinator, actor, cardId: candidate.card.definition.cardId, effectId, source, resolutionId, usageKey, counted: false, eventCount: 0, triggerEventId: null };
      this.#progression = coordinator.snapshotForCoordinator().progression; this.#lifeDecision = null; this.#damageSettling = true;
    });
  }
  endTurn(actor: Seat, requestId: string, expected: V3MatchContext) {
    return this.#run(actor, requestId, expected, { kind: "endTurn" }, () => {
      this.#settled(); ensureMove(this.#history.length < 256, "v3-match-history-limit");
      let progression = applyPlayerIntent(this.#progression, this.#progression.revision, actor, "endMain"), board = this.#board;
      const statEffects = endTurnStatEffects(this.#statEffects, this.#progression.activePlayer);
      const keywordGrants = endTurnKeywordGrants(this.#keywordGrants, this.#progression.activePlayer);
      const ruleEvents = [...this.#ruleEvents];
      // Every checkpoint is prepared locally. A later failure retains neither phase nor movement changes.
      for (let steps = 0; steps < 12; steps++) {
        const work = phaseWork(progression); ensureMove(work, "v3-match-phase-work-required");
        const operations: MovementOperation[] = [], player = work.player;
        const ref = (id: string) => ({ instanceId: id, generation: board.cards[id]!.generation });
        if (work.kind === "refreshCheckpoint") {
          for (const zone of ["leader", "character", "stage", "restDon"] as const) for (const id of board.players[player][zone]) if (id && board.cards[id]!.rotated) operations.push({ kind: "setRest", card: ref(id), rotated: false });
          for (const id of board.players[player].attachedDon) if (id) operations.push({ kind: "move", card: ref(id), from: { player, zone: "attachedDon" }, to: { player, zone: "activeDon", position: "append", faceUp: true, rotated: false }, cause: "RULE_PROCESSING" });
        } else if (work.kind === "drawCheckpoint") {
          for (const id of board.players[player].deck.slice(0, work.normalCount)) if (id) operations.push({ kind: "move", card: ref(id), from: { player, zone: "deck" }, to: { player, zone: "hand", position: "append", faceUp: true, rotated: false }, cause: "RULE_PROCESSING" });
        } else if (work.kind === "donCheckpoint") {
          for (const id of board.players[player].donDeck.slice(0, work.normalMaximum)) if (id) operations.push({ kind: "move", card: ref(id), from: { player, zone: "donDeck" }, to: { player, zone: "activeDon", position: "append", faceUp: true, rotated: false }, cause: "RULE_PROCESSING" });
        }
        if (operations.length || board.turnNumber !== progression.turnNumber) {
          const result = new MovementStore(board).commit({ transactionId: hash(`${board.matchId}:${requestId}:${work.token}`), matchId: board.matchId,
            expectedRevision: board.revision, turnNumber: progression.turnNumber, actor: player, effectController: null, source: null, mode: "rule", resolutionId: null, operations }, { status: "certifiedNone" });
          board = result.state; ruleEvents.push(...result.events); ensureMove(ruleEvents.length <= 512, "v3-match-rule-event-limit");
        }
        const outcome = deckOutOutcome(board);
        if (outcome) {
          progression = applySystemEvent(progression, progression.revision, { kind: "finishGame", winner: outcome.winner, reason: outcome.reason });
          this.#archive(); this.#board = board; this.#progression = progression; this.#ruleEvents = freezeMovement(ruleEvents);
          this.#statEffects = pruneStatEffects(board, statEffects); this.#keywordGrants = pruneKeywordGrants(board, keywordGrants); this.#usage.clear(); return;
        }
        progression = applySystemEvent(progression, progression.revision, { kind: "settlePhase", phaseToken: work.token });
        if (work.kind === "mainEntryCheckpoint") { this.#archive(); this.#board = board; this.#progression = progression; this.#ruleEvents = freezeMovement(ruleEvents); this.#statEffects = pruneStatEffects(board, statEffects); this.#keywordGrants = pruneKeywordGrants(board, keywordGrants); this.#usage.clear(); return; }
        progression = applySystemEvent(progression, progression.revision, { kind: "advancePhase", phaseToken: work.token });
      }
      throw new Error("V3_MATCH_PHASE_LIMIT");
    });
  }
  viewFor(viewer: Seat) {
    ensureMove(viewer === 0 || viewer === 1, "v3-match-viewer");
    const active = this.#active?.coordinator.viewFor(viewer);
    const waitingTriggers = this.#triggers.length > 0 && (!active || active.frame.status === "completed");
    const chooser = waitingTriggers ? triggerChooser(this.#triggers, this.#progression.activePlayer) : null;
    const battle = this.#progression.battle, life = this.#lifeDecision;
    let powers: ReturnType<typeof battlePower> = null;
    try { powers = battlePower(this.#board, this.#progression, this.#cards, this.#statEffects, this.#battleCounters); } catch { /* Unknown facts must not be displayed as zero. */ }
    const revealIds = [...new Set(this.#board.reveals.filter(grant => grant.viewers.includes(0) && grant.viewers.includes(1)).map(grant => grant.card.instanceId))];
    const heldId = this.#board.players.flatMap(zones => zones.resolving)[0], held = heldId ? this.#board.cards[heldId]! : null;
    return freezeMovement({ mode: this.#reviewed ? "v3-reviewed-session" as const : "v3-synthetic-session" as const, context: this.context(), movement: active?.movement ?? projectV3Movement(this.#board, viewer),
      frame: active?.frame ?? null, turnNumber: this.#progression.turnNumber, activePlayer: this.#progression.activePlayer, phase: this.#progression.phase,
      gate: waitingTriggers ? "trigger" as const : this.#progression.gate.kind, resolutionActor: this.#active?.actor ?? null, history: [...this.#history],
      triggerPolicy: SYNTHETIC_TRIGGER_POLICY, pendingTriggerCount: this.#triggers.length, triggerChooser: chooser,
      triggerChoices: availableTriggers(this.#triggers, this.#progression.activePlayer).filter(entry => entry.actor === viewer && chooser === viewer).map(entry => ({ token: entry.token, cardId: entry.cardId, effectId: entry.effectId, timing: entry.cause.type })),
      battle: battle ? { ...battle, powers } : null, battleRules: V3_BASE_BATTLE_RULES.version, deckOutPolicy: DECK_OUT_POLICY.version, outcome: this.#progression.outcome, damageEffectsPending: this.#damageSettling,
      counterChoices: counterCandidates(this.#board, this.#progression, viewer, this.#cards), counterEventChoices: !this.#triggers.length && !this.#active ? counterEventChoices(this.#board, this.#progression, viewer, this.#cards) : [], blockerChoices: blockerOptions(this.#board, this.#progression, viewer, this.#cards, this.#keywordGrants), lifePending: !!life,
      lifeChoice: life?.defender === viewer ? { selectionId: life.selectionId, token: life.token, expiresAt: life.expiresAt, cardId: this.#board.cards[life.card.instanceId]!.cardId,
        canTrigger: this.#cards.get(this.#board.cards[life.card.instanceId]!.cardId)?.definition.effects.some(effect => effect.timing.type === "TRIGGER") ?? false } : null,
      lifeTrigger: held ? { cardId: held.cardId, owner: held.owner } : null,
      publicReveals: revealIds.map(id => ({ cardId: this.#board.cards[id]!.cardId, owner: this.#board.cards[id]!.owner })),
      publicStats: this.#board.players.flatMap((zones, player) => (["leader", "character", "stage"] as const).flatMap(zone => zones[zone].flatMap((id, slot) => {
        if (!id) return []; const object = this.#board.cards[id]!, definition = this.#cards.get(object.cardId)?.definition;
        if (!object.faceUp || !definition || definition.cardType !== object.kind) return [];
        const ref = { instanceId: id, generation: object.generation }, powerDelta = statDelta(this.#statEffects, ref, "power"), costDelta = statDelta(this.#statEffects, ref, "cost");
        const dons = player === this.#progression.activePlayer ? zones.attachedDon.filter(id => { const parent = this.#board.cards[id!]!.attachedTo; return parent?.instanceId === ref.instanceId && parent.generation === ref.generation; }).length * 1000 : 0;
        const power = definition.baseStats.power === null ? null : definition.baseStats.power + powerDelta + dons;
        return [{ card: ref, cardId: object.cardId, player: player as Seat, zone, slot, power: power !== null && Number.isSafeInteger(power) ? power : null,
          cost: definition.baseStats.cost === null ? null : Math.max(0, definition.baseStats.cost + costDelta), powerDelta, costDelta, keywords: zone === "stage" ? [] : effectiveKeywords(this.#board, this.#cards, this.#keywordGrants, ref) }];
      }))) });
  }
  effectsFor(actor: Seat, source: Readonly<CardObjectRef>) {
    ensureMove(actor === 0 || actor === 1, "v3-match-actor"); const object = getCard(this.#board, source), card = this.#cards.get(object.cardId);
    ensureMove(object.owner === actor && object.controller === actor && card, "v3-match-source-policy");
    const at = location(this.#board, source.instanceId);
    const ready = !this.#triggers.length && object.faceUp && at.player === actor && (!this.#active || this.#active.coordinator.viewFor(actor).frame.status === "completed") && checkTiming(this.#progression, actor, "mainEffect").allowed;
    return card.definition.effects.filter(effect => effect.kind === "activated" && effect.timing.type === "MAIN").map(effect => {
      const limit = effect.usageLimit?.count ?? null, usageKey = JSON.stringify([this.#board.turnNumber, actor, source.instanceId, source.generation, effect.id]);
      const used = this.#usage.get(usageKey) ?? 0;
      return { effectId: effect.id, used, limit, enabled: ready && effect.sourceZones.some(zone => zone === at.zone) && (limit === null || used < limit) && (!this.#reviewed || this.#canStartMainEffect(actor, source, card, effect.id)) };
    });
  }
  mainEffectsFor(actor: Seat) {
    ensureMove(actor === 0 || actor === 1, "v3-match-actor");
    return freezeMovement((["leader", "character", "stage"] as const).flatMap(zone => this.#board.players[actor][zone].flatMap((id, slot) => {
      if (!id) return [];
      const object = this.#board.cards[id]!, at = location(this.#board, id), card = this.#cards.get(object.cardId);
      if (!card || card.definition.cardType !== zone || object.kind !== zone || object.owner !== actor || object.controller !== actor || !object.faceUp ||
        at.player !== actor || at.zone !== zone || !visibleTo(this.#board, object, at, 0) || !visibleTo(this.#board, object, at, 1)) return [];
      const source = { instanceId: id, generation: object.generation };
      return this.effectsFor(actor, source).map(effect => {
        const sourceToken = createHmac("sha256", this.#key).update(JSON.stringify(["v3-main-source.1", this.#board.matchId, actor, this.context(), source, zone, effect.effectId, card.definitionHash])).digest("hex");
        let available = false;
        try { available = effect.enabled && this.#history.length < 256 && !this.#lifeDecision && this.#canStartMainEffect(actor, source, card, effect.effectId); } catch { /* Unknown facts do not authorize activation. */ }
        return { ...effect, enabled: available, sourceToken, source, cardId: object.cardId, zone, slot };
      });
    })));
  }
  #canStartMainEffect(actor: Seat, source: Readonly<CardObjectRef>, card: ApprovedV3Card, effectId: string): boolean {
    const effect = card.definition.effects.find(effect => effect.id === effectId)!;
    const facts = pinMasterFacts(this.#board, { master: this.#master, numericPolicy: "certifiedUnmodified" });
    const environment = fixtureEnvironment(() => this.#board, { matchId: this.#board.matchId, resolutionId: "activation-preflight", actor, source, effectId },
      card, facts, this.#now, [...this.#cards.values()], () => this.#statEffects, this.#progression.activePlayer, () => 0, undefined, () => this.#keywordGrants);
    return environment.evaluate(effect.activationConditions, {}) === true && environment.canPayCosts?.(effect.costs, null, null) === true;
  }
  snapshotForCoordinator() {
    return freezeMovement({ context: this.context(), movement: this.#board, progression: this.#progression, active: this.#active?.coordinator.snapshotForCoordinator() ?? null,
      usage: [...this.#usage.entries()], receipts: structuredClone(this.#receipts), history: [...this.#history], ruleEvents: this.#ruleEvents, statEffects: this.#statEffects, keywordGrants: this.#keywordGrants, pendingTriggers: this.#triggers, battleCounters: this.#battleCounters, pendingLife: this.#lifeDecision, damageEffectsPending: this.#damageSettling });
  }
  toJSON(): never { throw new Error("v3-match-server-only"); }
}
