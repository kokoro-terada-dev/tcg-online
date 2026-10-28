import type { V3SessionView, V3SessionCommand } from "../../server/src/test/effects/v3/sessionProtocol";
export function acceptV3SessionView(current: V3SessionView | null, next: V3SessionView, matchId: string | null): boolean {
  if (next.mode !== "v3-synthetic-session" || next.matchId !== matchId || next.context.movementRevision !== next.movement.revision ||
    next.context.resolutionId !== (next.frame?.resolutionId ?? null) || next.context.frameRevision !== (next.frame?.revision ?? null)) return false;
  if (!current) return true;
  if (next.matchId !== current.matchId || next.localPlayerIndex !== current.localPlayerIndex || next.context.revision < current.context.revision ||
    next.context.movementRevision < current.context.movementRevision || next.context.progressionRevision < current.context.progressionRevision || next.turnNumber < current.turnNumber) return false;
  return next.context.revision !== current.context.revision || next.context.resolutionId === current.context.resolutionId && next.context.frameRevision === current.context.frameRevision &&
    next.context.movementRevision === current.context.movementRevision && next.context.progressionRevision === current.context.progressionRevision;
}
export type SessionDetails = Readonly<{ effectId?: string; tokens?: readonly string[]; card?: Readonly<{ instanceId: string; generation: number }> }>;
export function v3SessionCommand(view: V3SessionView, kind: V3SessionCommand["kind"], requestId: string, details: SessionDetails = {}): V3SessionCommand {
  const base = { matchId: view.matchId, requestId, context: { ...view.context } }, ownTurn = view.activePlayer === view.localPlayerIndex;
  const idle = view.gate === "idle" && (!view.frame || view.frame.status === "completed");
  if (kind === "activate") {
    if (!ownTurn || !idle || !view.effects.some(effect => effect.effectId === details.effectId && effect.enabled)) throw Error("Effect is unavailable");
    return { ...base, kind, effectId: details.effectId! };
  }
  if (kind === "play") {
    if (!ownTurn || !idle || !details.card || !view.playableCards.some(play => play.enabled && play.card.instanceId === details.card!.instanceId && play.card.generation === details.card!.generation)) throw Error("Card is unavailable");
    return { ...base, kind, card: { ...details.card } };
  }
  if (kind === "endTurn") { if (!ownTurn || !idle) throw Error("Turn cannot end"); return { ...base, kind }; }
  if (kind === "answer") {
    const choice = view.frame?.choice, tokens = details.tokens ?? [];
    if (view.frame?.status !== "waitingForChoice" || !choice || choice.chooser !== view.localPlayerIndex || new Set(tokens).size !== tokens.length || tokens.length < choice.min ||
      tokens.length > choice.max || !tokens.every(token => choice.options.some(option => option.token === token))) throw Error("No current local session choice");
    return { ...base, kind, selectionId: choice.selectionId, tokens: [...tokens] };
  }
  if (view.resolutionActor !== view.localPlayerIndex || view.frame?.status !== (kind === "advance" ? "ready" : "waitingForWork")) throw Error("No current local session work");
  return { ...base, kind };
}
