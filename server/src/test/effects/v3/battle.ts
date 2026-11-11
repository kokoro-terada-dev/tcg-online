import { randomUUID } from "node:crypto";
import { MovementStore } from "../../movement/engine";
import { ensureMove, freezeMovement, getCard, location } from "../../movement/state";
import type { MovementEvent, MovementState } from "../../movement/types";
import type { Progression } from "../../progression/types";
import { checkTiming } from "../../progression/state";
import { applyPlayerIntent, applySystemEvent } from "../../progression/transitions";
import type { CardObjectRef } from "../types";
import type { ApprovedV3Card } from "./approval";
import type { StatEffects } from "./statEffects";
import { blockerPrevented, type KeywordGrants } from "./keywordEffects";
import { createDerivedCardFactsReader, UNKNOWN } from "./readContext";
import { hasProtection, protectionReader, protectionRules } from "./protectionRules";
import type { ResolutionIdentity } from "./resolution";

type Ref = Readonly<CardObjectRef>;
type Seat = 0 | 1;
export type BattleCounters = readonly Readonly<{ target: Ref; amount: number }>[];
export type LifeDecision = Readonly<{ battleId: string; resolutionId: string; selectionId: string; token: string; defender: Seat; card: Ref; expiresAt: number }>;
export const V3_BASE_BATTLE_RULES = {
  version: "v3-base-battle.8", source: "https://www.onepiece-cardgame.com/pdf/rule_comprehensive.pdf?20260828=",
  reviewedAt: "2026-11-10", clauses: ["6-5-5", "6-5-6", "7-1", "7-1-1-3", "7-1-1-4", "7-1-3", "7-1-4", "7-1-4-1-1-3", "7-1-5", "8-4-5", "8-6-1", "10-1-1", "10-1-2", "10-1-3", "10-1-4", "10-1-5", "10-1-6", "10-1-7", "10-2-1", "10-2-5", "10-2-16", "10-2-17"],
} as const;
function field(board: MovementState, ref: Ref, player: Seat) {
  const card = getCard(board, ref), at = location(board, card.instanceId);
  ensureMove(at.player === player && card.owner === player && card.controller === player && card.faceUp && (at.zone === "leader" || at.zone === "character") && at.zone === card.kind, "v3-battle-field-required");
  return card;
}
function fieldRows(board: MovementState, player: Seat, definitions: ReadonlyMap<string, ApprovedV3Card>) {
  return [...board.players[player].leader, ...board.players[player].character].flatMap(id => {
    if (!id) return []; const card = board.cards[id]!, definition = definitions.get(card.cardId)?.definition;
    if (!card.faceUp || card.owner !== player || card.controller !== player || !definition || definition.cardType !== card.kind || definition.baseStats.power === null) return [];
    return [{ card: { instanceId: id, generation: card.generation }, cardId: card.cardId }];
  });
}
export function retargetBattle(board: MovementState, progression: Progression, identity: ResolutionIdentity, timing: string,
  target: Ref, definitions: ReadonlyMap<string, ApprovedV3Card>, grants: KeywordGrants = []): Progression {
  const battle = progression.battle;
  const step = timing === "ON_OPPONENT_ATTACK" ? "attack" : timing === "COUNTER" ? "counter" : null;
  ensureMove(step && battle?.step === step && battle.defender === identity.actor && board.turnNumber === progression.turnNumber &&
    identity.matchId === board.matchId && !battle.settled && (step === "attack" || !battle.decisionComplete) &&
    progression.gate.kind === "resolving" && progression.gate.resolutionId === identity.resolutionId &&
    progression.gate.controller === identity.actor, "v3-battle-retarget-window");
  field(board, battle.source, battle.attacker);
  field(board, battle.target, battle.defender);
  field(board, target, battle.defender);
  const source = getCard(board, identity.source), at = location(board, source.instanceId);
  ensureMove(source.owner === identity.actor && source.controller === identity.actor && source.faceUp && at.player === identity.actor &&
    (step === "counter" ? source.kind === "event" && at.zone === "trash" : (at.zone === "leader" || at.zone === "character") && at.zone === source.kind),
  "v3-battle-retarget-source");
  if (hasProtection(definitions)) {
    const reader = protectionReader(board, definitions, progression.activePlayer, grants);
    ensureMove(reader(target, identity.actor, "CANNOT_TARGET") === false && reader(target, identity.actor, "UNAFFECTED_BY") === false, "v3-battle-retarget-protected");
  }
  ensureMove(fieldRows(board, battle.defender, definitions).some(row => row.card.instanceId === target.instanceId && row.card.generation === target.generation),
    "v3-battle-retarget-target-unknown");
  return applySystemEvent(progression, progression.revision, { kind: "retargetBattleByEffect", battleId: battle.battleId,
    step, actor: identity.actor, resolutionId: identity.resolutionId, source: identity.source, effectId: identity.effectId, target });
}
export function attackOptions(board: MovementState, progression: Progression, actor: Seat, definitions: ReadonlyMap<string, ApprovedV3Card>, grants: KeywordGrants) {
  if (!checkTiming(progression, actor, "attack").allowed) return { sources: [], targets: [], pairs: [] };
  const facts = createDerivedCardFactsReader({ board: () => board, definitions, statEffects: () => [], activePlayer: progression.activePlayer, keywordGrants: () => grants });
  const sources = fieldRows(board, actor, definitions).filter(row => !board.cards[row.card.instanceId]!.rotated);
  const targets = fieldRows(board, (1 - actor) as Seat, definitions).filter(row => { const card = board.cards[row.card.instanceId]!; return card.kind === "leader" || card.rotated; });
  const pairs = sources.flatMap(source => {
    const card = board.cards[source.card.instanceId]!, info = facts(source.card, actor);
    const recent = card.kind === "character" && card.enteredTurn === progression.turnNumber;
    if (recent && (info === UNKNOWN || info.abilities.CURRENT.RUSH !== true && info.abilities.CURRENT.RUSH_CHARACTER !== true)) return [];
    const characterOnly = recent && (info === UNKNOWN || info.abilities.CURRENT.RUSH !== true);
    return targets.filter(target => !characterOnly || board.cards[target.card.instanceId]!.kind === "character").map(target => ({ sourceId: source.card.instanceId, targetId: target.card.instanceId }));
  });
  return { sources: sources.filter(row => pairs.some(pair => pair.sourceId === row.card.instanceId)), targets: targets.filter(row => pairs.some(pair => pair.targetId === row.card.instanceId)), pairs };
}
export function declareAttack(board: MovementState, progression: Progression, actor: Seat, source: Ref, target: Ref, definitions: ReadonlyMap<string, ApprovedV3Card>, grants: KeywordGrants, battleId: string, transactionId: string, deferEffects = false) {
  field(board, source, actor); field(board, target, (1 - actor) as Seat);
  const options = attackOptions(board, progression, actor, definitions, grants);
  ensureMove(board.turnNumber === progression.turnNumber && options.pairs.some(pair => pair.sourceId === source.instanceId && pair.targetId === target.instanceId), "v3-attack-pair-unavailable");
  let next = applySystemEvent(progression, progression.revision, { kind: "startBattle", battleId, source, target });
  const result = new MovementStore(board).commit({ transactionId, matchId: board.matchId, expectedRevision: board.revision, turnNumber: board.turnNumber,
    actor, effectController: null, source, mode: "rule", resolutionId: null, operations: [{ kind: "setRest", card: source, rotated: true }] }, { status: "certifiedNone" });
  if (!deferEffects) next = finishAttackStep(result.state, next);
  return { movement: result.state, progression: next, events: result.events };
}
export function finishAttackStep(board: MovementState, progression: Progression): Progression {
  const battle = progression.battle; ensureMove(battle?.step === "attack" && progression.gate.kind === "idle", "v3-attack-effects-pending");
  const present = battleParticipantsPresent(board, progression);
  let next = applySystemEvent(progression, progression.revision, { kind: "settleBattleStep", battleId: battle.battleId, step: "attack" });
  next = applySystemEvent(next, next.revision, { kind: "advanceBattle", battleId: battle.battleId, step: "attack", participantsPresent: present });
  if (!present) {
    next = applySystemEvent(next, next.revision, { kind: "settleBattleStep", battleId: battle.battleId, step: "end" });
    next = applySystemEvent(next, next.revision, { kind: "advanceBattle", battleId: battle.battleId, step: "end", participantsPresent: false });
  }
  return next;
}
function battleParticipantsPresent(board: MovementState, progression: Progression): boolean {
  const battle = progression.battle!;
  return [{ ref: battle.source, player: battle.attacker }, { ref: battle.target, player: battle.defender }].every(({ ref, player }) => {
    const card = board.cards[ref.instanceId]; if (!card || card.generation !== ref.generation) return false;
    const at = location(board, card.instanceId);
    return card.owner === player && card.controller === player && card.faceUp && at.player === player && card.kind === at.zone && (at.zone === "leader" || at.zone === "character");
  });
}
export function finishBlockStep(board: MovementState, progression: Progression): Progression {
  const battle = progression.battle;
  ensureMove(battle?.step === "block" && battle.decisionComplete && progression.gate.kind === "idle", "v3-block-effects-pending");
  const present = battleParticipantsPresent(board, progression);
  let next = applySystemEvent(progression, progression.revision, { kind: "settleBattleStep", battleId: battle.battleId, step: "block" });
  next = applySystemEvent(next, next.revision, { kind: "advanceBattle", battleId: battle.battleId, step: "block", participantsPresent: present });
  if (!present) {
    next = applySystemEvent(next, next.revision, { kind: "settleBattleStep", battleId: battle.battleId, step: "end" });
    next = applySystemEvent(next, next.revision, { kind: "advanceBattle", battleId: battle.battleId, step: "end", participantsPresent: false });
  }
  return next;
}
export function finishCounterStep(board: MovementState, progression: Progression, actor: Seat): Progression {
  ensureMove(checkTiming(progression, actor, "endCounter").allowed, "v3-counter-end-window");
  const battle = progression.battle!, present = battleParticipantsPresent(board, progression);
  let next = applyPlayerIntent(progression, progression.revision, actor, "endCounter");
  next = applySystemEvent(next, next.revision, { kind: "settleBattleStep", battleId: battle.battleId, step: "counter" });
  next = applySystemEvent(next, next.revision, { kind: "advanceBattle", battleId: battle.battleId, step: "counter", participantsPresent: present });
  if (!present) {
    next = applySystemEvent(next, next.revision, { kind: "settleBattleStep", battleId: battle.battleId, step: "end" });
    next = applySystemEvent(next, next.revision, { kind: "advanceBattle", battleId: battle.battleId, step: "end", participantsPresent: false });
  }
  return next;
}
export function blockerOptions(board: MovementState, progression: Progression, actor: Seat, definitions: ReadonlyMap<string, ApprovedV3Card>, grants: KeywordGrants) {
  const battle = progression.battle;
  if (!battle || !checkTiming(progression, actor, "passBlock").allowed) return [];
  const facts = createDerivedCardFactsReader({ board: () => board, definitions, statEffects: () => [], activePlayer: progression.activePlayer, keywordGrants: () => grants });
  const attacker = facts(battle.source, actor);
  if (attacker === UNKNOWN || attacker.abilities.CURRENT.CANNOT_BE_BLOCKED !== false) return [];
  return fieldRows(board, actor, definitions).filter(row => {
    const card = facts(row.card, actor);
    return !blockerPrevented(grants, row.card) && !board.cards[row.card.instanceId]!.rotated &&
      row.card.instanceId !== battle.target.instanceId && card !== UNKNOWN && card.abilities.CURRENT.BLOCKER === true;
  });
}
export function declareBlock(board: MovementState, progression: Progression, actor: Seat, card: Ref, definitions: ReadonlyMap<string, ApprovedV3Card>, grants: KeywordGrants, transactionId: string, deferCounter = false) {
  field(board, card, actor); const battle = progression.battle!;
  ensureMove(blockerOptions(board, progression, actor, definitions, grants).some(option => option.card.instanceId === card.instanceId && option.card.generation === card.generation), "v3-blocker-unavailable");
  let next = applySystemEvent(progression, progression.revision, { kind: "redirectBattle", battleId: battle.battleId, target: card, recordBlocker: true });
  const result = new MovementStore(board).commit({ transactionId, matchId: board.matchId, expectedRevision: board.revision, turnNumber: board.turnNumber,
    actor, effectController: actor, source: card, mode: "cost", resolutionId: `block:${battle.battleId}`, operations: [{ kind: "setRest", card, rotated: true }] }, { status: "certifiedNone" });
  if (deferCounter) return { movement: result.state, progression: next, events: result.events };
  next = applySystemEvent(next, next.revision, { kind: "settleBattleStep", battleId: battle.battleId, step: "block" });
  next = applySystemEvent(next, next.revision, { kind: "advanceBattle", battleId: battle.battleId, step: "block", participantsPresent: true });
  return { movement: result.state, progression: next, events: result.events };
}
export function battlePower(board: MovementState, progression: Progression, definitions: ReadonlyMap<string, ApprovedV3Card>, effects: StatEffects, counters: BattleCounters) {
  const battle = progression.battle; if (!battle) return null;
  const facts = createDerivedCardFactsReader({ board: () => board, definitions, statEffects: () => effects, activePlayer: progression.activePlayer,
    counterPower: ref => counters.filter(entry => entry.target.instanceId === ref.instanceId && entry.target.generation === ref.generation).reduce((sum, entry) => sum + entry.amount, 0) });
  const power = (ref: Ref, player: Seat) => {
    field(board, ref, player);
    const info = facts(ref, player);
    ensureMove(info !== UNKNOWN && info.current.power !== UNKNOWN, "v3-battle-power-unknown");
    return info.current.power;
  };
  return { attack: power(battle.source, battle.attacker), defense: power(battle.target, battle.defender) };
}
export function counterCandidates(board: MovementState, progression: Progression, actor: Seat, definitions: ReadonlyMap<string, ApprovedV3Card>) {
  if (!checkTiming(progression, actor, "counterEffect").allowed) return [];
  const facts = createDerivedCardFactsReader({ board: () => board, definitions, statEffects: () => [], activePlayer: progression.activePlayer });
  return board.players[actor].hand.flatMap(id => {
    const card = board.cards[id!]!, ref = { instanceId: card.instanceId, generation: card.generation };
    if (card.kind !== "character" || card.owner !== actor || card.controller !== actor) return [];
    const info = facts(ref, actor), amount = info === UNKNOWN ? UNKNOWN : info.current.counter;
    if (typeof amount !== "number" || amount <= 0) return [];
    return [{ card: ref, cardId: card.cardId, amount }];
  });
}
export function useCounter(board: MovementState, progression: Progression, actor: Seat, card: Ref, target: Ref, definitions: ReadonlyMap<string, ApprovedV3Card>, counters: BattleCounters, effects: StatEffects, transactionId: string) {
  const option = counterCandidates(board, progression, actor, definitions).find(choice => choice.card.instanceId === card.instanceId && choice.card.generation === card.generation);
  ensureMove(option && counters.length < 100, "v3-battle-counter-unavailable"); field(board, target, actor);
  const bonus = counters.filter(entry => entry.target.instanceId === target.instanceId && entry.target.generation === target.generation).reduce((sum, entry) => sum + entry.amount, option.amount);
  const facts = createDerivedCardFactsReader({ board: () => board, definitions, statEffects: () => effects, activePlayer: progression.activePlayer })(target, actor);
  ensureMove(facts !== UNKNOWN && facts.current.power !== UNKNOWN && Number.isSafeInteger(facts.current.power + bonus), "v3-counter-target-power-unknown-or-overflow");
  const result = new MovementStore(board).commit({ transactionId, matchId: board.matchId, expectedRevision: board.revision, turnNumber: board.turnNumber,
    actor, effectController: actor, source: card, mode: "rule", resolutionId: null, operations: [{ kind: "move", card, from: { player: actor, zone: "hand" },
      to: { player: actor, zone: "trash", position: "append", faceUp: true, rotated: false }, cause: "OTHER" }] }, { status: "certifiedNone" });
  return { ...result, counters: freezeMovement([...counters, { target: { ...target }, amount: option.amount }]) };
}
export function finishDamageStep(progression: Progression): Progression {
  const battle = progression.battle!;
  let next = applySystemEvent(progression, progression.revision, { kind: "settleBattleStep", battleId: battle.battleId, step: "damage" });
  next = applySystemEvent(next, next.revision, { kind: "advanceBattle", battleId: battle.battleId, step: "damage", participantsPresent: false });
  next = applySystemEvent(next, next.revision, { kind: "settleBattleStep", battleId: battle.battleId, step: "end" });
  return applySystemEvent(next, next.revision, { kind: "advanceBattle", battleId: battle.battleId, step: "end", participantsPresent: false });
}
export function finishDamagePoint(board: MovementState, progression: Progression): Progression {
  const battle = progression.battle!;
  if (battle.remainingDamage && board.players[battle.defender].life.length > 0) return progression;
  if (battle.remainingDamage) progression = applySystemEvent(progression, progression.revision, { kind: "consumeRemainingDamage", battleId: battle.battleId });
  return finishDamageStep(progression);
}
export function damage(board: MovementState, progression: Progression, actor: Seat, definitions: ReadonlyMap<string, ApprovedV3Card>, effects: StatEffects, counters: BattleCounters, transactionId: string, now: number, deferEffects = false, grants: KeywordGrants = []) {
  const battle = progression.battle;
  ensureMove(battle && actor === battle.defender && battle.step === "damage" && battle.decisionComplete && !battle.settled && progression.gate.kind === "idle" && !progression.outcome, "v3-battle-damage-window");
  let next = progression; let movement = board; let events: readonly MovementEvent[] = [];
  let pendingLife: LifeDecision | null = null;
  let deferredEffects = false;
  let hitsLeader: boolean, hitsCharacter = false;
  if (battle.remainingDamage) {
    hitsLeader = board.players[actor].life.length > 0;
    next = applySystemEvent(next, next.revision, { kind: "consumeRemainingDamage", battleId: battle.battleId });
  } else {
    const powers = battlePower(board, progression, definitions, effects, counters)!;
    const target = field(board, battle.target, actor), hits = powers.attack >= powers.defense;
    hitsLeader = hits && target.kind === "leader";
    hitsCharacter = hits && target.kind === "character";
  }
  if (hitsLeader && board.players[actor].life.length === 0) {
    next = applySystemEvent(next, next.revision, { kind: "finishGame", winner: battle.attacker, reason: "leader-damage-at-zero-life" });
  } else if (hitsLeader) {
    const id = board.players[actor].life[0]!, card = board.cards[id]!;
    let banish: boolean;
    if (battle.remainingDamage) banish = battle.remainingDamage.banish;
    else {
      const facts = createDerivedCardFactsReader({ board: () => board, definitions, statEffects: () => effects,
        activePlayer: progression.activePlayer, keywordGrants: () => grants })(battle.source, battle.attacker);
      ensureMove(facts !== UNKNOWN && facts.abilities.CURRENT.BANISH !== UNKNOWN && facts.abilities.CURRENT.DOUBLE_ATTACK !== UNKNOWN, "v3-damage-keyword-unknown");
      banish = facts.abilities.CURRENT.BANISH;
      if (facts.abilities.CURRENT.DOUBLE_ATTACK) next = applySystemEvent(next, next.revision, { kind: "recordRemainingDamage", battleId: battle.battleId, banish });
    }
    if (banish) {
      const result = new MovementStore(board).commit({ transactionId, matchId: board.matchId, expectedRevision: board.revision, turnNumber: board.turnNumber,
        actor: battle.attacker, effectController: null, source: battle.source, mode: "rule", resolutionId: null, operations: [{
          kind: "move", card: { instanceId: id, generation: card.generation }, from: { player: actor, zone: "life" },
          to: { player: actor, zone: "trash", position: "append", faceUp: true, rotated: false }, cause: "DAMAGE"
        }] }, { status: "certifiedNone" });
      return { movement: result.state, progression: deferEffects ? next : finishDamagePoint(result.state, next), events: result.events, pendingLife, deferredEffects: deferEffects };
    }
    const known = definitions.get(card.cardId)?.definition;
    ensureMove(known && known.cardType === card.kind && (known.source.triggerText.trim() === "" || known.effects.some(effect => effect.timing.type === "TRIGGER")), "v3-life-trigger-definition-unresolved");
    ensureMove(Number.isSafeInteger(now) && now >= 0 && Number.isSafeInteger(now + 120000), "v3-life-clock-invalid");
    pendingLife = { battleId: battle.battleId, resolutionId: randomUUID(), selectionId: randomUUID(), token: randomUUID(), defender: actor,
      card: { instanceId: id, generation: card.generation }, expiresAt: now + 120000 };
    next = applySystemEvent(next, next.revision, { kind: "beginResolution", resolutionId: pendingLife.resolutionId, controller: actor });
    next = applySystemEvent(next, next.revision, { kind: "waitForChoice", resolutionId: pendingLife.resolutionId, selectionId: pendingLife.selectionId, chooser: actor });
    const result = new MovementStore(board).commit({ transactionId, matchId: board.matchId, expectedRevision: board.revision, turnNumber: board.turnNumber,
      actor, effectController: null, source: battle.source, mode: "rule", resolutionId: pendingLife.resolutionId,
      operations: [{ kind: "reveal", card: pendingLife.card, scopeId: pendingLife.resolutionId, viewers: [actor] }] }, { status: "certifiedNone" });
    movement = result.state; events = result.events;
  } else {
    if (hitsCharacter) {
      const result = new MovementStore(board).commit({ transactionId, matchId: board.matchId, expectedRevision: board.revision, turnNumber: board.turnNumber,
        actor: battle.attacker, effectController: null, source: battle.source, mode: "rule", resolutionId: null,
        operations: [{ kind: "move", card: battle.target, from: { player: actor, zone: "character" }, to: { player: actor, zone: "trash", position: "append", faceUp: true, rotated: false }, cause: "BATTLE_KO" }] }, protectionRules(board, definitions, progression.activePlayer, "rule", grants));
      movement = result.state; events = result.events;
      deferredEffects = deferEffects && events.some(event => event.isKO);
    }
    if (!deferredEffects) next = finishDamagePoint(movement, next);
  }
  return { movement, progression: next, events, pendingLife, deferredEffects };
}
export function acceptLifeDecision(board: MovementState, progression: Progression, actor: Seat, pending: LifeDecision, selectionId: string, token: string, now: number): Progression {
  const gate = progression.gate, battle = progression.battle;
  ensureMove(actor === pending.defender && pending.token === token && pending.selectionId === selectionId && Number.isSafeInteger(now) && now < pending.expiresAt &&
    battle?.battleId === pending.battleId && battle.step === "damage" && gate.kind === "choice" && gate.chooser === actor && gate.selectionId === selectionId && gate.resolutionId === pending.resolutionId &&
    board.players[actor].life[0] === pending.card.instanceId, "v3-life-choice-unavailable");
  getCard(board, pending.card);
  let next = applySystemEvent(progression, progression.revision, { kind: "acceptChoice", resolutionId: pending.resolutionId, selectionId, chooser: actor });
  return applySystemEvent(next, next.revision, { kind: "finishResolution", resolutionId: pending.resolutionId });
}
export function takeLife(board: MovementState, progression: Progression, actor: Seat, pending: LifeDecision, selectionId: string, token: string, transactionId: string, now: number, deferEffects = false) {
  const next = acceptLifeDecision(board, progression, actor, pending, selectionId, token, now);
  const result = new MovementStore(board).commit({ transactionId, matchId: board.matchId, expectedRevision: board.revision, turnNumber: board.turnNumber,
    actor, effectController: null, source: progression.battle!.source, mode: "rule", resolutionId: pending.resolutionId,
    operations: [{ kind: "move", card: pending.card, from: { player: actor, zone: "life" }, to: { player: actor, zone: "hand", position: "append", faceUp: true, rotated: false }, cause: "DAMAGE" },
      { kind: "closeReveals", scopeId: pending.resolutionId }] }, { status: "certifiedNone" });
  return { movement: result.state, progression: deferEffects ? next : finishDamagePoint(result.state, next), events: result.events, deferredEffects: deferEffects };
}
