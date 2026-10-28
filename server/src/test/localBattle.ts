import type { CardObjectRef } from "./effects/types";
import type { MovementOperation, MovementState, Player } from "./movement/types";
import type { MasterSnapshot } from "./cardMaster";
import type { Progression } from "./progression/types";
import { MovementStore } from "./movement/engine";
import { ensureMove, freezeMovement, getCard, location } from "./movement/state";
import { checkTiming } from "./progression/state";
import { applyPlayerIntent, applySystemEvent } from "./progression/transitions";

function fieldCard(board: MovementState, ref: Readonly<CardObjectRef>, actor: Player) {
  const card = getCard(board, ref), at = location(board, card.instanceId);
  ensureMove(at.player === actor && card.owner === actor && card.controller === actor && card.faceUp &&
    (at.zone === "leader" || at.zone === "character") && card.kind === at.zone, "local-battle-field-card-required");
  return card;
}
function localContext(board: MovementState, progression: Progression) {
  ensureMove(process.env.NODE_ENV !== "production" && board.turnNumber === progression.turnNumber &&
    board.players.every(zones => zones.deck.length > 0) && Object.values(board.cards).every(card => !card.modifierIds.length && !card.grantIds.length), "local-battle-context-unavailable");
}
export function localAttackCandidates(board: MovementState, progression: Progression, actor: Player) {
  const empty = { sources: [] as string[], targets: [] as string[] };
  try { localContext(board, progression); } catch { return empty; }
  if (!checkTiming(progression, actor, "attack").allowed) return empty;
  const sources = [...board.players[actor].leader, ...board.players[actor].character].filter((id): id is string => id !== null).filter(id => {
    const card = board.cards[id]!;
    return card.owner === actor && card.controller === actor && card.faceUp && !card.rotated && (card.kind === "leader" || card.enteredTurn !== progression.turnNumber);
  });
  const opponent = (1 - actor) as Player;
  const targets = [...board.players[opponent].leader, ...board.players[opponent].character].filter((id): id is string => id !== null).filter(id => {
    const card = board.cards[id]!;
    return card.owner === opponent && card.controller === opponent && card.faceUp && (card.kind === "leader" || card.rotated);
  });
  return { sources, targets };
}
// Basic fixture declaration only. No printed abilities, blocking, power or damage adjudication.
export function startLocalBattle(board: MovementState, progression: Progression, actor: Player, source: Readonly<CardObjectRef>, target: Readonly<CardObjectRef>, battleId: string, transactionId: string) {
  localContext(board, progression);
  ensureMove(checkTiming(progression, actor, "attack").allowed, "local-attack-window-unavailable");
  const attacker = fieldCard(board, source, actor), defender = fieldCard(board, target, (1 - actor) as Player);
  ensureMove(!attacker.rotated && (attacker.kind === "leader" || attacker.enteredTurn !== progression.turnNumber), "local-attack-source-unavailable");
  ensureMove(defender.kind === "leader" || defender.rotated, "local-attack-target-must-be-leader-or-rested-character");
  let next = applySystemEvent(progression, progression.revision, { kind: "startBattle", battleId, source, target });
  const movement = new MovementStore(board).commit({ transactionId, matchId: board.matchId, expectedRevision: board.revision, turnNumber: board.turnNumber,
    actor, effectController: null, source, mode: "rule", resolutionId: null, operations: [{ kind: "setRest", card: source, rotated: true }] }, { status: "certifiedNone" }).state;
  next = applySystemEvent(next, next.revision, { kind: "settleBattleStep", battleId, step: "attack" });
  next = applySystemEvent(next, next.revision, { kind: "advanceBattle", battleId, step: "attack", participantsPresent: true });
  return { movement, progression: next };
}
export function decideLocalBattle(board: MovementState, progression: Progression, actor: Player, battleId: string, decision: "passBlock" | "endCounter") {
  localContext(board, progression);
  const battle = progression.battle;
  ensureMove(battle?.battleId === battleId, "local-battle-context-stale");
  fieldCard(board, battle.source, battle.attacker); fieldCard(board, battle.target, battle.defender);
  let next = applyPlayerIntent(progression, progression.revision, actor, decision);
  next = applySystemEvent(next, next.revision, { kind: "settleBattleStep", battleId, step: battle.step });
  next = applySystemEvent(next, next.revision, { kind: "advanceBattle", battleId, step: battle.step, participantsPresent: true });
  return { movement: board, progression: next };
}

