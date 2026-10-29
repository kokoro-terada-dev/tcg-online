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
export type SessionDetails = Readonly<{ effectId?: string; token?: string; tokens?: readonly string[]; count?: number; card?: Readonly<{ instanceId: string; generation: number }>; source?: Readonly<{ instanceId: string; generation: number }>; target?: Readonly<{ instanceId: string; generation: number }> }>;
export function v3SessionCommand(view: V3SessionView, kind: V3SessionCommand["kind"], requestId: string, details: SessionDetails = {}): V3SessionCommand {
  const base = { matchId: view.matchId, requestId, context: { ...view.context } }, ownTurn = view.activePlayer === view.localPlayerIndex;
  const idle = view.gate === "idle" && !view.outcome && !view.battle && (!view.frame || view.frame.status === "completed");
  if (kind === "attachDon") {
    if (!idle || !ownTurn || !details.target || !Number.isSafeInteger(details.count) || details.count! < 1 || details.count! > 10 || view.movement.players[view.localPlayerIndex].activeDon.length < details.count! ||
      !view.publicStats.some(card => card.player === view.localPlayerIndex && (card.zone === "leader" || card.zone === "character") && card.card.instanceId === details.target!.instanceId && card.card.generation === details.target!.generation)) throw Error("DON attachment is unavailable");
    return { ...base, kind, target: { ...details.target }, count: details.count! };
  }
  if (kind === "attack") {
    const includes = (rows: V3SessionView["attackChoices"]["sources"], ref: SessionDetails["source"]) => ref && rows.some(row => row.card.instanceId === ref.instanceId && row.card.generation === ref.generation);
    if (!idle || !ownTurn || !includes(view.attackChoices.sources, details.source) || !includes(view.attackChoices.targets, details.target)) throw Error("Attack is unavailable");
    return { ...base, kind, source: { ...details.source! }, target: { ...details.target! } };
  }
  if (kind === "passBlock" || kind === "endCounter" || kind === "damage" || kind === "counter") {
    const battle = view.battle, step = kind === "passBlock" ? "block" : kind === "damage" ? "damage" : "counter";
    if (!battle || battle.defender !== view.localPlayerIndex || battle.step !== step || view.gate !== "idle" || view.lifePending || view.pendingTriggerCount) throw Error("Battle action is unavailable");
    if (kind !== "counter") return { ...base, kind };
    if (!details.card || !details.target || !view.counterChoices.some(choice => choice.card.instanceId === details.card!.instanceId && choice.card.generation === details.card!.generation)) throw Error("Counter is unavailable");
    return { ...base, kind, card: { ...details.card }, target: { ...details.target } };
  }
  if (kind === "life") {
    if (!view.lifeChoice || view.lifeChoice.token !== details.token) throw Error("Life decision is unavailable");
    return { ...base, kind, selectionId: view.lifeChoice.selectionId, token: view.lifeChoice.token };
  }
  if (kind === "trigger") {
    if (view.gate !== "trigger" || view.triggerChooser !== view.localPlayerIndex || !view.triggerChoices.some(choice => choice.token === details.token)) throw Error("Trigger is unavailable");
    return { ...base, kind, token: details.token! };
  }
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
