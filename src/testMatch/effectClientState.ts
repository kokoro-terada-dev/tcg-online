import type { EffectTransportView, EffectCommand, EffectCommandKind, EffectCatalogQuery, EffectCatalogView, RegisteredEffectCommand, TestTurnCommand, TestPlayCardCommand } from "../../server/src/test/effectProtocol";
import type { MatchView, Zone } from "../../server/src/test/protocol";
export type { EffectTransportView, EffectCommandKind, EffectCatalogQuery, EffectCatalogView, RegisteredEffectCommand, TestTurnCommand, TestPlayCardCommand };
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
  return { matchId: view.matchId, revision: view.movement.revision, localPlayerIndex: view.localPlayerIndex, players, attack: null, masterVersion: view.effect.masterVersion };
}
