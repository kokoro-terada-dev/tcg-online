import type { V3FixtureView, V3FixtureCommand } from "../../server/src/test/effects/v3/fixtureProtocol";
import type { MatchView, Zone } from "../../server/src/test/protocol";
export function acceptV3View(current: V3FixtureView | null, next: V3FixtureView, matchId: string | null): boolean {
  return next.matchId === matchId && (!current || next.matchId === current.matchId && next.localPlayerIndex === current.localPlayerIndex && next.frame.resolutionId === current.frame.resolutionId &&
    next.frame.revision >= current.frame.revision && next.movement.revision >= current.movement.revision && next.progression.revision >= current.progression.revision);
}
export function v3Command(view: V3FixtureView, kind: V3FixtureCommand["kind"], requestId: string, tokens: readonly string[] = []): V3FixtureCommand {
  const base = { kind, requestId, matchId: view.matchId, resolutionId: view.frame.resolutionId, frameRevision: view.frame.revision, movementRevision: view.movement.revision, progressionRevision: view.progression.revision };
  if (kind === "answer") {
    const choice = view.frame.choice;
    if (view.frame.status !== "waitingForChoice" || !choice || choice.chooser !== view.localPlayerIndex || new Set(tokens).size !== tokens.length || tokens.length < choice.min || tokens.length > choice.max || !tokens.every(token => choice.options.some(option => option.token === token))) throw new Error("No current local v3 selection");
    return { ...base, kind, selectionId: choice.selectionId, tokens: [...tokens] };
  }
  if (view.actor !== view.localPlayerIndex || view.frame.status !== (kind === "advance" ? "ready" : "waitingForWork")) throw new Error("No current local v3 operation");
  return { ...base, kind };
}
export function v3BoardView(view: Pick<V3FixtureView, "matchId" | "movement" | "localPlayerIndex" | "imageAliases">): MatchView {
  const zones: readonly Zone[] = ["hand", "deck", "life", "trash", "public", "character", "stage", "leader", "donDeck", "activeDon", "restDon"];
  return { matchId: view.matchId, revision: view.movement.revision, localPlayerIndex: view.localPlayerIndex, attack: null, masterVersion: null,
    players: view.movement.players.map((player, owner) => ({ zones: Object.fromEntries(zones.map(zone => [zone, player[zone].map((card, index) => card ? {
      id: card.ref?.instanceId ?? `hidden:${owner}:${zone}:${index}`, cardId: card.cardId ? view.imageAliases[card.cardId] ?? card.cardId : null,
      kind: card.kind === "unknown" ? null : card.kind, rotated: card.rotated, faceUp: card.faceUp,
    } : null)])) })) as MatchView["players"] };
}
