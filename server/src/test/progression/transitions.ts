import type { Battle, BattleStep, Phase, Player, PlayerIntent, Progression, SystemEvent } from "./types";
import { checkTiming, freezeState, phaseToken, ProgressionError, requireId, requirePlayer } from "./state";
import type { CardObjectRef } from "../effects/types";

function ensure(condition: unknown, message: string): asserts condition { if (!condition) throw new ProgressionError(message); }
function checkRevision(state: Progression, expected: number): void {
  ensure(Number.isSafeInteger(expected) && expected === state.revision, "Stale or invalid revision");
  ensure(!state.outcome, "Game is finished");
  ensure(state.revision < Number.MAX_SAFE_INTEGER, "Revision limit reached");
}
function commit(state: Progression, patch: Partial<Progression>): Progression { return freezeState({ ...state, ...patch, revision: state.revision + 1 }); }
function idle(state: Progression): void { ensure(state.gate.kind === "idle", "Resolution or choice is pending"); }
function enterPhase(state: Progression, phase: Phase, turn = state.turnNumber, active = state.activePlayer): Progression {
  return commit(state, { phase, turnNumber: turn, activePlayer: active, phaseToken: phaseToken(turn, phase), phaseSettled: false });
}
function cardRef(value: CardObjectRef): Readonly<CardObjectRef> {
  ensure(value && typeof value === "object", "Invalid card reference"); requireId(value.instanceId);
  ensure(Number.isSafeInteger(value.generation) && value.generation >= 0, "Invalid card generation");
  return { instanceId: value.instanceId, generation: value.generation };
}
function battleAt(state: Progression, id: string, step: BattleStep): Battle {
  requireId(id);
  ensure(state.battle && state.battle.battleId === id && state.battle.step === step, "Stale battle or battle step");
  return state.battle;
}

export function applyPlayerIntent(state: Progression, expectedRevision: number, actor: Player, intent: PlayerIntent): Progression {
  checkRevision(state, expectedRevision);
  const permission = checkTiming(state, actor, intent);
  ensure(permission.allowed, permission.allowed ? "" : permission.reason);
  if (intent === "endMain") return enterPhase(state, "end");
  if (intent === "passBlock" || intent === "endCounter") return commit(state, { battle: { ...state.battle!, decisionComplete: true } });
  throw new ProgressionError("Unknown player intent");
}

// Only a trusted orchestrator can acknowledge completed rule/effect processing.
export function applySystemEvent(state: Progression, expectedRevision: number, event: SystemEvent): Progression {
  checkRevision(state, expectedRevision);
  ensure(event && typeof event === "object", "Invalid system event");
  if (event.kind === "finishGame") {
    if (event.winner !== null) requirePlayer(event.winner);
    requireId(event.reason);
    return commit(state, { outcome: { winner: event.winner, reason: event.reason }, gate: { kind: "idle" }, battle: null });
  }
  if (event.kind === "beginResolution") {
    idle(state); requireId(event.resolutionId); requirePlayer(event.controller);
    return commit(state, { gate: { kind: "resolving", resolutionId: event.resolutionId, controller: event.controller } });
  }
  if (event.kind === "waitForChoice") {
    requireId(event.selectionId); requirePlayer(event.chooser);
    ensure(state.gate.kind === "resolving" && state.gate.resolutionId === event.resolutionId, "Wrong resolution");
    return commit(state, { gate: { ...state.gate, kind: "choice", selectionId: event.selectionId, chooser: event.chooser } });
  }
  if (event.kind === "acceptChoice") {
    requirePlayer(event.chooser);
    ensure(state.gate.kind === "choice" && state.gate.resolutionId === event.resolutionId && state.gate.selectionId === event.selectionId && state.gate.chooser === event.chooser, "Wrong choice or chooser");
    return commit(state, { gate: { kind: "resolving", resolutionId: state.gate.resolutionId, controller: state.gate.controller } });
  }
  if (event.kind === "finishResolution") {
    ensure(state.gate.kind === "resolving" && state.gate.resolutionId === event.resolutionId, "Wrong or unfinished resolution");
    return commit(state, { gate: { kind: "idle" } });
  }
  idle(state);
  if (event.kind === "settlePhase" || event.kind === "advancePhase") {
    ensure(!state.battle && event.phaseToken === state.phaseToken, "Wrong phase checkpoint");
    if (event.kind === "settlePhase") {
      ensure(!state.phaseSettled, "Phase already settled");
      return commit(state, { phaseSettled: true });
    }
    ensure(state.phaseSettled && state.phase !== "main", "Phase is unsettled or requires a player declaration");
    const next = { refresh: "draw", draw: "don", don: "main" } as const;
    if (state.phase !== "end") return enterPhase(state, next[state.phase]);
    ensure(state.turnNumber < Number.MAX_SAFE_INTEGER, "Turn limit reached");
    return enterPhase(state, "refresh", state.turnNumber + 1, (1 - state.activePlayer) as Player);
  }
  if (event.kind === "startBattle") {
    const permission = checkTiming(state, state.activePlayer, "attack");
    ensure(permission.allowed, permission.allowed ? "" : permission.reason);
    requireId(event.battleId);
    const source = cardRef(event.source), target = cardRef(event.target);
    ensure(source.instanceId !== target.instanceId, "Source and target must differ");
    return commit(state, { battle: { battleId: event.battleId, attacker: state.activePlayer, defender: (1 - state.activePlayer) as Player, source, target, step: "attack", decisionComplete: true, settled: false } });
  }
  if (event.kind === "settleBattleStep") {
    const battle = battleAt(state, event.battleId, event.step);
    ensure(battle.decisionComplete && !battle.settled, "Battle decision pending or already settled");
    return commit(state, { battle: { ...battle, settled: true } });
  }
  if (event.kind === "redirectBattle") {
    const battle = battleAt(state, event.battleId, "block");
    ensure(!battle.decisionComplete && !battle.settled, "Block decision already completed");
    const target = cardRef(event.target);
    ensure(target.instanceId !== battle.source.instanceId, "Source and target must differ");
    return commit(state, { battle: { ...battle, target, decisionComplete: true } });
  }
  if (event.kind === "advanceBattle") {
    const battle = battleAt(state, event.battleId, event.step);
    ensure(battle.settled && typeof event.participantsPresent === "boolean", "Battle step not settled");
    if (battle.step === "end") return commit(state, { battle: null });
    const next = { attack: "block", block: "counter", counter: "damage", damage: "end" } as const;
    const step = event.participantsPresent ? next[battle.step] : "end";
    return commit(state, { battle: { ...battle, step, decisionComplete: step !== "block" && step !== "counter", settled: false } });
  }
  throw new ProgressionError("Unknown system event");
}
