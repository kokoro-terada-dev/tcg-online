import { randomUUID } from "node:crypto";
import type { MovementEvent } from "../../movement/types";
import type { ApprovedV3Card } from "./approval";

export type PlayTrigger = Readonly<{ token: string; batchId: string; actor: 0 | 1; cardId: string; effectId: string; event: MovementEvent }>;
export const SYNTHETIC_TRIGGER_POLICY = "synthetic-on-play.batch-choice.2";

// Self-entry events only. Watcher abilities and official simultaneous-trigger rulings are not inferred.
export function playTriggerCandidates(events: readonly MovementEvent[], definitions: ReadonlyMap<string, ApprovedV3Card>) {
  return events.flatMap(event => {
    if (event.kind !== "moved" || !event.after || !event.to || !event.from || event.from.zone === event.to.zone || !event.after.faceUp ||
      !["character", "stage"].includes(event.to.zone) || event.after.kind !== event.to.zone || event.after.owner !== event.to.player || event.after.controller !== event.to.player) return [];
    const definition = definitions.get(event.after.cardId);
    return definition?.definition.effects.filter(effect => effect.kind === "triggered" && effect.timing.type === "ON_PLAY" && effect.sourceZones.some(zone => zone === event.to!.zone))
      .map(effect => ({ actor: event.after!.controller, cardId: event.after!.cardId, effectId: effect.id, event })) ?? [];
  });
}
export function enqueuePlayTriggers(events: readonly MovementEvent[], definitions: ReadonlyMap<string, ApprovedV3Card>): readonly PlayTrigger[] {
  const batchId = randomUUID();
  return playTriggerCandidates(events, definitions).map(candidate => ({ ...candidate, batchId, token: randomUUID() }));
}
// Preserve the earlier timing group before any derived events (CR 8-6-1).
export function triggerChooser(queue: readonly PlayTrigger[], activePlayer: 0 | 1): 0 | 1 | null {
  const first = queue[0]; if (!first) return null;
  return queue.some(entry => entry.batchId === first.batchId && entry.actor === activePlayer) ? activePlayer : (1 - activePlayer) as 0 | 1;
}
export function availableTriggers(queue: readonly PlayTrigger[], activePlayer: 0 | 1): readonly PlayTrigger[] {
  const first = queue[0], chooser = triggerChooser(queue, activePlayer);
  return first ? queue.filter(entry => entry.batchId === first.batchId && entry.actor === chooser) : [];
}
