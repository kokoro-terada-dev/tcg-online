import type { MovementState, MovementView, MovementCardView, Player, PublicMovementEvent, TransactionResult, MovementZone } from "./types";
import { freezeMovement, MOVEMENT_ZONES, player, validateMovementState } from "./state";
import { visibleTo } from "./engine";

export function projectMovementState(state: MovementState, viewer: Player): MovementView {
  player(viewer); validateMovementState(state);
  const players = state.players.map((zones, owner) => Object.fromEntries(MOVEMENT_ZONES.map(zone => {
    // Cost-area DON positions must not disclose the order of hidden parent moves.
    const ids = ["activeDon", "restDon", "attachedDon"].includes(zone) ? [...zones[zone]].sort() : zones[zone];
    return [zone, ids.map((id): MovementCardView | null => {
    if (id === null) return null;
    const card = state.cards[id]!, visible = visibleTo(state, card, { player: owner as Player, zone }, viewer);
    return { ref: visible ? { instanceId: card.instanceId, generation: card.generation } : null, cardId: visible ? card.cardId : null, kind: visible ? card.kind : null,
      faceUp: visible, rotated: visible && card.rotated, attachedTo: visible && card.attachedTo ? { ...card.attachedTo } : null };
    })];
  })) as Record<MovementZone, (MovementCardView | null)[]>);
  return freezeMovement({ matchId: state.matchId, revision: state.revision, players });
}

export function projectMovementEvents(result: TransactionResult, viewer: Player): readonly PublicMovementEvent[] {
  player(viewer);
  const hiddenGroups = new Map<string, Omit<PublicMovementEvent, "sequence">>();
  const rows = result.events.flatMap((event): Omit<PublicMovementEvent, "sequence">[] => {
    const visible = event.visibleBefore.includes(viewer) || event.visibleAfter.includes(viewer);
    if ((event.kind === "revealed" || event.kind === "revealsClosed") && !visible) return [];
    if (event.kind === "moved" && event.to && event.to.player !== viewer && ["deck", "hand", "life"].includes(event.to.zone) && !event.visibleAfter.includes(viewer)) {
      const key = JSON.stringify(event.to), previous = hiddenGroups.get(key);
      hiddenGroups.set(key, { revision: result.state.revision, kind: "moved", count: (previous?.count ?? 0) + 1, from: null, to: event.to, cardId: null, isKO: false,
        cause: { kind: previous && previous.cause.kind !== event.cause.kind ? "OTHER" : event.cause.kind, actor: event.cause.actor } });
      return [];
    }
    return [{ revision: result.state.revision, count: 1, kind: event.kind, from: event.from, to: event.to,
      cardId: visible ? event.after?.cardId ?? event.before?.cardId ?? null : null,
      isKO: event.isKO, cause: { kind: event.cause.kind, actor: event.cause.actor } }];
  });
  rows.push(...hiddenGroups.values());
  // Associated public DON returns must not act as a hidden-order side channel.
  if (hiddenGroups.size) rows.sort((a, b) => { const left = JSON.stringify(a), right = JSON.stringify(b); return left < right ? -1 : left > right ? 1 : 0; });
  return freezeMovement(rows.map((event, sequence) => ({ ...event, sequence })));
}
