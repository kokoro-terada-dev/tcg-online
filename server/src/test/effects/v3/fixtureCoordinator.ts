import { createHash, randomInt } from "node:crypto";
import { MovementStore, visibleTo } from "../../movement/engine";
import { projectV3Movement } from "./projection";
import { dataArray, dataObject, ensureMove, freezeMovement, getCard, location, MovementError, reference, validateMovementState } from "../../movement/state";
import type { MovementEvent, MovementOperation, MovementState, TransactionResult } from "../../movement/types";
import type { Progression } from "../../progression/types";
import { checkTiming, ProgressionError } from "../../progression/state";
import { applySystemEvent } from "../../progression/transitions";
import type { MasterSnapshot } from "../../cardMaster";
import { pinMasterFacts, type PinnedMasterFacts } from "../masterFacts";
import type { ApprovedV3Card } from "./approval";
import { isApprovedV3Card } from "./approval";
import { label, supportsV3RuntimeProfile } from "./compiler";
import { fixtureEnvironment } from "./fixtureEnvironment";
import { ownerHandCandidates } from "./ownerHand";
import { activationCostSelector, handDiscardOperation, movesActivationSource } from "./activationCosts";
import { V3ResolutionMachine, type ResolutionEnvironment, type ResolutionIdentity, type WorkRequest } from "./resolution";
import { addStatEffects, pruneStatEffects, validateStatEffects, type StatEffects } from "./statEffects";
import { addKeywordGrants, pruneKeywordGrants, validateKeywordGrants, type KeywordGrants } from "./keywordEffects";
import { attackAttachmentMinimum, type TriggerCause } from "./triggerScheduler";
import { deckOutOutcome } from "./ruleOutcomes";
import type { CounterEventCause } from "./counterEvents";
import type { BattleCounters } from "./battle";
import type { LifeTriggerCause } from "./lifeTriggers";
import { lifeSelfPlayProgram } from "./triggerSelfPlay";
import { createDerivedCardFactsReader, readEventContext, withEventChooser, type EventOrigin, type EventContext } from "./readContext";
import { captureMoveResult } from "./moveResults";
import { hasProtection, protectionReader, protectionRules } from "./protectionRules";
import { isSimpleMainEvent, isInteractiveMainEvent, isShareableMainEvent } from "./simpleMainEvent";
import { effectUsageKey, externalBodyChoices, resolveExternalBody } from "./effectBodyCalls";
import { retargetBattle } from "./battle";
import { trackMovementOccurrences } from "../../movement/occurrence";
import { hasPhaseBoundaries, isTriggerObservation, validateObservedSource } from "./conditionalTriggers";
import { applicationAnchor } from "./effectExpiry";
import { planReplacements, verifyReplacementOutcome, type ReplacementAnswer, type ReplacementPlan } from "./replacementPlans";

export type FixtureContext = Readonly<{ frameRevision: number; movementRevision: number; progressionRevision: number }>;
type Receipt = { requestId: string; fingerprint: string };
type AppliedWork = TransactionResult & { statEffects?: StatEffects; keywordGrants?: KeywordGrants; replaced?: ReplacementPlan;
  replacementMove?: MovementOperation; progression?: Progression };
type EffectAttribution = Pick<ResolutionIdentity, "resolutionId" | "effectId">;
type CheckEvents = (events: readonly MovementEvent[], effectOverride?: EffectAttribution) => void;
export type ReplacementTrace = Readonly<{ intent: ReplacementPlan["intent"]; candidateId: string; ruleId: string;
  cause: ReplacementPlan["cause"]; operation: MovementOperation; usageKey?: string }>;
type WorkDraft = { board: MovementState; events: MovementEvent[]; statEffects: StatEffects; keywordGrants: KeywordGrants; replacement?: ReplacementTrace; effectBody?: EffectAttribution; progression?: Progression };
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

