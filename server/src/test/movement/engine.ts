import type { CardObjectRef, MoveCause } from "../effects/types";
import type { EventCause, Location, MovementCard, MovementEvent, MovementOperation, MovementRules, MovementState, MovementTransaction, MovementZone, MoveDestination, Proposal, RevealGrant, TransactionResult } from "./types";
import { ensureMove, freezeMovement, getCard, id, location, MOVEMENT_LIMITS, MovementError, physicalArea, player, reference, validateMovementState } from "./state";
import { validateMovementTransaction } from "./validation";
import { inheritMovementTracking, recordMovementOccurrence } from "./occurrence";

type Draft = Omit<MovementState, "players" | "cards" | "reveals" | "appliedTransactions" | "revision" | "turnNumber"> & {
  revision: number; turnNumber: number; players: [Record<MovementZone, (string | null)[]>, Record<MovementZone, (string | null)[]>];
  cards: Record<string, MovementCard>; reveals: RevealGrant[]; appliedTransactions: string[];
};
const fixed = (zone: MovementZone) => ["character", "leader", "stage"].includes(zone);
const ref = (card: MovementCard): CardObjectRef => ({ instanceId: card.instanceId, generation: card.generation });
function sameLocation(a: Location, b: Location): boolean { return a.player === b.player && a.zone === b.zone; }
function remove(state: Draft, at: Location, instanceId: string): void {
  const list = state.players[at.player][at.zone], index = list.indexOf(instanceId);
  ensureMove(index >= 0, "card-not-at-expected-source");
  if (fixed(at.zone)) list[index] = null; else list.splice(index, 1);
}
function insert(state: Draft, to: MoveDestination, instanceId: string): void {
  player(to.player); const list = state.players[to.player][to.zone]; ensureMove(list, "unknown-destination-zone");
  if (fixed(to.zone)) {
    ensureMove(to.position === "firstEmpty" || to.position === "slot", "fixed-area-needs-slot-position");
    const slot = to.position === "firstEmpty" ? list.indexOf(null) : to.slotIndex;
    ensureMove(Number.isSafeInteger(slot) && slot! >= 0 && slot! < list.length && list[slot!] === null, "no-empty-destination-slot");
    if (to.position === "firstEmpty") ensureMove(to.slotIndex === undefined, "unexpected-slot-index");
    list[slot!] = instanceId;
  } else {
    ensureMove(to.slotIndex === undefined && ["top", "bottom", "append"].includes(to.position), "invalid-list-position");
    if (to.position === "top") list.unshift(instanceId); else list.push(instanceId);
  }
}
export function visibleTo(state: MovementState, card: MovementCard, at: Location, viewer: 0 | 1): boolean {
  if (state.reveals.some(grant => grant.card.instanceId === card.instanceId && grant.card.generation === card.generation && grant.viewers.includes(viewer))) return true;
  if (at.zone === "hand") return card.owner === viewer;
  if (at.zone === "deck") return false;
  return at.zone === "donDeck" || card.faceUp;
}
const viewers = (state: MovementState, card: MovementCard, at: Location): readonly (0 | 1)[] => ([0, 1] as const).filter(viewer => visibleTo(state, card, at, viewer));