export function localBattlePower(board: MovementState, progression: Progression, master: MasterSnapshot | null) {
  if (!progression.battle || progression.outcome) return null;
  const unknown = { attack: null, defense: null, masterVersion: master?.version ?? null };
  try {
    localContext(board, progression);
    const battle = progression.battle, source = fieldCard(board, battle.source, battle.attacker), target = fieldCard(board, battle.target, battle.defender);
    const printed = (card: typeof source): number | null => {
      const entry = master && Object.hasOwn(master.cards, card.cardId) ? master.cards[card.cardId] : undefined;
      if (!entry || (entry.type !== "unknown" && entry.type !== card.kind) || entry.power === null || !Number.isSafeInteger(entry.power) || entry.power < 0) return null;
      return entry.power;
    };
    const base = printed(source), defense = printed(target);
    const dons = board.players[battle.attacker].attachedDon.filter(id => {
      const attached = board.cards[id!]!.attachedTo;
      return attached?.instanceId === source.instanceId && attached.generation === source.generation;
    }).length;
    const attack = base === null ? null : base + dons * 1000;
    return { attack: attack !== null && Number.isSafeInteger(attack) ? attack : null, defense, masterVersion: master?.version ?? null };
  } catch { return unknown; }
}

export type LocalLifeChoiceIds = Readonly<{ resolutionId: string; selectionId: string; handToken: string; triggerToken: string }>;
export type LocalLifeChoice = LocalLifeChoiceIds & Readonly<{ battleId: string; defender: Player; card: Readonly<CardObjectRef> }>;
export type LocalBattleUpdate = Readonly<{ movement: MovementState; progression: Progression; pendingLife?: LocalLifeChoice }>;

function finishLocalDamage(progression: Progression, battleId: string, participantsPresent: boolean): Progression {
  let next = applySystemEvent(progression, progression.revision, { kind: "settleBattleStep", battleId, step: "damage" });
  next = applySystemEvent(next, next.revision, { kind: "advanceBattle", battleId, step: "damage", participantsPresent });
  next = applySystemEvent(next, next.revision, { kind: "settleBattleStep", battleId, step: "end" });
  return applySystemEvent(next, next.revision, { kind: "advanceBattle", battleId, step: "end", participantsPresent: false });
}

