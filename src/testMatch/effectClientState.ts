import type { EffectTransportView, EffectCommand, EffectCommandKind, EffectCatalogQuery, EffectCatalogView, RegisteredEffectCommand, TestTurnCommand, TestPlayCardCommand, TestBattleCommand } from "../../server/src/test/effectProtocol";
import type { MatchView, Zone } from "../../server/src/test/protocol";
export type { EffectTransportView, EffectCommandKind, EffectCatalogQuery, EffectCatalogView, RegisteredEffectCommand, TestTurnCommand, TestPlayCardCommand, TestBattleCommand };
const zones: readonly Zone[] = ["hand", "deck", "life", "trash", "public", "character", "stage", "leader", "donDeck", "activeDon", "restDon"];

export function effectCatalogQuery(view: EffectTransportView, instanceId: string): EffectCatalogQuery {
  const own = view.movement.players[view.localPlayerIndex];
  const card = [...own.leader, ...own.character, ...own.stage].find(c => c?.ref?.instanceId === instanceId);
  if (!card?.ref || !card.faceUp || !card.cardId) throw new Error("No visible local field card");
  return { matchId: view.matchId, expectedMovementRevision: view.movement.revision,
    expectedProgressionRevision: view.progression.revision, source: { ...card.ref } };
}
export function acceptEffectCatalog(view: EffectTransportView, query: EffectCatalogQuery, catalog: EffectCatalogView): boolean {
  try {
    const current = effectCatalogQuery(view, query.source.instanceId);
    return current.matchId === query.matchId && catalog.matchId === current.matchId &&
      current.expectedMovementRevision === query.expectedMovementRevision && catalog.movementRevision === current.expectedMovementRevision &&
      current.expectedProgressionRevision === query.expectedProgressionRevision && catalog.progressionRevision === current.expectedProgressionRevision &&
      current.source.generation === query.source.generation && catalog.source.instanceId === current.source.instanceId && catalog.source.generation === current.source.generation;
  } catch { return false; }
}
export function registeredEffectCommand(view: EffectTransportView, catalog: EffectCatalogView, effectId: string, requestId: string): RegisteredEffectCommand {
  const query = effectCatalogQuery(view, catalog.source.instanceId);
  if (!acceptEffectCatalog(view, query, catalog) || !catalog.activationEnabled || !catalog.catalogVersion ||
    !catalog.effects.some(entry => entry.effectId === effectId && entry.timingAvailable)) throw new Error("No current registered activation");
  return { kind: "activateRegistered", ...query, resolutionId: view.effect.resolutionId, requestId,
    catalogVersion: catalog.catalogVersion, effectId, source: { ...query.source } };
}
export function testTurnCommand(view: EffectTransportView, requestId: string): TestTurnCommand {
  if (!view.testTurnSwitchAvailable || view.effect.status !== "idle" || view.localPlayerIndex !== view.progression.activePlayer ||
    view.progression.phase !== "main" || view.progression.gate !== "idle" || view.progression.finished) throw new Error("No local test turn switch");
  return { kind: "testNextTurn", matchId: view.matchId, resolutionId: view.effect.resolutionId, requestId,
    expectedMovementRevision: view.movement.revision, expectedProgressionRevision: view.progression.revision };
}
export function testPlayDestination(view: EffectTransportView, instanceId: string): "character" | "stage" | null {
  if (!view.testPlayAvailable || view.effect.status !== "idle" || view.localPlayerIndex !== view.progression.activePlayer ||
    view.progression.phase !== "main" || view.progression.gate !== "idle" || view.progression.finished) return null;
  const own = view.movement.players[view.localPlayerIndex], card = own.hand.find(card => card?.ref?.instanceId === instanceId);
  if (!card?.ref || !card.faceUp || !card.cardId || (card.kind !== "character" && card.kind !== "stage")) return null;
  return own[card.kind].includes(null) ? card.kind : null;
}
export function testPlayCardCommand(view: EffectTransportView, instanceId: string, requestId: string): TestPlayCardCommand {
  if (!testPlayDestination(view, instanceId)) throw new Error("No local test play");
  const card = view.movement.players[view.localPlayerIndex].hand.find(card => card?.ref?.instanceId === instanceId)!;
  return { kind: "testPlayCard", matchId: view.matchId, resolutionId: view.effect.resolutionId, requestId,
    expectedMovementRevision: view.movement.revision, expectedProgressionRevision: view.progression.revision, source: { ...card.ref! } };
}
function battleCard(view: EffectTransportView, owner: 0 | 1, instanceId: string) {
  const zones = view.movement.players[owner];
  return [...zones.leader, ...zones.character].find(card => card?.ref?.instanceId === instanceId && card.faceUp && card.cardId);
}
export function canTestAttackSource(view: EffectTransportView, instanceId: string): boolean {
  return !!(view.testAttackAvailable && view.effect.status === "idle" && !view.progression.finished && view.localPlayerIndex === view.progression.activePlayer &&
    view.testAttackSourceIds?.includes(instanceId) && battleCard(view, view.localPlayerIndex, instanceId));
}
export function canTestAttackTarget(view: EffectTransportView, instanceId: string): boolean {
  return !!(view.testAttackAvailable && view.effect.status === "idle" && !view.progression.finished && view.testAttackTargetIds?.includes(instanceId) &&
    battleCard(view, (1 - view.localPlayerIndex) as 0 | 1, instanceId));
}
export function testAttackCommand(view: EffectTransportView, sourceId: string, targetId: string, requestId: string): TestBattleCommand {
  if (!canTestAttackSource(view, sourceId) || !canTestAttackTarget(view, targetId)) throw new Error("No local attack candidates");
  return { kind: "testAttack", matchId: view.matchId, resolutionId: view.effect.resolutionId, requestId,
    expectedMovementRevision: view.movement.revision, expectedProgressionRevision: view.progression.revision,
    source: { ...battleCard(view, view.localPlayerIndex, sourceId)!.ref! }, target: { ...battleCard(view, (1 - view.localPlayerIndex) as 0 | 1, targetId)!.ref! } };
}
export function testBattleDecisionCommand(view: EffectTransportView, decision: "passBlock" | "endCounter", requestId: string): TestBattleCommand {
  if (view.effect.status !== "idle" || view.progression.finished || view.progression.gate !== "idle" || view.testBattleDecision !== decision ||
    !view.battle || view.battle.defender !== view.localPlayerIndex || view.battle.decisionComplete || view.battle.settled ||
    view.battle.step !== (decision === "passBlock" ? "block" : "counter")) throw new Error("No local battle decision");
  return { kind: "testBattleDecision", matchId: view.matchId, resolutionId: view.effect.resolutionId, requestId,
    expectedMovementRevision: view.movement.revision, expectedProgressionRevision: view.progression.revision, battleId: view.battle.battleId, decision };
}
export function testBlockCommand(view: EffectTransportView, instanceId: string, requestId: string): TestBattleCommand {
  const card = view.movement.players[view.localPlayerIndex].character.find(card => card?.ref?.instanceId === instanceId);
  if (!view.testBlockCandidateIds?.includes(instanceId) || view.effect.status !== "idle" || view.progression.finished || view.progression.gate !== "idle" ||
    !view.battle || view.battle.defender !== view.localPlayerIndex || view.battle.step !== "block" || view.battle.decisionComplete || view.battle.settled ||
    !card?.ref || !card.faceUp || !card.cardId || card.kind !== "character" || card.rotated) throw new Error("No local block candidate");
  return { kind: "testBlock", matchId: view.matchId, resolutionId: view.effect.resolutionId, requestId,
    expectedMovementRevision: view.movement.revision, expectedProgressionRevision: view.progression.revision, battleId: view.battle.battleId, blocker: { ...card.ref } };
}
export function testDamageCommand(view: EffectTransportView, requestId: string): TestBattleCommand {
  if (!view.testDamageAvailable || view.effect.status !== "idle" || view.progression.finished || view.progression.gate !== "idle" ||
    !view.battle || view.battle.defender !== view.localPlayerIndex || view.battle.step !== "damage" || !view.battle.decisionComplete || view.battle.settled ||
    view.battlePower?.attack == null || view.battlePower?.defense == null) throw new Error("No local damage decision");
  return { kind: "testResolveDamage", matchId: view.matchId, resolutionId: view.effect.resolutionId, requestId,
    expectedMovementRevision: view.movement.revision, expectedProgressionRevision: view.progression.revision, battleId: view.battle.battleId };
}
export function testHandCounterCommand(view: EffectTransportView, instanceId: string, requestId: string): TestBattleCommand {
  const candidate = view.testCounterCandidates?.find(candidate => candidate.ref.instanceId === instanceId);
  const card = view.movement.players[view.localPlayerIndex].hand.find(card => card?.ref?.instanceId === instanceId);
  if (!candidate || !card?.ref || card.ref.generation !== candidate.ref.generation || !card.faceUp || card.kind !== "character" || card.cardId !== candidate.cardId ||
    !Number.isSafeInteger(candidate.counter) || candidate.counter <= 0 || view.effect.status !== "idle" || view.progression.finished || view.progression.gate !== "idle" ||
    !view.battle || view.battle.defender !== view.localPlayerIndex || view.battle.step !== "counter" || view.battle.decisionComplete || view.battle.settled) throw new Error("No local hand counter");
  return { kind: "testHandCounter", matchId: view.matchId, resolutionId: view.effect.resolutionId, requestId,
    expectedMovementRevision: view.movement.revision, expectedProgressionRevision: view.progression.revision, battleId: view.battle.battleId, card: { ...card.ref } };
}

