import { createHash, randomUUID } from "node:crypto";
import type { MasterSnapshot } from "../../cardMaster";
import type { CardObjectRef } from "../types";
import type { MovementEvent, MovementOperation, MovementState } from "../../movement/types";
import { MovementStore } from "../../movement/engine";
import { projectMovementState } from "../../movement/projection";
import { dataArray, dataObject, ensureMove, freezeMovement, getCard, location, reference, validateMovementState } from "../../movement/state";
import type { Progression } from "../../progression/types";
import { checkTiming, phaseWork } from "../../progression/state";
import { applyPlayerIntent, applySystemEvent } from "../../progression/transitions";
import { isApprovedV3Card, type ApprovedV3Card } from "./approval";
import { label } from "./compiler";
import { V3FixtureCoordinator } from "./fixtureCoordinator";
import { endTurnStatEffects, pruneStatEffects, statDelta, type StatEffects } from "./statEffects";
import { enqueuePlayTriggers, playTriggerCandidates, triggerChooser, SYNTHETIC_TRIGGER_POLICY, type PlayTrigger } from "./triggerScheduler";
import { localAttackCandidates, startLocalBattle, decideLocalBattle } from "../../localBattle";
import { battlePower, counterCandidates, useCounter, damage, takeLife, V3_BASE_BATTLE_RULES, type BattleCounters, type LifeDecision } from "./battle";

type Seat = 0 | 1;
export type V3MatchContext = Readonly<{ revision: number; movementRevision: number; progressionRevision: number; resolutionId: string | null; frameRevision: number | null }>;
type Active = { coordinator: V3FixtureCoordinator; actor: Seat; cardId: string; effectId: string; source: Readonly<CardObjectRef>; resolutionId: string; usageKey: string; counted: boolean; eventCount: number; triggerEventId: string | null };
type History = Readonly<{ turnNumber: number; actor: Seat; cardId: string; effectId: string; resolutionId: string; committed: boolean; declined: boolean; triggerEventId: string | null }>;
type Receipt = { requestId: string; fingerprint: string };
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