function applyTransaction(state: MovementState, input: MovementTransaction, rules: MovementRules): TransactionResult {
  validateMovementState(state);
  validateMovementTransaction(input);
  ensureMove(input && input.matchId === state.matchId && input.expectedRevision === state.revision && Number.isSafeInteger(input.expectedRevision), "stale-movement-transaction");
  id(input.transactionId, 80); player(input.actor);
  if (input.effectController !== null) player(input.effectController);
  if (input.source !== null) reference(input.source);
  if (input.resolutionId !== null) id(input.resolutionId);
  ensureMove(["effect", "cost", "rule"].includes(input.mode), "invalid-transaction-mode");
  ensureMove(Number.isSafeInteger(input.turnNumber) && input.turnNumber >= state.turnNumber && input.turnNumber <= state.turnNumber + 1, "invalid-transaction-turn");
  ensureMove(!state.appliedTransactions.includes(input.transactionId), "duplicate-movement-transaction");
  ensureMove(state.appliedTransactions.length < MOVEMENT_LIMITS.transactions && Array.isArray(input.operations) && input.operations.length <= MOVEMENT_LIMITS.operations, "movement-transaction-limit");
  ensureMove(rules && ["certifiedNone", "evaluate"].includes(rules.status), "movement-rule-evaluation-required");
  if (rules.status === "evaluate") ensureMove(typeof rules.check === "function", "invalid-movement-rule-guard");
  const ruleCheck = rules.status === "evaluate" ? rules.check.bind(rules) : null;
  const transaction = freezeMovement(structuredClone(input));
  const draft = structuredClone(state) as Draft; draft.turnNumber = input.turnNumber;
  const events: MovementEvent[] = [], prevented: number[] = []; let sequence = 0;
  const nextId = () => `${transaction.transactionId}:${++sequence}`;
  function cause(kind: MoveCause, parentEventId: string | null = null): EventCause {
    return { kind, actor: transaction.actor, effectController: transaction.effectController, source: transaction.source, resolutionId: transaction.resolutionId, parentEventId };
  }
  function emit(event: MovementEvent): void { ensureMove(events.length < MOVEMENT_LIMITS.events, "movement-event-limit"); events.push(freezeMovement(event)); }
  function check(proposal: Proposal): boolean {
    if (!ruleCheck) return true;
    const decision = ruleCheck(freezeMovement(structuredClone(proposal)), freezeMovement(structuredClone(draft)));
    ensureMove(decision && ["allow", "prevent", "defer"].includes(decision.kind), "invalid-movement-rule-decision");
    ensureMove(decision.kind !== "defer", "movement-rule-decision-pending");
    if (decision.kind === "prevent") { ensureMove(transaction.mode !== "cost", "cost-operation-prevented"); return false; }
    return true;
  }
  function checkCause(kind: MoveCause): void {
    const allowed = transaction.mode === "cost" ? ["COST_PAYMENT"] : transaction.mode === "effect" ? ["EFFECT_MOVE", "EFFECT_KO", "OTHER"] : ["RULE_PROCESSING", "BATTLE_KO", "DAMAGE", "OTHER"];
    ensureMove(allowed.includes(kind), "invalid-cause-for-transaction-mode");
  }
  function transitionCard(before: MovementCard, from: Location, to: MoveDestination, attachedTo: CardObjectRef | null = null): MovementCard {
    ensureMove(before.generation < Number.MAX_SAFE_INTEGER, "card-generation-limit");
    ensureMove(typeof to.faceUp === "boolean" && typeof to.rotated === "boolean", "invalid-destination-state");
    ensureMove(to.player === before.owner && before.kind !== "leader", "unsupported-destination-owner-or-leader-move");
    ensureMove(from.zone !== to.zone && physicalArea(from.zone) !== physicalArea(to.zone), "same-area-move-needs-reorder-or-state-change");
    if (to.zone === "character" || to.zone === "stage") ensureMove(before.kind === to.zone, "card-kind-does-not-fit-slot");
    ensureMove(to.zone !== "leader", "leader-slot-is-not-a-move-destination");
    if (before.kind === "don") ensureMove(["donDeck", "activeDon", "restDon", "attachedDon"].includes(to.zone), "don-cannot-enter-main-zone");
    else ensureMove(!["donDeck", "activeDon", "restDon", "attachedDon"].includes(to.zone), "main-card-cannot-enter-don-zone");
    if (to.zone === "deck") ensureMove(!to.faceUp, "deck-destination-must-be-facedown");
    const reset = ["character", "stage"].includes(from.zone) || before.kind === "don";
    ensureMove(reset || (!before.modifierIds.length && !before.grantIds.length), "transient-transition-rule-not-modeled");
    const faceUp = to.zone === "life" ? to.faceUp : to.zone === "deck" || to.zone === "donDeck" ? false : true;
    const rotated = to.zone === "restDon" ? true : ["character", "stage"].includes(to.zone) ? to.rotated : false;
    return { ...before, generation: before.generation + 1, controller: to.player, faceUp, rotated, attachedTo,
      modifierIds: [], grantIds: [], enteredTurn: to.zone === "character" ? draft.turnNumber : null };
  }
  function installMove(before: MovementCard, after: MovementCard, from: Location, to: MoveDestination, index: number, eventId: string, why: EventCause): void {
    const visibleBefore = viewers(draft, before, from);
    remove(draft, from, before.instanceId); insert(draft, to, before.instanceId); draft.cards[before.instanceId] = after;
    draft.reveals = draft.reveals.filter(grant => grant.card.instanceId !== before.instanceId);
    emit({ eventId, operationIndex: index, groupId: `${transaction.transactionId}:group:${index}`, kind: "moved", before, after, from, to: { player: to.player, zone: to.zone }, cause: why,
      isKO: why.kind === "EFFECT_KO" || why.kind === "BATTLE_KO", visibleBefore, visibleAfter: viewers(draft, after, to) });
  }
  function move(operation: Extract<MovementOperation, { kind: "move" }>, index: number): void {
    checkCause(operation.cause);
    const before = getCard(draft, operation.card), from = location(draft, before.instanceId);
    ensureMove(sameLocation(from, operation.from), "card-not-at-expected-source");
    ensureMove(operation.to.zone !== "attachedDon", "attachment-needs-attach-operation");
    if (operation.cause === "EFFECT_KO" || operation.cause === "BATTLE_KO") ensureMove(before.kind === "character" && from.zone === "character" && operation.to.zone === "trash", "invalid-ko-move");
    if (operation.cause === "DAMAGE") ensureMove(from.zone === "life" && draft.players[from.player].life[0] === before.instanceId, "damage-must-use-top-life");
    const after = transitionCard(before, from, operation.to), eventId = nextId(), why = cause(operation.cause);
    if (!check({ operationIndex: index, kind: "move", card: before, from, to: operation.to, cause: why, automatic: false })) { prevented.push(index); return; }
    const children = Object.values(draft.cards).filter(card => card.attachedTo?.instanceId === before.instanceId && card.attachedTo.generation === before.generation).map(card => {
      const at = location(draft, card.instanceId);
      const to: MoveDestination = { player: card.owner, zone: "restDon", position: "append", faceUp: true, rotated: true };
      const childCause = cause("RULE_PROCESSING", eventId);
      ensureMove(check({ operationIndex: index, kind: "move", card, from: at, to, cause: childCause, automatic: true }), "attached-don-return-prevented");
      return { card, at, to, after: transitionCard(card, at, to), cause: childCause };
    });
    installMove(before, after, from, operation.to, index, eventId, why);
    for (const child of children) installMove(child.card, child.after, child.at, child.to, index, nextId(), child.cause);
  }
  if (transaction.mode === "cost") {
    ensureMove(transaction.resolutionId !== null, "cost-needs-resolution-context");
    const reserved = new Set<string>();
    for (const operation of transaction.operations) {
      ensureMove(operation.kind === "move" || operation.kind === "setRest" || operation.kind === "reveal", "unsupported-cost-operation");
      const card = getCard(state, operation.card);
      ensureMove(card.owner === transaction.actor && card.controller === transaction.actor, "cost-cannot-use-another-players-card");
      if (operation.kind === "setRest") ensureMove(operation.rotated, "cost-cannot-activate-card");
      if (operation.kind === "reveal") ensureMove(location(state, card.instanceId).zone === "hand" && operation.viewers.includes(0) && operation.viewers.includes(1) && operation.scopeId === transaction.resolutionId, "cost-reveal-needs-public-resolution-scope");
      const affected = [card.instanceId, ...(operation.kind === "move" ? Object.values(state.cards).filter(child => child.attachedTo?.instanceId === card.instanceId).map(child => child.instanceId) : [])];
      for (const cardId of affected) { ensureMove(!reserved.has(cardId), "cost-resource-overlap-including-attached-don"); reserved.add(cardId); }
    }
  }
  for (let index = 0; index < transaction.operations.length; index++) {
    const operation = transaction.operations[index]!;
    if (operation.kind === "move") { move(operation, index); continue; }
    const why = cause(transaction.mode === "cost" ? "COST_PAYMENT" : transaction.mode === "rule" ? "RULE_PROCESSING" : "EFFECT_MOVE");
    if (operation.kind === "closeReveals") {
      id(operation.scopeId); const previous = draft.reveals.filter(grant => grant.scopeId === operation.scopeId);
      draft.reveals = draft.reveals.filter(grant => grant.scopeId !== operation.scopeId);
      if (previous.length) emit({ eventId: nextId(), operationIndex: index, groupId: `${transaction.transactionId}:group:${index}`, kind: "revealsClosed", before: null, after: null, from: null, to: null, cause: why, isKO: false, visibleBefore: [...new Set(previous.flatMap(grant => [...grant.viewers]))], visibleAfter: [] });
      continue;
    }
    if (operation.kind === "reorder") {
      player(operation.location.player); const list = draft.players[operation.location.player][operation.location.zone];
      ensureMove(list && !fixed(operation.location.zone) && operation.location.zone !== "attachedDon" && typeof operation.conceal === "boolean", "invalid-reorder-area");
      ensureMove(Array.isArray(operation.cards) && operation.cards.length === list.length && new Set(operation.cards.map(card => card.instanceId)).size === list.length, "reorder-must-cover-exact-set");
      for (const card of operation.cards) { getCard(draft, card); ensureMove(list.includes(card.instanceId), "reorder-card-outside-area"); }
      if (!check({ operationIndex: index, kind: "reorder", card: null, from: operation.location, to: operation.location, cause: why, automatic: false })) { prevented.push(index); continue; }
      draft.players[operation.location.player][operation.location.zone] = operation.cards.map(card => card.instanceId);
      if (operation.conceal) draft.reveals = draft.reveals.filter(grant => !list.includes(grant.card.instanceId));
      emit({ eventId: nextId(), operationIndex: index, groupId: `${transaction.transactionId}:group:${index}`, kind: "reordered", before: null, after: null, from: operation.location, to: operation.location, cause: why, isKO: false, visibleBefore: [0, 1], visibleAfter: [0, 1] });
      continue;
    }
    ensureMove(operation.kind === "setRest" || operation.kind === "reveal" || operation.kind === "attachDon", "unknown-movement-operation");
    const before = getCard(draft, operation.card), from = location(draft, before.instanceId);
    if (operation.kind === "attachDon") {
      const target = getCard(draft, operation.target), at = location(draft, target.instanceId);
      ensureMove(before.kind === "don" && from.zone === "activeDon" && before.owner === target.owner && before.controller === target.controller && at.player === before.owner && ["leader", "character"].includes(at.zone), "invalid-don-attachment");
      const to: MoveDestination = { player: before.owner, zone: "attachedDon", position: "append", faceUp: true, rotated: false };
      const after = transitionCard(before, from, to, ref(target));
      if (!check({ operationIndex: index, kind: "attachDon", card: before, from, to, cause: why, automatic: false })) { prevented.push(index); continue; }
      installMove(before, after, from, to, index, nextId(), why); continue;
    }
    if (operation.kind === "setRest") {
      ensureMove(typeof operation.rotated === "boolean" && ["leader", "character", "stage", "activeDon", "restDon"].includes(from.zone), "card-cannot-change-rest-state");
      if (before.rotated === operation.rotated) { ensureMove(transaction.mode !== "cost", "cost-rest-is-already-paid-or-impossible"); continue; }
      const to: Location = before.kind === "don" ? { player: before.owner, zone: operation.rotated ? "restDon" : "activeDon" } : from;
      if (!check({ operationIndex: index, kind: "setRest", card: before, from, to, cause: why, automatic: false })) { prevented.push(index); continue; }
      const visibleBefore = viewers(draft, before, from), after = { ...before, rotated: operation.rotated };
      if (!sameLocation(from, to)) { remove(draft, from, before.instanceId); draft.players[to.player][to.zone].push(before.instanceId); }
      draft.cards[before.instanceId] = after;
      emit({ eventId: nextId(), operationIndex: index, groupId: `${transaction.transactionId}:group:${index}`, kind: "restChanged", before, after, from, to, cause: why, isKO: false, visibleBefore, visibleAfter: viewers(draft, after, to) }); continue;
    }
    id(operation.scopeId); ensureMove(Array.isArray(operation.viewers) && operation.viewers.length > 0 && operation.viewers.length <= 2 && new Set(operation.viewers).size === operation.viewers.length, "invalid-reveal-viewers"); operation.viewers.forEach(player);
    if (!check({ operationIndex: index, kind: "reveal", card: before, from, to: from, cause: why, automatic: false })) { prevented.push(index); continue; }
    const visibleBefore = viewers(draft, before, from);
    draft.reveals = draft.reveals.filter(grant => grant.scopeId !== operation.scopeId || grant.card.instanceId !== before.instanceId);
    draft.reveals.push({ scopeId: operation.scopeId, card: ref(before), viewers: [...operation.viewers] });
    emit({ eventId: nextId(), operationIndex: index, groupId: `${transaction.transactionId}:group:${index}`, kind: "revealed", before, after: before, from, to: from, cause: why, isKO: false, visibleBefore, visibleAfter: viewers(draft, before, from) });
  }
  draft.revision++; draft.appliedTransactions.push(transaction.transactionId);
  validateMovementState(draft);
  return freezeMovement({ state: draft, events, prevented });
}

export class MovementStore {
  #state: MovementState;
  #busy = false;
  constructor(state: MovementState) { validateMovementState(state); this.#state = freezeMovement(structuredClone(state)); inheritMovementTracking(state, this.#state); }
  snapshot(): MovementState { return this.#state; }
  toJSON(): never { throw new MovementError("server-only-movement-store"); }
  commit(transaction: MovementTransaction, rules: MovementRules): TransactionResult {
    ensureMove(!this.#busy, "reentrant-movement-transaction"); this.#busy = true;
    try { const result = applyTransaction(this.#state, transaction, rules); recordMovementOccurrence(this.#state, result.state, result.events); this.#state = result.state; return result; }
    finally { this.#busy = false; }
  }
}