export function testDamageChoiceCommand(view: EffectTransportView, token: string, requestId: string): TestBattleCommand {
  const choice = view.damageChoice;
  if (!choice || choice.chooser !== view.localPlayerIndex || !choice.options.some(option => option.token === token) ||
    view.effect.status !== "idle" || view.progression.finished || view.progression.gate !== "choice" || view.progression.chooser !== view.localPlayerIndex ||
    view.battle?.battleId !== choice.battleId || view.battle.defender !== view.localPlayerIndex || view.battle.step !== "damage") throw new Error("No local damage choice");
  return { kind: "testDamageChoice", matchId: view.matchId, resolutionId: view.effect.resolutionId, requestId,
    expectedMovementRevision: view.movement.revision, expectedProgressionRevision: view.progression.revision,
    battleId: choice.battleId, selectionId: choice.selectionId, token };
}

export function acceptEffectView(current: EffectTransportView | null, next: EffectTransportView): boolean {
  return !current || (current.matchId === next.matchId && current.localPlayerIndex === next.localPlayerIndex &&
    next.movement.revision >= current.movement.revision && next.progression.revision >= current.progression.revision);
}
export function effectCommand(view: EffectTransportView, kind: EffectCommandKind, requestId: string, tokens: readonly string[] = []): EffectCommand {
  if (view.effect.status === "idle") throw new Error("No running effect");
  const base = { matchId: view.matchId, resolutionId: view.effect.resolutionId, requestId,
    expectedMovementRevision: view.movement.revision, expectedProgressionRevision: view.progression.revision };
  if (kind === "answerCosts" || kind === "answerEffect") {
    if (!view.selection || view.selection.chooser !== view.localPlayerIndex) throw new Error("No local selection");
    return { ...base, kind, selectionId: view.selection.selectionId, tokens: [...tokens] };
  }
  return { ...base, kind };
}
export function effectBoardView(view: EffectTransportView): MatchView {
  if (view.movement.players.length !== 2 || view.movement.players.some(p => p.attachedDon.length || p.resolving.length)) throw new Error("Unsupported effect board zones");
  const players = view.movement.players.map((player, owner) => ({ zones: Object.fromEntries(zones.map(zone => [zone, player[zone].map((card, index) => card === null ? null : {
    id: card.ref?.instanceId ?? `hidden:${owner}:${zone}:${index}`, cardId: card.cardId, kind: card.kind === "unknown" ? null : card.kind,
    rotated: card.rotated, faceUp: card.faceUp,
  })])) })) as MatchView["players"];
  return { matchId: view.matchId, revision: view.movement.revision, localPlayerIndex: view.localPlayerIndex, players,
    attack: view.battle ? { actor: view.battle.attacker, sourceId: view.battle.source.instanceId, targetId: view.battle.target.instanceId } : null, masterVersion: view.effect.masterVersion };
}