// A synthetic-only session boundary. It is not a production match or a card-ruling engine.
export class V3SyntheticMatchCoordinator {
  #board: MovementState; #progression: Progression; #cards = new Map<string, ApprovedV3Card>();
  #usage = new Map<string, number>();
  #active: Active | null = null; #history: History[] = []; #receipts: Receipt[] = [];
  #ruleEvents: readonly MovementEvent[] = [];
  #statEffects: StatEffects = [];
  #triggers: readonly PlayTrigger[] = [];
  #battleCounters: BattleCounters = []; #lifeDecision: LifeDecision | null = null;
  #revision = 0; #busy = false; #key: Uint8Array; #master: MasterSnapshot | null; #now: () => number;
  constructor(options: Readonly<{ mode: "syntheticNoAbilities"; movement: MovementState; progression: Progression; cards: readonly ApprovedV3Card[];
    signingKey: Uint8Array; master: MasterSnapshot | null; now?: () => number }>) {
    ensureMove(process.env.NODE_ENV !== "production" && options.mode === "syntheticNoAbilities", "v3-match-disabled");
    dataObject(options, ["mode", "movement", "progression", "cards", "signingKey", "master", ...(Object.hasOwn(options, "now") ? ["now"] : [])]);
    ensureMove(!Object.hasOwn(options, "now") || typeof options.now === "function", "v3-match-invalid-clock");
    validateMovementState(options.movement); dataArray(options.cards, 128);
    ensureMove(options.signingKey instanceof Uint8Array && options.signingKey.length >= 32 && options.signingKey.length <= 128, "v3-signing-key-required");
    ensureMove(options.progression.gate.kind === "idle" && !options.progression.battle && !options.progression.outcome &&
      options.movement.turnNumber === options.progression.turnNumber && checkTiming(options.progression, options.progression.activePlayer, "mainEffect").allowed, "v3-match-main-required");
    ensureMove(Object.values(options.movement.cards).every(card => !card.modifierIds.length && !card.grantIds.length) && options.movement.reveals.length === 0, "v3-match-unmodeled-board");
    for (const card of options.cards) {
      ensureMove(isApprovedV3Card(card) && !this.#cards.has(card.definition.cardId), "v3-match-approved-card-required"); this.#cards.set(card.definition.cardId, card);
    }
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
    try { apply(); this.#revision++; this.#receipts.push({ requestId, fingerprint }); return { replayed: false }; }
    finally { this.#busy = false; }
  }
  #settled(allowTriggers = false): void {
    ensureMove(!this.#active || this.#active.coordinator.viewFor(this.#active.actor).frame.status === "completed", "v3-match-resolution-pending");
    ensureMove(this.#progression.gate.kind === "idle" && !this.#progression.battle && !this.#progression.outcome, "v3-match-not-idle");
    ensureMove(allowTriggers || !this.#triggers.length, "v3-match-triggers-pending");
  }
  #checkNewEvents = (events: readonly MovementEvent[]): void => {
    ensureMove(this.#triggers.length + playTriggerCandidates(events, this.#cards).length <= 128, "v3-trigger-queue-limit");
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
    return this.#run(actor, requestId, expected, { kind: "activate", source: { instanceId: source.instanceId, generation: source.generation }, effectId }, () => {
      this.#settled(); ensureMove(this.#history.length < 256 && checkTiming(this.#progression, actor, "mainEffect").allowed, "v3-match-cannot-activate");
      const object = getCard(this.#board, source), card = this.#cards.get(object.cardId), effect = card?.definition.effects.find(effect => effect.id === effectId);
      ensureMove(card && effect && effect.kind === "activated" && effect.timing.type === "MAIN", "v3-match-unregistered-effect"); const limit = effect.usageLimit?.count ?? null;
      const usageKey = JSON.stringify([this.#board.turnNumber, actor, source.instanceId, source.generation, effectId]);
      ensureMove(limit === null || (this.#usage.get(usageKey) ?? 0) < limit, "v3-match-usage-exhausted");
      const resolutionId = randomUUID(), coordinator = new V3FixtureCoordinator({ mode: "syntheticNoAbilities", card,
        identity: { matchId: this.#board.matchId, resolutionId, effectId, actor, source }, movement: this.#board, progression: this.#progression,
        signingKey: this.#key, master: this.#master, now: this.#now, definitions: [...this.#cards.values()], statEffects: this.#statEffects, checkEvents: this.#checkNewEvents });
      this.#archive(); this.#active = { coordinator, actor, cardId: object.cardId, effectId, source: { ...source }, resolutionId, usageKey, counted: false, eventCount: 0, triggerEventId: null };
      this.#progression = coordinator.snapshotForCoordinator().progression;
    });
  }
  resolveTrigger(actor: Seat, requestId: string, expected: V3MatchContext, token: string) {
    label(token);
    return this.#run(actor, requestId, expected, { kind: "trigger", token }, () => {
      this.#settled(true); ensureMove(this.#history.length < 256 && triggerChooser(this.#triggers, this.#progression.activePlayer) === actor, "v3-trigger-wrong-controller-or-limit");
      const pending = this.#triggers.find(entry => entry.token === token && entry.actor === actor);
      ensureMove(pending && pending.event.after, "v3-trigger-not-pending");
      const card = this.#cards.get(pending.cardId)!;
      const source = { instanceId: pending.event.after.instanceId, generation: pending.event.after.generation }, effectId = pending.effectId;
      const effect = card.definition.effects.find(effect => effect.id === effectId)!;
      const usageKey = JSON.stringify([this.#board.turnNumber, actor, source.instanceId, source.generation, effectId]);
      ensureMove(effect.usageLimit === null || (this.#usage.get(usageKey) ?? 0) < effect.usageLimit.count, "v3-match-usage-exhausted");
      const resolutionId = randomUUID(), coordinator = new V3FixtureCoordinator({ mode: "syntheticNoAbilities", card,
        identity: { matchId: this.#board.matchId, resolutionId, effectId, actor, source }, movement: this.#board, progression: this.#progression,
        signingKey: this.#key, master: this.#master, now: this.#now, definitions: [...this.#cards.values()], statEffects: this.#statEffects,
        triggerEvent: pending.event, checkEvents: this.#checkNewEvents });
      this.#archive(); this.#triggers = this.#triggers.filter(entry => entry.token !== token);
      this.#active = { coordinator, actor, cardId: pending.cardId, effectId, source, resolutionId, usageKey, counted: false, eventCount: 0, triggerEventId: pending.event.eventId };
      this.#progression = coordinator.snapshotForCoordinator().progression;
    });
  }
  #control(actor: Seat, requestId: string, expected: V3MatchContext, body: object, action: (coordinator: V3FixtureCoordinator) => void) {
    return this.#run(actor, requestId, expected, body, () => {
      ensureMove(this.#active, "v3-match-no-resolution"); const active = this.#active;
      action(active.coordinator); const snapshot = active.coordinator.snapshotForCoordinator(), frame = active.coordinator.viewFor(active.actor).frame;
      const triggers = enqueuePlayTriggers(snapshot.movementEvents.slice(active.eventCount), this.#cards);
      this.#triggers = freezeMovement([...this.#triggers, ...triggers]); active.eventCount = snapshot.movementEvents.length;
      this.#board = snapshot.movement; this.#progression = snapshot.progression; this.#statEffects = snapshot.statEffects;
      if (frame.activationCommitted && !active.counted) {
        this.#usage.set(active.usageKey, (this.#usage.get(active.usageKey) ?? 0) + 1); active.counted = true;
      }
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
      this.#checkNewEvents(events); const triggers = enqueuePlayTriggers(events, this.#cards);
      this.#archive(); this.#board = played.state; this.#ruleEvents = freezeMovement([...this.#ruleEvents, ...events]); this.#statEffects = pruneStatEffects(this.#board, this.#statEffects);
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
    if (this.#triggers.length || this.#lifeDecision || this.#active && this.#active.coordinator.viewFor(actor).frame.status !== "completed") return { sources: [], targets: [] };
    const choices = localAttackCandidates(this.#board, this.#progression, actor);
    const rows = (ids: readonly string[]) => ids.flatMap(id => {
      const object = this.#board.cards[id]!, definition = this.#cards.get(object.cardId)?.definition;
      return definition && definition.cardType === object.kind && definition.baseStats.power !== null ? [{ card: { instanceId: id, generation: object.generation }, cardId: object.cardId }] : [];
    });
    return { sources: rows(choices.sources), targets: rows(choices.targets) };
  }
  attack(actor: Seat, requestId: string, expected: V3MatchContext, source: Readonly<CardObjectRef>, target: Readonly<CardObjectRef>) {
    reference(source); reference(target);
    return this.#run(actor, requestId, expected, { kind: "attack", source: { ...source }, target: { ...target } }, () => {
      this.#settled(); ensureMove(this.#history.length < 256, "v3-match-history-limit");
      const choices = this.attackChoicesFor(actor), includes = (rows: typeof choices.sources, ref: Readonly<CardObjectRef>) => rows.some(row => row.card.instanceId === ref.instanceId && row.card.generation === ref.generation);
      ensureMove(includes(choices.sources, source) && includes(choices.targets, target), "v3-battle-attack-unavailable");
      const result = startLocalBattle(this.#board, this.#progression, actor, source, target, randomUUID(), hash(`${this.#board.matchId}:${requestId}:attack`));
      this.#archive(); this.#board = result.movement; this.#progression = result.progression; this.#battleCounters = [];
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
  #acceptBattle(result: { movement: MovementState; progression: Progression; events: readonly MovementEvent[] }, counters: BattleCounters, pendingLife: LifeDecision | null) {
    ensureMove(this.#ruleEvents.length + result.events.length <= 512, "v3-match-rule-event-limit"); this.#checkNewEvents(result.events);
    const triggers = enqueuePlayTriggers(result.events, this.#cards);
    this.#board = result.movement; this.#progression = result.progression; this.#ruleEvents = freezeMovement([...this.#ruleEvents, ...result.events]);
    this.#statEffects = pruneStatEffects(this.#board, this.#statEffects); this.#triggers = freezeMovement([...this.#triggers, ...triggers]);
    this.#battleCounters = result.progression.battle ? counters : []; this.#lifeDecision = pendingLife;
  }
  battleDecision(actor: Seat, requestId: string, expected: V3MatchContext, decision: "passBlock" | "endCounter") {
    return this.#run(actor, requestId, expected, { kind: decision }, () => {
      this.#battleIdle(); const battle = this.#progression.battle; ensureMove(battle, "v3-battle-required");
      const result = decideLocalBattle(this.#board, this.#progression, actor, battle.battleId, decision);
      this.#acceptBattle({ ...result, events: [] }, this.#battleCounters, null);
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
      this.#battleIdle(); const result = damage(this.#board, this.#progression, actor, this.#cards, this.#statEffects, this.#battleCounters, hash(`${this.#board.matchId}:${requestId}:damage`), this.#now());
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
  endTurn(actor: Seat, requestId: string, expected: V3MatchContext) {
    return this.#run(actor, requestId, expected, { kind: "endTurn" }, () => {
      this.#settled(); ensureMove(this.#history.length < 256, "v3-match-history-limit");
      let progression = applyPlayerIntent(this.#progression, this.#progression.revision, actor, "endMain"), board = this.#board;
      const statEffects = endTurnStatEffects(this.#statEffects, this.#progression.activePlayer);
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
          ensureMove(board.players[player].deck.length > work.normalCount, "v3-match-deck-out-policy-unresolved");
          for (const id of board.players[player].deck.slice(0, work.normalCount)) if (id) operations.push({ kind: "move", card: ref(id), from: { player, zone: "deck" }, to: { player, zone: "hand", position: "append", faceUp: true, rotated: false }, cause: "RULE_PROCESSING" });
        } else if (work.kind === "donCheckpoint") {
          for (const id of board.players[player].donDeck.slice(0, work.normalMaximum)) if (id) operations.push({ kind: "move", card: ref(id), from: { player, zone: "donDeck" }, to: { player, zone: "activeDon", position: "append", faceUp: true, rotated: false }, cause: "RULE_PROCESSING" });
        }
        if (operations.length || board.turnNumber !== progression.turnNumber) {
          const result = new MovementStore(board).commit({ transactionId: hash(`${board.matchId}:${requestId}:${work.token}`), matchId: board.matchId,
            expectedRevision: board.revision, turnNumber: progression.turnNumber, actor: player, effectController: null, source: null, mode: "rule", resolutionId: null, operations }, { status: "certifiedNone" });
          board = result.state; ruleEvents.push(...result.events); ensureMove(ruleEvents.length <= 512, "v3-match-rule-event-limit");
        }
        progression = applySystemEvent(progression, progression.revision, { kind: "settlePhase", phaseToken: work.token });
        if (work.kind === "mainEntryCheckpoint") { this.#archive(); this.#board = board; this.#progression = progression; this.#ruleEvents = freezeMovement(ruleEvents); this.#statEffects = pruneStatEffects(board, statEffects); this.#usage.clear(); return; }
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
    return freezeMovement({ mode: "v3-synthetic-session" as const, context: this.context(), movement: active?.movement ?? projectMovementState(this.#board, viewer),
      frame: active?.frame ?? null, turnNumber: this.#progression.turnNumber, activePlayer: this.#progression.activePlayer, phase: this.#progression.phase,
      gate: waitingTriggers ? "trigger" as const : this.#progression.gate.kind, resolutionActor: this.#active?.actor ?? null, history: [...this.#history],
      triggerPolicy: SYNTHETIC_TRIGGER_POLICY, pendingTriggerCount: this.#triggers.length, triggerChooser: chooser,
      triggerChoices: this.#triggers.filter(entry => entry.actor === viewer && chooser === viewer).map(entry => ({ token: entry.token, cardId: entry.cardId, effectId: entry.effectId })),
      battle: battle ? { ...battle, powers } : null, battleRules: V3_BASE_BATTLE_RULES.version, outcome: this.#progression.outcome,
      counterChoices: counterCandidates(this.#board, this.#progression, viewer, this.#cards), lifePending: !!life,
      lifeChoice: life?.defender === viewer ? { selectionId: life.selectionId, token: life.token, expiresAt: life.expiresAt, cardId: this.#board.cards[life.card.instanceId]!.cardId } : null,
      publicReveals: revealIds.map(id => ({ cardId: this.#board.cards[id]!.cardId, owner: this.#board.cards[id]!.owner })),
      publicStats: this.#board.players.flatMap((zones, player) => (["leader", "character", "stage"] as const).flatMap(zone => zones[zone].flatMap((id, slot) => {
        if (!id) return []; const object = this.#board.cards[id]!, definition = this.#cards.get(object.cardId)?.definition;
        if (!object.faceUp || !definition || definition.cardType !== object.kind) return [];
        const ref = { instanceId: id, generation: object.generation }, powerDelta = statDelta(this.#statEffects, ref, "power"), costDelta = statDelta(this.#statEffects, ref, "cost");
        const dons = player === this.#progression.activePlayer ? zones.attachedDon.filter(id => { const parent = this.#board.cards[id!]!.attachedTo; return parent?.instanceId === ref.instanceId && parent.generation === ref.generation; }).length * 1000 : 0;
        const power = definition.baseStats.power === null ? null : definition.baseStats.power + powerDelta + dons;
        return [{ card: ref, cardId: object.cardId, player: player as Seat, zone, slot, power: power !== null && Number.isSafeInteger(power) ? power : null,
          cost: definition.baseStats.cost === null ? null : Math.max(0, definition.baseStats.cost + costDelta), powerDelta, costDelta }];
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
      return { effectId: effect.id, used, limit, enabled: ready && effect.sourceZones.some(zone => zone === at.zone) && (limit === null || used < limit) };
    });
  }
  snapshotForCoordinator() {
    return freezeMovement({ context: this.context(), movement: this.#board, progression: this.#progression, active: this.#active?.coordinator.snapshotForCoordinator() ?? null,
      usage: [...this.#usage.entries()], receipts: structuredClone(this.#receipts), history: [...this.#history], ruleEvents: this.#ruleEvents, statEffects: this.#statEffects, pendingTriggers: this.#triggers, battleCounters: this.#battleCounters, pendingLife: this.#lifeDecision });
  }
  toJSON(): never { throw new Error("v3-match-server-only"); }
}