// Baseline fixture combat only: no counters, keywords or printed ability execution.
export function resolveLocalBattleDamage(board: MovementState, progression: Progression, actor: Player, battleId: string, master: MasterSnapshot | null, transactionId: string, choiceIds: LocalLifeChoiceIds): LocalBattleUpdate {
  localContext(board, progression);
  const battle = progression.battle, powers = localBattlePower(board, progression, master);
  ensureMove(!progression.outcome && progression.gate.kind === "idle" && battle?.battleId === battleId && battle.defender === actor &&
    battle.step === "damage" && battle.decisionComplete && !battle.settled, "local-damage-window-unavailable");
  ensureMove(powers !== null && powers.attack !== null && powers.defense !== null, "local-damage-power-unknown");
  const target = fieldCard(board, battle.target, battle.defender), operations: MovementOperation[] = [];
  const hits = powers.attack >= powers.defense;
  let lethal = false;
  if (hits && target.kind === "character") operations.push({ kind: "move", card: battle.target, from: { player: actor, zone: "character" },
    to: { player: actor, zone: "trash", position: "append", faceUp: true, rotated: false }, cause: "BATTLE_KO" });
  if (hits && target.kind === "leader") {
    const topId = board.players[actor].life[0];
    if (topId === undefined) lethal = true;
    else {
      const top = board.cards[topId!]!;
      const pendingLife = freezeMovement({ ...choiceIds, battleId, defender: actor, card: { instanceId: top.instanceId, generation: top.generation } });
      let next = applySystemEvent(progression, progression.revision, { kind: "beginResolution", resolutionId: pendingLife.resolutionId, controller: actor });
      next = applySystemEvent(next, next.revision, { kind: "waitForChoice", resolutionId: pendingLife.resolutionId, selectionId: pendingLife.selectionId, chooser: actor });
      const movement = new MovementStore(board).commit({ transactionId, matchId: board.matchId, expectedRevision: board.revision, turnNumber: board.turnNumber,
        actor, effectController: null, source: battle.source, mode: "rule", resolutionId: pendingLife.resolutionId,
        operations: [{ kind: "reveal", card: pendingLife.card, scopeId: pendingLife.resolutionId, viewers: [actor] }] }, { status: "certifiedNone" }).state;
      return { movement, progression: next, pendingLife };
    }
  }
  const movement = new MovementStore(board).commit({ transactionId, matchId: board.matchId, expectedRevision: board.revision, turnNumber: board.turnNumber,
    actor: battle.attacker, effectController: null, source: battle.source, mode: "rule", resolutionId: null, operations }, { status: "certifiedNone" }).state;
  if (lethal) return { movement, progression: applySystemEvent(progression, progression.revision, { kind: "finishGame", winner: battle.attacker, reason: "local-leader-damage" }) };
  return { movement, progression: finishLocalDamage(progression, battleId, target.kind === "leader" || !hits) };
}

export function chooseLocalLifeCard(board: MovementState, progression: Progression, actor: Player, battleId: string, selectionId: string, token: string, pending: LocalLifeChoice, transactionId: string): LocalBattleUpdate {
  localContext(board, progression);
  const battle = progression.battle, gate = progression.gate;
  ensureMove(!progression.outcome && battle?.battleId === battleId && battle.step === "damage" && actor === pending.defender &&
    battle.defender === actor && pending.battleId === battleId && selectionId === pending.selectionId && gate.kind === "choice" &&
    gate.resolutionId === pending.resolutionId && gate.selectionId === selectionId && gate.chooser === actor, "local-life-choice-unavailable");
  ensureMove(token === pending.handToken || token === pending.triggerToken, "local-life-token-invalid");
  fieldCard(board, battle.source, battle.attacker); const target = fieldCard(board, battle.target, actor);
  const card = getCard(board, pending.card), at = location(board, card.instanceId);
  ensureMove(target.kind === "leader" && at.player === actor && at.zone === "life" && board.players[actor].life[0] === card.instanceId, "local-life-top-changed");
  let next = applySystemEvent(progression, progression.revision, { kind: "acceptChoice", resolutionId: pending.resolutionId, selectionId, chooser: actor });
  next = applySystemEvent(next, next.revision, { kind: "finishResolution", resolutionId: pending.resolutionId });
  next = finishLocalDamage(next, battleId, true);
  const movement = new MovementStore(board).commit({ transactionId, matchId: board.matchId, expectedRevision: board.revision, turnNumber: board.turnNumber,
    actor: battle.attacker, effectController: null, source: battle.source, mode: "rule", resolutionId: pending.resolutionId,
    operations: [{ kind: "move", card: pending.card, from: { player: actor, zone: "life" },
      to: { player: actor, zone: token === pending.handToken ? "hand" : "public", position: "append", faceUp: true, rotated: false }, cause: "DAMAGE" },
      { kind: "closeReveals", scopeId: pending.resolutionId }] }, { status: "certifiedNone" }).state;
  return { movement, progression: next };
}