// Isolated, server-only fixture. Never mounted on normal online/solo/test-room endpoints.
export class V3FixtureCoordinator {
  #board: MovementState; #progression: Progression; #machine: V3ResolutionMachine;
  #card: ApprovedV3Card; #identity: ResolutionIdentity; #key: Uint8Array; #facts: PinnedMasterFacts; #now: () => number;
  #definitions: readonly ApprovedV3Card[];
  #statEffects: StatEffects;
  #keywordGrants: KeywordGrants;
  #checkEvents: CheckEvents | undefined;
  #replacementUsage: Set<string>;
  #replacementTrace: ReplacementTrace[] = [];
  #receipts: Receipt[] = []; #busy = false;
  #events: readonly MovementEvent[] = [];
  #battleCounters: BattleCounters;
  #lifeTrigger: boolean;
  #readContext: EventContext;
  #occurrenceAuthorized = false;
  #usedEffect: (key: string) => number;
  #counterPower = (ref: Readonly<{ instanceId: string; generation: number }>) => this.#battleCounters.filter(entry => entry.target.instanceId === ref.instanceId && entry.target.generation === ref.generation).reduce((sum, entry) => sum + entry.amount, 0);
  constructor(options: Readonly<{ mode: "syntheticNoAbilities"; card: ApprovedV3Card; identity: ResolutionIdentity; movement: MovementState; progression: Progression; signingKey: Uint8Array; master: MasterSnapshot | null; now?: () => number; definitions?: readonly ApprovedV3Card[]; statEffects?: StatEffects; keywordGrants?: KeywordGrants; triggerCause?: TriggerCause; counterEventCause?: CounterEventCause; mainEventCause?: Readonly<{ event: MovementEvent }>; lifeTriggerCause?: LifeTriggerCause; battleCounters?: BattleCounters; checkEvents?: CheckEvents; replacementUsage?: readonly string[]; usedEffect?: (key: string) => number }>) {
    ensureMove(process.env.NODE_ENV !== "production" && options.mode === "syntheticNoAbilities", "v3-fixture-disabled");
    ensureMove(isApprovedV3Card(options.card), "v3-approved-server-plan-required");
    const definitions = options.definitions ?? [options.card]; dataArray(definitions, 128);
    ensureMove(definitions.every(card => isApprovedV3Card(card) && card.rulesetVersion === options.card.rulesetVersion && supportsV3RuntimeProfile(card)) &&
      new Set(definitions.map(card => card.definition.cardId)).size === definitions.length && definitions.some(card => card.definitionHash === options.card.definitionHash), "v3-fixture-approved-definitions-required");
    this.#definitions = [...definitions];
    ensureMove(!definitions.some(card => card.definition.effects.some(effect => effect.timing.type === "ON_EVENT")) || typeof options.checkEvents === "function", "v3-conditional-observer-coordinator-required");
    validateMovementState(options.movement);
    this.#statEffects = validateStatEffects(options.movement, options.statEffects ?? []);
    this.#keywordGrants = validateKeywordGrants(options.movement, options.keywordGrants ?? []);
    const counters = options.battleCounters ?? []; dataArray(counters, 100);
    for (const counter of counters) {
      dataObject(counter, ["target", "amount"]); reference(counter.target);
      ensureMove(Number.isSafeInteger(counter.amount) && counter.amount > 0 && counter.amount <= 100000, "v3-invalid-battle-counter");
    }
    ensureMove(!counters.length || options.progression.battle, "v3-battle-counters-outside-battle");
    this.#battleCounters = freezeMovement(structuredClone(counters));
    const { identity, movement, progression, card } = options;
    const trigger = options.triggerCause, battle = progression.battle;
    ensureMove([...this.#statEffects, ...this.#keywordGrants].every(effect => effect.battleId === undefined || effect.battleId === battle?.battleId), "v3-stale-battle-duration");
    const mainUse = options.mainEventCause, eventUse = options.counterEventCause ?? mainUse;
    const lifeUse = options.lifeTriggerCause; this.#lifeTrigger = !!lifeUse;
    ensureMove([trigger, options.counterEventCause, mainUse, lifeUse].filter(Boolean).length <= 1, "v3-mixed-source-authorization");
    const boundary = trigger?.type === "ON_EVENT" ? trigger.observation.context.boundary : undefined;
    const boundaryTiming = boundary && boundary.phaseToken === progression.phaseToken && boundary.activePlayer === progression.activePlayer && boundary.turnNumber === progression.turnNumber &&
      (boundary.type === "ON_BLOCK" ? battle?.battleId === boundary.battleId && battle.step === "block" && battle.decisionComplete && progression.phase === "main" :
        !battle && !progression.phaseSettled && progression.phase === (boundary.type === "MAIN_START" ? "main" : "end"));
    const phaseWindow = hasPhaseBoundaries(definitions) && !battle && !progression.phaseSettled && (progression.phase === "main" || progression.phase === "end");
    const blockWindow = definitions.some(card => card.definition.effects.some(effect => effect.timing.type === "ON_BLOCK")) && battle?.step === "block" && battle.decisionComplete;
    const triggerTiming = trigger && progression.gate.kind === "idle" && !progression.outcome && (boundary ? boundaryTiming : phaseWindow ||
      progression.phase === "main" && progression.phaseSettled && (!battle || battle.step === "attack" || battle.step === "damage" || battle.step === "counter" || blockWindow));
    const lifeTiming = lifeUse && battle?.step === "damage" && battle.defender === identity.actor && progression.gate.kind === "idle" && !progression.outcome;
    ensureMove(identity.matchId === movement.matchId && movement.turnNumber === progression.turnNumber && (triggerTiming || lifeTiming || options.counterEventCause && checkTiming(progression, identity.actor, "counterEffect").allowed || checkTiming(progression, identity.actor, "mainEffect").allowed), "v3-fixture-timing");
    ensureMove(Object.values(movement.cards).every(card => !card.modifierIds.length && !card.grantIds.length) && movement.players.every(zones => zones.deck.length > 0) && movement.reveals.length === 0, "v3-fixture-unmodeled-board");
    const source = getCard(movement, identity.source), at = location(movement, source.instanceId), effect = card.definition.effects.find(effect => effect.id === identity.effectId);
    const sourceZone = lifeUse ? "life" : eventUse ? "hand" : trigger?.type === "ON_KO" ? trigger.event.from?.zone : at.zone;
    const held = movement.players.flatMap(zones => zones.resolving);
    ensureMove(lifeUse ? held.length === 1 && held[0] === source.instanceId : held.length === 0, "v3-unmodeled-no-area-source");
    ensureMove(effect && source.cardId === card.definition.cardId && source.kind === card.definition.cardType && source.owner === identity.actor && source.controller === identity.actor && source.faceUp && at.player === identity.actor && effect.sourceZones.some(zone => zone === sourceZone), "v3-fixture-source");
    if (lifeUse) {
      const event = lifeUse.event;
      ensureMove(effect.kind === "triggered" && effect.timing.type === "TRIGGER" && battle?.battleId === lifeUse.battleId && at.zone === "resolving" &&
        event.kind === "moved" && event.cause.kind === "DAMAGE" && event.from?.player === identity.actor && event.from.zone === "life" && event.to?.player === identity.actor && event.to.zone === "resolving" &&
        event.before?.instanceId === source.instanceId && event.before.cardId === source.cardId && event.before.owner === identity.actor && event.before.controller === identity.actor &&
        event.after?.instanceId === source.instanceId && event.after.cardId === source.cardId && event.after.generation === source.generation && event.before.generation + 1 === source.generation, "v3-life-trigger-authorization");
    } else if (eventUse) {
      const event = eventUse.event;
      ensureMove(effect.kind === "activated" && source.kind === "event" && (mainUse ? (card.definition.schemaVersion === "3.0.0-subset.19" ? isSimpleMainEvent(effect) : ["3.0.0-subset.20", "3.0.0-subset.21", "3.0.0-subset.22", "3.0.0-subset.23", "3.0.0-subset.24", "3.0.0-subset.25", "3.0.0-subset.26", "3.0.0-subset.27", "3.0.0-subset.28", "3.0.0-subset.29", "3.0.0-subset.30", "3.0.0-subset.31", "3.0.0-subset.32", "3.0.0-subset.33", "3.0.0-subset.34", "3.0.0-subset.35", "3.0.0-subset.36", "3.0.0-subset.37", "3.0.0-subset.38", "3.0.0-subset.39", "3.0.0-subset.40", "3.0.0-subset.41", "3.0.0-subset.42", "3.0.0-subset.43", "3.0.0-subset.44", "3.0.0-subset.45", "3.0.0-subset.46", "3.0.0-subset.47", "3.0.0-subset.48", "3.0.0-subset.49", "3.0.0-subset.50", "3.0.0-subset.51"].includes(card.definition.schemaVersion) && (["3.0.0-subset.41", "3.0.0-subset.42", "3.0.0-subset.43", "3.0.0-subset.44", "3.0.0-subset.45", "3.0.0-subset.46", "3.0.0-subset.47", "3.0.0-subset.48", "3.0.0-subset.49", "3.0.0-subset.50", "3.0.0-subset.51"].includes(card.definition.schemaVersion) ? isShareableMainEvent(effect, ["3.0.0-subset.50", "3.0.0-subset.51"].includes(card.definition.schemaVersion)) : isInteractiveMainEvent(effect))) && !battle && checkTiming(progression, identity.actor, "mainEffect").allowed :
        effect.timing.type === "COUNTER" && battle?.step === "counter" && battle.battleId === options.counterEventCause!.battleId && battle.defender === identity.actor) &&
        at.zone === "trash" && event.kind === "moved" && event.from?.player === identity.actor && event.from.zone === "hand" && event.to?.player === identity.actor && event.to.zone === "trash" &&
        event.before?.kind === "event" && event.before.owner === identity.actor && event.before.controller === identity.actor && event.before.cardId === source.cardId && event.before.instanceId === source.instanceId &&
        event.after?.instanceId === source.instanceId && event.after.generation === source.generation && event.before.generation + 1 === source.generation && event.after.cardId === source.cardId, "v3-counter-event-authorization");
    } else if (trigger) {
      ensureMove(effect.kind === "triggered" && effect.timing.type === (boundary?.type ?? trigger.type), "v3-fixture-trigger-type");
      if (trigger.type === "ON_EVENT") {
        const record = trigger.observation;
        ensureMove(["3.0.0-subset.22", "3.0.0-subset.23", "3.0.0-subset.24", "3.0.0-subset.25", "3.0.0-subset.26", "3.0.0-subset.27", "3.0.0-subset.28", "3.0.0-subset.29", "3.0.0-subset.30", "3.0.0-subset.31", "3.0.0-subset.32", "3.0.0-subset.33", "3.0.0-subset.34", "3.0.0-subset.35", "3.0.0-subset.36", "3.0.0-subset.37", "3.0.0-subset.38", "3.0.0-subset.39", "3.0.0-subset.40", "3.0.0-subset.41", "3.0.0-subset.42", "3.0.0-subset.43", "3.0.0-subset.44", "3.0.0-subset.45", "3.0.0-subset.46", "3.0.0-subset.47", "3.0.0-subset.48", "3.0.0-subset.49", "3.0.0-subset.50", "3.0.0-subset.51"].includes(card.definition.schemaVersion) && isTriggerObservation(record) && record.result === true && record.status === "PENDING" &&
          record.key.length === 64 && record.eventId === trigger.eventId && record.context.effectController === identity.actor &&
          record.effectId === identity.effectId && record.source.instanceId === source.instanceId && record.source.generation === source.generation &&
          validateObservedSource(record, movement, new Map(definitions.map(card => [card.definition.cardId, card]))) === "CURRENT", "v3-fixture-observed-authorization");
        this.#occurrenceAuthorized = true;
      } else if (trigger.type === "ON_PLAY") {
        const event = trigger.event;
        ensureMove(event.kind === "moved" && event.eventId === trigger.eventId && event.from && event.to && event.from.zone !== event.to.zone &&
          event.to.player === identity.actor && event.to.zone === at.zone && event.after?.instanceId === source.instanceId && event.after.generation === source.generation && event.after.cardId === source.cardId, "v3-fixture-entry-authorization");
      } else if (trigger.type === "ON_KO") {
        const event = trigger.event;
        ensureMove(event.kind === "moved" && event.eventId === trigger.eventId && event.isKO && ["BATTLE_KO", "EFFECT_KO"].includes(event.cause.kind) && event.from?.zone === "character" && event.to?.zone === "trash" &&
          at.zone === "trash" && event.to.player === identity.actor && event.before?.kind === "character" && event.before.faceUp && event.before.owner === identity.actor && event.before.controller === identity.actor &&
          event.after?.instanceId === source.instanceId && event.after.generation === source.generation && event.before.generation + 1 === source.generation && event.after.cardId === source.cardId && event.before.cardId === source.cardId, "v3-fixture-ko-authorization");
      } else {
        ensureMove(battle?.step === "attack" && battle.battleId === trigger.battleId && battle.attacker === trigger.attacker && progression.turnNumber === trigger.turnNumber &&
        battle.source.instanceId === trigger.attackSource.instanceId && battle.source.generation === trigger.attackSource.generation &&
          (trigger.type === "ON_ATTACK" ? identity.actor === battle.attacker && source.instanceId === battle.source.instanceId && source.generation === battle.source.generation : identity.actor === battle.defender), "v3-fixture-attack-authorization");
        if (attackAttachmentMinimum(effect) !== null) {
          ensureMove(trigger.attachmentQualified === true, "v3-attack-attachment-occurrence-required");
          this.#occurrenceAuthorized = true;
        }
      }
    } else ensureMove(effect.kind === "activated" && effect.timing.type === "MAIN" && source.kind !== "event" && !battle, "v3-fixture-main-authorization");
    this.#checkEvents = options.checkEvents;
    this.#replacementUsage = new Set(options.replacementUsage);
    this.#usedEffect = options.usedEffect ?? (() => 0);
    this.#board = freezeMovement(structuredClone(movement)); this.#progression = freezeMovement(structuredClone(progression));
    if (definitions.some(card => ["3.0.0-subset.25", "3.0.0-subset.26", "3.0.0-subset.27", "3.0.0-subset.28", "3.0.0-subset.29", "3.0.0-subset.30", "3.0.0-subset.31", "3.0.0-subset.32", "3.0.0-subset.33", "3.0.0-subset.34", "3.0.0-subset.35", "3.0.0-subset.36", "3.0.0-subset.37", "3.0.0-subset.38", "3.0.0-subset.39", "3.0.0-subset.40", "3.0.0-subset.41", "3.0.0-subset.42", "3.0.0-subset.43", "3.0.0-subset.44", "3.0.0-subset.45", "3.0.0-subset.46", "3.0.0-subset.47", "3.0.0-subset.48", "3.0.0-subset.49", "3.0.0-subset.50", "3.0.0-subset.51"].includes(card.definition.schemaVersion) || card.definition.effects.some(effect => effect.timing.type === "ON_EVENT"))) trackMovementOccurrences(this.#board);
    this.#identity = freezeMovement(structuredClone(identity)); this.#card = card; this.#key = Uint8Array.from(options.signingKey); this.#now = options.now ?? Date.now;
    this.#facts = pinMasterFacts(movement, { master: options.master, numericPolicy: "certifiedUnmodified" });
    const sourceEvent = trigger && "event" in trigger ? trigger.event : eventUse?.event ?? lifeUse?.event;
    const origin: EventOrigin | undefined = sourceEvent ? { type: "movement", event: sourceEvent } : trigger && "battleId" in trigger ?
      { type: "attack", eventId: trigger.eventId, battleId: trigger.battleId, attacker: trigger.attacker } : undefined;
    this.#readContext = trigger?.type === "ON_EVENT" ? trigger.observation.context : readEventContext(this.#board, this.#identity, null, origin);
    this.#machine = new V3ResolutionMachine(card, this.#identity, this.#key, this.#environment(() => this.#board, () => this.#statEffects, () => this.#keywordGrants));
    this.#progression = applySystemEvent(this.#progression, this.#progression.revision, { kind: "beginResolution", resolutionId: identity.resolutionId, controller: identity.actor });
  }
  context(): FixtureContext { return { frameRevision: this.#machine.viewFor(this.#identity.actor).revision, movementRevision: this.#board.revision, progressionRevision: this.#progression.revision }; }
  readContextForCoordinator(): EventContext {
    return withEventChooser(this.#readContext, this.#machine.viewFor(this.#identity.actor).choice?.chooser ?? null);
  }
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
  #environment(board: () => MovementState, stats: () => StatEffects, keywords: () => KeywordGrants): ResolutionEnvironment {
    const environment = fixtureEnvironment(board, this.#identity, this.#card, this.#facts, this.#now, this.#definitions,
      stats, this.#progression.activePlayer, this.#counterPower, this.#readContext, keywords, this.#occurrenceAuthorized);
    if (this.#lifeTrigger && lifeSelfPlayProgram(this.#card.definition.effects.find(effect => effect.id === this.#identity.effectId)!.actions)) {
      const { source, actor } = this.#identity;
      const zone = this.#card.definition.cardType;
      ensureMove(zone === "character" || zone === "stage", "v3-trigger-play-zone");
      environment.lifeTriggerPlay = () => {
        const state = board(), card = state.cards[source.instanceId], at = location(state, source.instanceId);
        ensureMove(card?.kind === zone && card.cardId === this.#card.definition.cardId && card.faceUp && card.owner === actor &&
          card.controller === actor && at.player === actor, "v3-trigger-play-source");
        if (at.zone === zone && card.generation === source.generation + 1) return "PLAYED";
        ensureMove(at.zone === "resolving" && card.generation === source.generation, "v3-trigger-play-stale-source");
        return state.players[actor][zone].includes(null) ? "OPEN" : "FULL";
      };
    }
    if (!["3.0.0-subset.41", "3.0.0-subset.42", "3.0.0-subset.43", "3.0.0-subset.44", "3.0.0-subset.45", "3.0.0-subset.46", "3.0.0-subset.47", "3.0.0-subset.48", "3.0.0-subset.49", "3.0.0-subset.50", "3.0.0-subset.51"].includes(this.#card.definition.schemaVersion)) return environment;
    const definitions = new Map(this.#definitions.map(card => [card.definition.cardId, card]));
    return { ...environment,
      bodyCandidates: max => externalBodyChoices(board(), this.#identity.actor, max, definitions, this.#usedEffect),
      bindBody: ref => {
        const { definition, effect } = resolveExternalBody(board(), this.#identity.actor, ref, definitions);
        const identity = { ...this.#identity, effectId: effect.id, source: ref.source };
        return { effect, environment: fixtureEnvironment(board, identity, definition, this.#facts, this.#now, this.#definitions,
          stats, this.#progression.activePlayer, this.#counterPower, undefined, keywords) };
      }
    };
  }
  #run(actor: 0 | 1, requestId: string, expected: FixtureContext, body: object, action: (machine: V3ResolutionMachine, draft: WorkDraft) => void): { replayed: boolean } {
    ensureMove(process.env.NODE_ENV !== "production" && !this.#busy, "v3-fixture-disabled-or-busy"); label(requestId);
    ensureMove(actor === 0 || actor === 1, "v3-fixture-actor"); dataObject(expected, ["frameRevision", "movementRevision", "progressionRevision"]);
    const fingerprint = hash(JSON.stringify([actor, expected.frameRevision, expected.movementRevision, expected.progressionRevision, body]));
    const receipt = this.#receipts.find(receipt => receipt.requestId === requestId);
    if (receipt) { ensureMove(receipt.fingerprint === fingerprint, "v3-fixture-request-conflict"); return { replayed: true }; }
    const current = this.context(); ensureMove(this.#receipts.length < 512 && current.frameRevision === expected.frameRevision && current.movementRevision === expected.movementRevision && current.progressionRevision === expected.progressionRevision, "v3-fixture-stale-or-limited");
    this.#busy = true;
    try {
      const draft: WorkDraft = { board: this.#board, events: [...this.#events], statEffects: this.#statEffects, keywordGrants: this.#keywordGrants };
      const environment = this.#environment(() => draft.board, () => draft.statEffects, () => draft.keywordGrants);
      const machine = V3ResolutionMachine.restore(this.#card, this.#identity, this.#key, environment, this.#machine.exportForStorage(), current.frameRevision);
      action(machine, draft); let progression = this.#gate(draft.progression ?? this.#progression, machine);
      const outcome = deckOutOutcome(draft.board);
      if (outcome) progression = applySystemEvent(progression, progression.revision, { kind: "finishGame", winner: outcome.winner, reason: outcome.reason });
      const replacement = draft.replacement;
      this.#checkEvents?.(draft.events.slice(this.#events.length), replacement ? { resolutionId: replacement.candidateId, effectId: replacement.ruleId } : draft.effectBody);
      // Retain all candidate changes only after frame, movement and progression succeeded.
      this.#board = draft.board; this.#progression = progression; this.#machine = machine; this.#events = freezeMovement(draft.events); this.#statEffects = draft.statEffects; this.#keywordGrants = draft.keywordGrants;
      if (replacement) {
        this.#replacementTrace.push(freezeMovement(replacement));
        if (replacement.usageKey) this.#replacementUsage.add(replacement.usageKey);
      }
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
      const external = machine.externalBodyForCoordinator(), identity = external?.identity ?? this.#identity;
      let candidate: AppliedWork | { replacement: readonly ReplacementPlan[] };
      try { candidate = this.#applyWork(draft.board, work, draft.statEffects, draft.keywordGrants, machine.replacementForCoordinator(), identity); }
      catch (error) {
        if (!(error instanceof MovementError)) throw error;
        machine.settleWork(requestId, expected.frameRevision, work.workId, "rejected", draft.board.revision); return;
      }
      if ("replacement" in candidate) {
        machine.offerReplacement(requestId, expected.frameRevision, candidate.replacement); return;
      }
      const result = ["3.0.0-subset.25", "3.0.0-subset.26", "3.0.0-subset.27", "3.0.0-subset.28", "3.0.0-subset.29", "3.0.0-subset.30", "3.0.0-subset.31", "3.0.0-subset.32", "3.0.0-subset.33", "3.0.0-subset.34", "3.0.0-subset.35", "3.0.0-subset.36", "3.0.0-subset.37", "3.0.0-subset.38", "3.0.0-subset.39", "3.0.0-subset.40", "3.0.0-subset.41", "3.0.0-subset.42", "3.0.0-subset.43", "3.0.0-subset.44", "3.0.0-subset.45", "3.0.0-subset.46", "3.0.0-subset.47", "3.0.0-subset.48", "3.0.0-subset.49", "3.0.0-subset.50", "3.0.0-subset.51"].includes(this.#card.definition.schemaVersion) && (work.type === "MOVE_CARD" || work.type === "PLAY_BY_EFFECT" && work.from === "hand" && work.destination.slotPolicy === "FIRST_EMPTY" || work.type === "MOVE_LIFE") ? captureMoveResult(draft.board, candidate, identity, work.workId, work.cards,
        (state, ref, viewer) => createDerivedCardFactsReader({ board: () => state, definitions: new Map(this.#definitions.map(card => [card.definition.cardId, card])),
          master: this.#facts, statEffects: () => draft.statEffects, keywordGrants: () => draft.keywordGrants, activePlayer: this.#progression.activePlayer, counterPower: this.#counterPower })(ref, viewer), ["3.0.0-subset.26", "3.0.0-subset.27", "3.0.0-subset.28", "3.0.0-subset.29", "3.0.0-subset.30", "3.0.0-subset.31", "3.0.0-subset.32", "3.0.0-subset.33", "3.0.0-subset.34", "3.0.0-subset.35", "3.0.0-subset.36", "3.0.0-subset.37", "3.0.0-subset.38", "3.0.0-subset.39", "3.0.0-subset.40", "3.0.0-subset.41", "3.0.0-subset.42", "3.0.0-subset.43", "3.0.0-subset.44", "3.0.0-subset.45", "3.0.0-subset.46", "3.0.0-subset.47", "3.0.0-subset.48", "3.0.0-subset.49", "3.0.0-subset.50", "3.0.0-subset.51"].includes(this.#card.definition.schemaVersion), candidate.replaced) : undefined;
      draft.board = candidate.state; draft.events.push(...candidate.events);
      if (candidate.progression) draft.progression = candidate.progression;
      const bodyEffectId = machine.bodyEffectForCoordinator();
      if (bodyEffectId && work.type !== "FINISH_LIFE_TRIGGER" && work.type !== "CLOSE_REVEALS")
        draft.effectBody = { resolutionId: this.#identity.resolutionId, effectId: bodyEffectId };
      if (candidate.replaced && candidate.replacementMove) {
        const { intent, candidateId, ruleId, cause, usageKey } = candidate.replaced;
        draft.replacement = { intent, candidateId, ruleId, cause, operation: candidate.replacementMove, ...(usageKey ? { usageKey } : {}) };
      }
      draft.statEffects = pruneStatEffects(candidate.state, candidate.statEffects ?? draft.statEffects);
      draft.keywordGrants = pruneKeywordGrants(candidate.state, candidate.keywordGrants ?? draft.keywordGrants);
      ensureMove(draft.events.length <= 512, "v3-fixture-event-limit");
      machine.settleWork(requestId, expected.frameRevision, work.workId, "applied", candidate.state.revision, result);
      if (deckOutOutcome(candidate.state)) machine.finishForGameOutcome(machine.viewFor(actor).revision, candidate.state.revision);
    });
  }
  #applyWork(board: MovementState, work: WorkRequest, statEffects: StatEffects, keywordGrants: KeywordGrants, answer: ReplacementAnswer | null,
    identity: ResolutionIdentity): AppliedWork | { replacement: readonly ReplacementPlan[] } {
    ensureMove(work.worldRevision === board.revision, "v3-fixture-stale-work");
    const actor = identity.actor, operations: MovementOperation[] = [];
    const definitions = new Map(this.#definitions.map(card => [card.definition.cardId, card]));
    const activePlayer = this.#progression.activePlayer;
    let slotEvents: readonly MovementEvent[] = [];
    if (work.type === "RETARGET_BATTLE" || work.type === "EXTRA_TURN") {
      let progression: Progression;
      if (work.type === "EXTRA_TURN") {
        const source = getCard(board, identity.source), from = location(board, source.instanceId);
        const effect = this.#card.definition.effects.find(effect => effect.id === identity.effectId);
        ensureMove(["3.0.0-subset.44", "3.0.0-subset.45", "3.0.0-subset.46", "3.0.0-subset.47", "3.0.0-subset.48", "3.0.0-subset.49", "3.0.0-subset.50", "3.0.0-subset.51"].includes(this.#card.definition.schemaVersion) && effect?.timing.type === "ON_PLAY" &&
          source.cardId === this.#card.definition.cardId && source.kind === "character" && from.zone === "character" &&
          from.player === actor && source.owner === actor && source.controller === actor && source.faceUp &&
          board.matchId === identity.matchId && board.turnNumber === this.#progression.turnNumber, "v3-extra-turn-source");
        try {
          progression = applySystemEvent(this.#progression, this.#progression.revision, { kind: "reserveExtraTurn", actor, turnNumber: board.turnNumber,
            resolutionId: identity.resolutionId });
        } catch (error) {
          if (!(error instanceof ProgressionError)) throw error;
          throw new MovementError("v3-extra-turn-unavailable");
        }
      } else {
        ensureMove(work.cards.length === 1 && ["3.0.0-subset.42", "3.0.0-subset.43", "3.0.0-subset.44", "3.0.0-subset.45", "3.0.0-subset.46", "3.0.0-subset.47", "3.0.0-subset.48", "3.0.0-subset.49", "3.0.0-subset.50", "3.0.0-subset.51"].includes(this.#card.definition.schemaVersion), "v3-battle-retarget-single");
        const timing = this.#card.definition.effects.find(effect => effect.id === identity.effectId)?.timing.type;
        ensureMove(timing, "v3-battle-retarget-timing");
        progression = retargetBattle(board, this.#progression, identity, timing, work.cards[0]!, definitions);
      }
      const result = new MovementStore(board).commit({ transactionId: hash(`${board.matchId}:${work.workId}`), matchId: board.matchId, expectedRevision: board.revision,
        turnNumber: board.turnNumber, actor, effectController: actor, source: identity.source, mode: "effect", resolutionId: identity.resolutionId,
        operations: [] }, { status: "certifiedNone" });
      return { ...result, progression };
    }
    const inspected = (ref: Readonly<{ instanceId: string; generation: number }>) => board.reveals.some(grant => grant.scopeId === identity.resolutionId &&
      grant.card.instanceId === ref.instanceId && grant.card.generation === ref.generation && grant.viewers.includes(actor));
    if (work.type === "MODIFY_STAT" || work.type === "GRANT_KEYWORD") {
      const battleId = this.#progression.battle?.battleId ?? null;
      const anchor = work.duration.type === "UNTIL_BOUNDARY" ? applicationAnchor(board, this.#progression) : undefined;
      const read = hasProtection(definitions) ? protectionReader(board, definitions, activePlayer) : null;
      const targets = read ? work.cards.filter(ref => {
        const immunity = read(ref, actor, "UNAFFECTED_BY");
        ensureMove(immunity !== "unknown", "v3-protection-unknown");
        return !immunity;
      }) : work.cards;
      const next = !targets.length ? {} : work.type === "MODIFY_STAT" ? { statEffects: addStatEffects(board, statEffects, work.workId, identity.source, actor, targets, work.stat, work.amount, work.duration, this.#definitions, battleId, anchor) } :
        { keywordGrants: addKeywordGrants(board, keywordGrants, work.workId, identity.source, actor, targets, work.keyword, work.duration, this.#definitions, battleId, anchor) };
      const result = new MovementStore(board).commit({ transactionId: hash(`${board.matchId}:${work.workId}`), matchId: board.matchId, expectedRevision: board.revision,
        turnNumber: board.turnNumber, actor, effectController: actor, source: identity.source, mode: "effect", resolutionId: identity.resolutionId, operations: [] }, { status: "certifiedNone" });
      return { ...result, ...next };
    } else if (work.type === "PAY_COSTS") {
      let amount = 0, discardCount = 0, restSource = 0;
      const filtered = activationCostSelector(work.costs), moveSource = movesActivationSource(work.costs), picked = work.selected ?? [];
      if (work.duringEffect || filtered || moveSource) {
        const environment = fixtureEnvironment(() => board, identity, this.#card, this.#facts, this.#now, this.#definitions, () => statEffects, this.#progression.activePlayer, this.#counterPower, identity === this.#identity ? this.#readContext : undefined, () => keywordGrants, this.#occurrenceAuthorized);
        ensureMove(picked.length === (filtered?.min ?? 0) && environment.canPayCosts?.(work.costs, work.discarded, work.returned, picked) === true, "v3-fixture-unpayable");
      }
      const returnCosts = work.costs.filter(cost => cost.type === "DON_RETURN"), returnCost = returnCosts[0], returnCount = returnCost?.count ?? 0;
      ensureMove(returnCosts.length <= 1, "v3-fixture-multiple-don-return-costs");
      for (const cost of work.costs) {
        if (cost.type === "REST_DON") amount += cost.count;
        else if (cost.type === "DISCARD_HAND") discardCount += cost.count;
        else if (cost.type === "REST_SOURCE") restSource++;
        else if (cost.type === "DON_RETURN" || cost.type === "REVEAL_CARDS" || cost.type === "MOVE_AS_COST") continue;
        else ensureMove(false, "v3-fixture-unsupported-cost");
      }
      const returned = new Set(work.returned.map(ref => ref.instanceId));
      const activeDon = board.players[actor].activeDon.filter(id => !returned.has(id!));
      const operationCount = amount + discardCount + restSource + returnCount + picked.length + Number(moveSource);
      ensureMove(Number.isSafeInteger(operationCount) && operationCount > 0 && operationCount <= 64 && restSource <= 1 && activeDon.length >= amount &&
        returned.size === returnCount && work.returned.length === returnCount &&
        work.discarded.length === discardCount && new Set(work.discarded.map(ref => ref.instanceId)).size === discardCount, "v3-fixture-unpayable");
      if (restSource) {
        const card = getCard(board, identity.source), at = location(board, card.instanceId);
        ensureMove(!card.rotated && card.faceUp && card.owner === actor && card.controller === actor && at.player === actor &&
          ["leader", "character", "stage"].includes(at.zone) && card.kind === at.zone && visibleTo(board, card, at, 0) && visibleTo(board, card, at, 1), "v3-fixture-source-cost-unavailable");
        operations.push({ kind: "setRest", card: identity.source, rotated: true });
      }
      for (const id of activeDon.slice(0, amount)) {
        const card = board.cards[id!]!; ensureMove(card.kind === "don" && card.owner === actor && card.controller === actor && !card.rotated, "v3-fixture-don-unavailable");
        operations.push({ kind: "setRest", card: { instanceId: card.instanceId, generation: card.generation }, rotated: true });
      }
      const reveal = work.costs.some(cost => cost.type === "REVEAL_CARDS");
      for (const ref of [...work.discarded, ...(reveal ? [] : picked)]) operations.push(handDiscardOperation(board, actor, ref, "COST_PAYMENT"));
      for (const ref of work.returned) {
        const card = getCard(board, ref), from = location(board, ref.instanceId);
        ensureMove(returnCost && returnCost.from.some(zone => zone === from.zone) && from.player === actor && card.kind === "don" && card.owner === actor && card.controller === actor && card.faceUp &&
          visibleTo(board, card, from, 0) && visibleTo(board, card, from, 1), "v3-fixture-return-cost-unavailable");
        operations.push({ kind: "move", card: ref, from, to: { player: actor, zone: "donDeck", position: "bottom", faceUp: false, rotated: false }, cause: "COST_PAYMENT" });
      }
      if (moveSource) operations.push({ kind: "move", card: identity.source, from: location(board, identity.source.instanceId), to: { player: actor, zone: "trash", position: "append", faceUp: true, rotated: false }, cause: "COST_PAYMENT" });
      if (reveal) for (const ref of picked) operations.push({ kind: "reveal", card: ref, scopeId: identity.resolutionId, viewers: [0, 1] });
    } else if (work.type === "SHUFFLE_DECK") {
      ensureMove(this.#card.definition.schemaVersion === "3.0.0-subset.51", "v3-shuffle-deck-policy");
      const cards = board.players[actor].deck.map(id => {
        const card = id === null ? undefined : board.cards[id];
        ensureMove(card && card.owner === actor && card.controller === actor && !card.faceUp, "v3-shuffle-deck-card");
        return { instanceId: card.instanceId, generation: card.generation };
      });
      for (let i = cards.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [cards[i], cards[j]] = [cards[j]!, cards[i]!];
      }
      operations.push({ kind: "reorder", location: { player: actor, zone: "deck" }, cards, conceal: true });
    } else if (work.type === "TRASH_DECK_TOP") {
      ensureMove(["3.0.0-subset.50", "3.0.0-subset.51"].includes(this.#card.definition.schemaVersion) &&
        Number.isSafeInteger(work.count) && work.count >= 1 && work.count <= 50, "v3-trash-deck-top-policy");
      for (const id of board.players[actor].deck.slice(0, work.count)) {
        const card = id === null ? undefined : board.cards[id];
        ensureMove(card && card.owner === actor && card.controller === actor && ["character", "stage", "event"].includes(card.kind), "v3-trash-deck-top-card");
        operations.push({ kind: "move", card: { instanceId: card.instanceId, generation: card.generation },
          from: { player: actor, zone: "deck" }, to: { player: actor, zone: "trash", position: "append", faceUp: true, rotated: false }, cause: "EFFECT_MOVE" });
      }
    } else if (work.type === "LOOK_TOP") {
      ensureMove(work.cards.length > 0 && work.cards.length <= 50 && work.cards.every((ref, index) => board.players[actor].deck[index] === ref.instanceId), "v3-fixture-look-top-only");
      for (const ref of work.cards) {
        const card = getCard(board, ref), from = location(board, card.instanceId);
        ensureMove(from.player === actor && from.zone === "deck" && card.owner === actor && card.controller === actor && ["character", "stage", "event"].includes(card.kind), "v3-fixture-look-owner-or-kind");
        const opponent = (1 - actor) as 0 | 1;
        const alreadyPublic = board.reveals.some(grant => grant.scopeId === identity.resolutionId && grant.card.instanceId === ref.instanceId && grant.card.generation === ref.generation && grant.viewers.includes(opponent));
        operations.push({ kind: "reveal", card: ref, scopeId: identity.resolutionId, viewers: alreadyPublic ? [0, 1] : [actor] });
      }
    } else if (work.type === "REVEAL") {
      ensureMove(work.cards.length > 0 && work.cards.length <= 50, "v3-fixture-reveal-count");
      for (const ref of work.cards) {
        const card = getCard(board, ref), from = location(board, card.instanceId);
        if (work.playSlot) ensureMove(["3.0.0-subset.50", "3.0.0-subset.51"].includes(this.#card.definition.schemaVersion) && work.cards.length === 1 &&
          (from.zone === "hand" || from.zone === "deck" && this.#card.definition.schemaVersion === "3.0.0-subset.51") &&
          !board.players[actor].character.includes(null) && card.kind === "character" &&
          definitions.get(card.cardId)?.definition.cardType === "character", "v3-effect-play-reveal-policy");
        ensureMove(from.player === actor && card.owner === actor && card.controller === actor && ["character", "stage", "event"].includes(card.kind) &&
          (from.zone === "hand" || from.zone === "deck" && inspected(ref)) && visibleTo(board, card, from, actor), "v3-fixture-reveal-uninspected-card");
        operations.push({ kind: "reveal", card: ref, scopeId: identity.resolutionId, viewers: [0, 1] });
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
    } else if (work.type === "FINISH_LIFE_TRIGGER") {
      const source = getCard(board, identity.source), at = location(board, source.instanceId);
      ensureMove(this.#lifeTrigger && at.player === actor && at.zone === "resolving" && source.owner === actor && source.controller === actor, "v3-life-trigger-cleanup-source");
      operations.push({ kind: "move", card: identity.source, from: at, to: { player: actor, zone: "trash", position: "append", faceUp: true, rotated: false }, cause: "OTHER" });
    } else if (work.type === "CLOSE_REVEALS") {
      operations.push({ kind: "closeReveals", scopeId: identity.resolutionId });
    } else if (work.type === "DRAW") {
      for (const id of board.players[work.player].deck.slice(0, work.count)) {
        const card = board.cards[id!]!;
        operations.push({ kind: "move", card: { instanceId: card.instanceId, generation: card.generation }, from: { player: work.player, zone: "deck" }, to: { player: work.player, zone: "hand", position: "append", faceUp: true, rotated: false }, cause: "EFFECT_MOVE" });
      }
    } else if (work.type === "ATTACH_DON" || work.type === "RETURN_DON_BY_EFFECT") {
      const attach = work.type === "ATTACH_DON";
      const refs = attach ? work.assignments.map(row => row.card) : work.cards;
      ensureMove(refs.length > 0 && refs.length <= 10 && new Set(refs.map(ref => ref.instanceId)).size === refs.length, "v3-fixture-don-transfer-count");
      const allowed = attach ? (work.from === "ACTIVE" ? ["activeDon"] : work.from === "REST" ? ["restDon"] : []) : work.from;
      ensureMove(allowed.length > 0 && new Set(allowed).size === allowed.length && allowed.every(zone => ["activeDon", "restDon", "attachedDon"].includes(zone)), "v3-fixture-don-transfer-zones");
      const fieldTarget = (ref: Readonly<{ instanceId: string; generation: number }>) => {
        const card = getCard(board, ref), at = location(board, card.instanceId);
        ensureMove(at.player === actor && card.owner === actor && card.controller === actor && card.faceUp &&
          (at.zone === "leader" || at.zone === "character") && card.kind === at.zone, "v3-fixture-don-attachment-target");
      };
      for (const [i, ref] of refs.entries()) {
        const card = getCard(board, ref), from = location(board, ref.instanceId);
        ensureMove(card.kind === "don" && from.player === actor && card.owner === actor && card.controller === actor && card.faceUp &&
          allowed.some(zone => zone === from.zone) && card.rotated === (from.zone === "restDon") &&
          (from.zone === "attachedDon" ? card.attachedTo !== null : card.attachedTo === null), "v3-fixture-don-transfer-source");
        if (attach) {
          const target = work.assignments[i]!.target;
          fieldTarget(target);
          operations.push({ kind: "attachDon", card: ref, target, from: work.from === "REST" ? "restDon" : "activeDon" });
        } else {
          if (card.attachedTo) fieldTarget(card.attachedTo);
          operations.push({ kind: "move", card: ref, from, to: { player: actor, zone: "donDeck", position: "bottom", faceUp: false, rotated: false }, cause: "EFFECT_MOVE" });
        }
      }
    } else if (work.type === "SET_DON_STATE") {
      ensureMove((work.from === "ACTIVE" || work.from === "REST") && (work.to === "ACTIVE" || work.to === "REST") && work.from !== work.to &&
        work.cards.length > 0 && work.cards.length <= 10 && new Set(work.cards.map(ref => ref.instanceId)).size === work.cards.length, "v3-fixture-don-state-policy");
      for (const ref of work.cards) {
        const card = getCard(board, ref), at = location(board, ref.instanceId);
        ensureMove(at.player === actor && at.zone === (work.from === "REST" ? "restDon" : "activeDon") &&
          card.kind === "don" && card.owner === actor && card.controller === actor && card.attachedTo === null &&
          card.faceUp && card.rotated === (work.from === "REST"), "v3-fixture-don-state-source");
        operations.push({ kind: "setRest", card: ref, rotated: work.to === "REST" });
      }
    } else if (work.type === "ADD_DON") {
      ensureMove(work.player === actor && (work.state === "ACTIVE" || work.state === "REST") && work.onInsufficient === "fail" &&
        Number.isSafeInteger(work.count) && work.count >= 1 && work.count <= 10, "v3-fixture-don-add-policy");
      const deck = board.players[actor].donDeck;
      ensureMove(deck.length >= work.count, "v3-fixture-don-add-insufficient");
      for (const id of deck.slice(0, work.count)) {
        const card = id === null ? undefined : board.cards[id];
        ensureMove(card?.kind === "don" && card.owner === actor && card.controller === actor && card.attachedTo === null && !card.faceUp && !card.rotated, "v3-fixture-don-add-source");
        operations.push({ kind: "move", card: { instanceId: card.instanceId, generation: card.generation }, from: { player: actor, zone: "donDeck" },
          to: { player: actor, zone: work.state === "REST" ? "restDon" : "activeDon", position: "append", faceUp: true, rotated: work.state === "REST" }, cause: "EFFECT_MOVE" });
      }
    } else if (work.type === "PLAY_BY_EFFECT") {
      const zone = work.destination.zone;
      const replaceIfFull = work.destination.slotPolicy === "REPLACE_IF_FULL";
      ensureMove(work.from !== "trash" || ["3.0.0-subset.50", "3.0.0-subset.51"].includes(this.#card.definition.schemaVersion), "v3-trash-effect-play-profile");
      ensureMove(work.from !== "deck" || this.#card.definition.schemaVersion === "3.0.0-subset.51" && replaceIfFull &&
        work.cards.every(inspected), "v3-effect-play-uninspected-deck");
      ensureMove(!replaceIfFull || ["3.0.0-subset.50", "3.0.0-subset.51"].includes(this.#card.definition.schemaVersion) && work.from !== "resolving" && work.cards.length === 1,
        "v3-effect-play-replacement-policy");
      ensureMove(work.provenance === "EFFECT" && work.destination.owner === "SELF" && (zone === "character" || work.from === "resolving" && zone === "stage") &&
        (work.enterState === "ACTIVE" || work.enterState === "REST") && work.cards.length > 0 && work.cards.length <= 5 && new Set(work.cards.map(ref => ref.instanceId)).size === work.cards.length, "v3-fixture-effect-play-policy");
      if (work.from === "resolving") {
        const [ref] = work.cards;
        ensureMove(this.#lifeTrigger && this.#card.definition.cardType === zone && work.cards.length === 1 && work.enterState === "ACTIVE" &&
          ref?.instanceId === identity.source.instanceId && ref.generation === identity.source.generation &&
          lifeSelfPlayProgram(this.#card.definition.effects.find(effect => effect.id === identity.effectId)!.actions) &&
          this.#progression.battle?.step === "damage" && this.#progression.battle.defender === actor, "v3-trigger-play-authorization");
      }
      if (work.from === "resolving" || replaceIfFull) {
        ensureMove(!!work.replace === !board.players[actor][zone].includes(null), "v3-trigger-play-slot-changed");
        if (work.replace) {
          const old = getCard(board, work.replace), at = location(board, old.instanceId);
          ensureMove(at.zone === zone && at.player === actor && old.kind === zone && old.owner === actor &&
            old.controller === actor && old.faceUp, "v3-trigger-play-invalid-slot");
          // Stage the rule trash privately. Neither revision is published unless the subsequent effect move succeeds.
          const freed = new MovementStore(board).commit({ transactionId: hash(`${board.matchId}:${work.workId}:slot`), matchId: board.matchId,
            expectedRevision: board.revision, turnNumber: board.turnNumber, actor, effectController: null, source: null,
            mode: "rule", resolutionId: identity.resolutionId, operations: [{ kind: "move", card: work.replace, from: at,
              to: { player: actor, zone: "trash", position: "append", faceUp: true, rotated: false }, cause: "RULE_PROCESSING" }] }, { status: "certifiedNone" });
          board = freed.state; slotEvents = freed.events;
        }
      }
      ensureMove(board.players[actor][zone].filter(id => id === null).length >= work.cards.length, "v3-fixture-effect-play-no-empty-slot");
      for (const ref of work.cards) {
        const card = getCard(board, ref), from = location(board, card.instanceId), definition = this.#definitions.find(d => d.definition.cardId === card.cardId);
        ensureMove(from.player === actor && from.zone === work.from && card.kind === zone && card.owner === actor && card.controller === actor &&
          definition?.definition.cardType === zone && visibleTo(board, card, from, actor), "v3-fixture-effect-play-card-policy");
        operations.push({ kind: "move", card: ref, from, to: { player: actor, zone, position: "firstEmpty", faceUp: true, rotated: work.enterState === "REST" }, cause: "EFFECT_MOVE" });
      }
    } else if (work.type === "DISCARD_BY_OWNER" || work.type === "ORDER_THEN_MOVE") {
      const rows = ownerHandCandidates(board, actor, work.owner);
      const generations = new Map(rows.map(row => [row.ref.instanceId, row.ref.generation]));
      ensureMove(Number.isSafeInteger(work.count) && work.count >= 1 && work.count <= 50 && work.cards.length > 0 &&
        work.cards.length === Math.min(work.count, rows.length) && new Set(work.cards.map(ref => ref.instanceId)).size === work.cards.length &&
        work.cards.every(ref => generations.get(ref.instanceId) === ref.generation), "v3-owner-hand-stale-work");
      const destination = work.type === "ORDER_THEN_MOVE" ?
        { player: work.owner, zone: "deck", position: "bottom", faceUp: false, rotated: false } as const :
        { player: work.owner, zone: "trash", position: "append", faceUp: true, rotated: false } as const;
      for (const ref of work.cards) operations.push({ kind: "move", card: ref, from: { player: work.owner, zone: "hand" },
        to: destination, cause: "EFFECT_MOVE" });
    } else if (work.type === "MOVE_LIFE") {
      ensureMove(["3.0.0-subset.43", "3.0.0-subset.44", "3.0.0-subset.45", "3.0.0-subset.46", "3.0.0-subset.47", "3.0.0-subset.48", "3.0.0-subset.49", "3.0.0-subset.50", "3.0.0-subset.51"].includes(this.#card.definition.schemaVersion) && work.cards.length === 1, "v3-life-work-scope");
      const ref = work.cards[0]!, card = getCard(board, ref), from = location(board, card.instanceId);
      const zones = board.players[work.player], toLife = work.to === "LIFE_TOP" || work.to === "LIFE_BOTTOM";
      ensureMove(from.player === work.player && card.owner === work.player && card.controller === work.player &&
        ["character", "event", "stage"].includes(card.kind), "v3-life-work-owner");
      if (work.from === "BOUND") {
        const publicSource = ["character", "stage", "trash", "public"].includes(from.zone) && card.faceUp &&
          visibleTo(board, card, from, 0) && visibleTo(board, card, from, 1);
        const ownKnown = work.player === actor && (from.zone === "hand" || (from.zone === "deck" && inspected(ref))) &&
          visibleTo(board, card, from, actor);
        ensureMove(toLife && (publicSource || ownKnown), "v3-life-work-visibility");
      } else if (work.from === "DECK_TOP") {
        ensureMove(toLife && from.zone === "deck" && zones.deck[0] === ref.instanceId, "v3-life-work-top-deck");
      } else {
        ensureMove(!toLife && from.zone === "life" && (work.from === "LIFE_TOP" ? zones.life[0] : zones.life.at(-1)) === ref.instanceId,
          "v3-life-work-endpoint");
      }
      const zone = toLife ? "life" : work.to === "HAND" ? "hand" : work.to === "TRASH" ? "trash" : "deck";
      const position = work.to === "LIFE_TOP" ? "top" : zone === "hand" || zone === "trash" ? "append" : "bottom";
      operations.push({ kind: "move", card: ref, from, to: { player: work.player, zone, position, faceUp: work.faceUp, rotated: false }, cause: "EFFECT_MOVE" });
    } else if (work.type === "MOVE_CARD") {
      const destination = work.destination;
      ensureMove(work.cards.length > 0 && work.cards.length <= 50 && (destination.zone !== "deck" || work.cards.length === 1), "v3-fixture-move-count-or-order");
      for (const ref of work.cards) {
        const card = getCard(board, ref), from = location(board, card.instanceId);
        const player = destination.owner === "CARD_OWNER" ? card.owner : destination.owner === "SELF" ? actor : (1 - actor) as 0 | 1;
        const publicSource = ["character", "stage", "trash", "public"].includes(from.zone) && card.faceUp && visibleTo(board, card, from, 0) && visibleTo(board, card, from, 1);
        ensureMove(destination.owner !== "CARD_OWNER" || publicSource && (from.zone === "character" || from.zone === "stage"), "v3-owner-destination-field-only");
        const ownHand = from.zone === "hand" && from.player === actor && card.owner === actor && card.controller === actor && visibleTo(board, card, from, actor);
        const lookedDeck = from.zone === "deck" && from.player === actor && card.owner === actor && card.controller === actor && inspected(ref) && visibleTo(board, card, from, actor);
        ensureMove(!work.inspectedOnly || lookedDeck && destination.owner === "SELF" && destination.zone === "trash", "v3-move-remainder-uninspected");
        ensureMove(!lookedDeck || destination.zone !== "deck", "v3-fixture-deck-order-command-required");
        ensureMove(card.owner === player && ["character", "stage", "event"].includes(card.kind) && (publicSource || ownHand || lookedDeck), "v3-fixture-illegal-move");
        operations.push({ kind: "move", card: ref, from, to: { player, zone: destination.zone, position: destination.position, faceUp: destination.faceUp, rotated: false }, cause: "EFFECT_MOVE" });
      }
    } else {
      ensureMove(work.cards.length > 0 && work.cards.length <= 50, "v3-fixture-field-action-count");
      for (const ref of work.cards) {
        const card = getCard(board, ref), from = location(board, card.instanceId);
        ensureMove(card.faceUp && visibleTo(board, card, from, 0) && visibleTo(board, card, from, 1), "v3-fixture-field-action-visibility");
        if (work.type === "KO" || work.type === "KO_STAGE") {
          const zone = work.type === "KO" ? "character" : "stage";
          ensureMove(card.kind === zone && from.zone === zone && (zone !== "stage" || ["3.0.0-subset.43", "3.0.0-subset.44", "3.0.0-subset.45", "3.0.0-subset.46", "3.0.0-subset.47", "3.0.0-subset.48", "3.0.0-subset.49", "3.0.0-subset.50", "3.0.0-subset.51"].includes(this.#card.definition.schemaVersion)),
            zone === "stage" ? "v3-fixture-ko-stage-only" : "v3-fixture-ko-character-only");
          operations.push({ kind: "move", card: ref, from, to: { player: card.owner, zone: "trash", position: "append", faceUp: true, rotated: false }, cause: "EFFECT_KO" });
        } else {
          ensureMove(["REST", "SET_ACTIVE"].includes(work.type) && ["leader", "character", "stage"].includes(from.zone) && card.kind === from.zone, "v3-fixture-rest-field-only");
          operations.push({ kind: "setRest", card: ref, rotated: work.type === "REST" });
        }
      }
    }
    const replacementEnvironment = (effectId: string, definition: ApprovedV3Card, chooser: 0 | 1, source: ResolutionIdentity["source"]) =>
      fixtureEnvironment(() => board, { ...identity, effectId, actor: chooser, source }, definition, this.#facts,
        this.#now, this.#definitions, () => statEffects, activePlayer, this.#counterPower, undefined, () => keywordGrants);
    const plans = work.type === "KO" || work.type === "KO_STAGE" || work.type === "MOVE_CARD" || work.type === "MOVE_LIFE" ?
      planReplacements(board, work.workId, identity, operations, definitions, activePlayer, replacementEnvironment,
        key => this.#replacementUsage.has(key)) : [];
    const plan = answer && plans.find(row => row.candidateId === answer.plan.candidateId);
    if (answer) ensureMove(plan && JSON.stringify(plan) === JSON.stringify(answer.plan), "v3-replacement-stale-intent");
    else if (plans.length) return { replacement: plans };
    if (plan && answer?.decision === "accepted") {
      let replacementMove = plan.substitute;
      if (plan.payment) {
        const ref = answer.paymentCard, source = plan.cause.source;
        ensureMove(source, "v3-replacement-source-required");
        const definition = definitions.get(getCard(board, source).cardId);
        const cost = plan.payment.cost;
        ensureMove(definition && ref && plan.payment.candidates !== "unknown" && plan.payment.candidates.some(row =>
          row.ref.instanceId === ref.instanceId && row.ref.generation === ref.generation) &&
          replacementEnvironment(plan.ruleId, definition, plan.chooser, source).canPayCosts?.([cost], [],
            cost.type === "DON_RETURN" ? [ref] : [], cost.type === "MOVE_AS_COST" ? [ref] : []) === true,
        "v3-replacement-payment-unavailable");
        replacementMove = cost.type === "DON_RETURN" ? { kind: "move", card: ref, from: location(board, ref.instanceId),
          to: { player: plan.chooser, zone: "donDeck", position: "bottom", faceUp: false, rotated: false }, cause: "EFFECT_MOVE" } :
          handDiscardOperation(board, plan.chooser, ref, "EFFECT_MOVE");
      }
      ensureMove(replacementMove, "v3-replacement-operation-required");
      const result = new MovementStore(board).commit({ transactionId: plan.candidateId, matchId: board.matchId, expectedRevision: board.revision,
        turnNumber: board.turnNumber, actor: plan.chooser, effectController: plan.chooser, source: plan.cause.source,
        mode: "effect", resolutionId: plan.candidateId, operations: [replacementMove] }, protectionRules(board, definitions, activePlayer, "effect"));
      verifyReplacementOutcome(board, result, plan, plan.payment ? replacementMove : undefined);
      return { ...result, replaced: plan, replacementMove };
    }
    const endsGame = ([0, 1] as const).some(player => {
      const leaving = operations.filter(operation => operation.kind === "move" && operation.from.player === player && operation.from.zone === "deck" && (operation.to.player !== player || operation.to.zone !== "deck")).length;
      const entering = operations.filter(operation => operation.kind === "move" && operation.to.player === player && operation.to.zone === "deck" && (operation.from.player !== player || operation.from.zone !== "deck")).length;
      return board.players[player].deck.length - leaving + entering === 0;
    });
    if (endsGame) operations.push({ kind: "closeReveals", scopeId: identity.resolutionId });
    const mode = work.type === "PAY_COSTS" ? "cost" : "effect";
    const result = new MovementStore(board).commit({ transactionId: hash(`${board.matchId}:${work.workId}`), matchId: board.matchId, expectedRevision: board.revision,
      turnNumber: board.turnNumber, actor, effectController: actor, source: identity.source, mode, resolutionId: identity.resolutionId, operations }, protectionRules(board, definitions, activePlayer, mode));
    if (slotEvents.length) {
      ensureMove(!result.prevented.length, "v3-trigger-play-slot-not-committed");
      return { ...result, events: [...slotEvents, ...result.events] };
    }
    return result;
  }
  viewFor(viewer: 0 | 1) {
    return freezeMovement({ frame: this.#machine.viewFor(viewer), movement: projectV3Movement(this.#board, viewer), outcome: this.#progression.outcome, progression: {
      revision: this.#progression.revision, gate: this.#progression.gate.kind, chooser: this.#progression.gate.kind === "choice" ? this.#progression.gate.chooser : null } });
  }
  replacementUsageForCoordinator(): readonly string[] { return [...this.#replacementUsage]; }
  bodyUsageKeyForCoordinator(): string | null {
    const body = this.#machine.externalBodyForCoordinator();
    return body?.limited ? effectUsageKey(this.#board.turnNumber, body.identity.actor, body.identity.source, body.identity.effectId) : null;
  }
  replacementTraceForCoordinator(): readonly ReplacementTrace[] { return [...this.#replacementTrace]; }
  snapshotForCoordinator() {
    return freezeMovement({ movement: this.#board, progression: this.#progression, frame: this.#machine.exportForStorage(), receipts: structuredClone(this.#receipts), movementEvents: this.#events, statEffects: this.#statEffects, keywordGrants: this.#keywordGrants,
      replacementTrace: [...this.#replacementTrace], bodyEffectId: this.#machine.bodyEffectForCoordinator(), externalBody: this.#machine.externalBodyForCoordinator() });
  }
  toJSON(): never { throw new Error("v3-fixture-server-only"); }
}
