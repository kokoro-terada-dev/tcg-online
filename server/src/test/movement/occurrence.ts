import type { MovementEvent, MovementState } from "./types";

export type MovementOccurrence = Readonly<{
  transactionId: string; before: MovementState; after: MovementState; events: readonly MovementEvent[];
}>;
const tracked = new WeakSet<MovementState>();
const occurrences = new WeakMap<MovementEvent, MovementOccurrence>();
const characterEntryBatch = new WeakSet<MovementEvent>();

// Only the effect coordinator certifies a committed simultaneous character entry.
export function markCharacterEntryBatch(events: readonly MovementEvent[]): void {
  for (const event of events)
    if (event.kind === "moved" && event.from?.zone === "hand" && event.to?.zone === "character") characterEntryBatch.add(event);
}
export function isCharacterEntryBatch(event: MovementEvent): boolean { return characterEntryBatch.has(event); }

// Opt-in server-only evidence. Neither snapshots nor this journal are movement DTOs.
export function trackMovementOccurrences(state: MovementState): void { tracked.add(state); }
export function inheritMovementTracking(from: MovementState, to: MovementState): void {
  if (tracked.has(from)) tracked.add(to);
}
export function recordMovementOccurrence(before: MovementState, after: MovementState, events: readonly MovementEvent[]): void {
  if (!tracked.has(before)) return;
  tracked.add(after);
  const occurrence = Object.freeze({ transactionId: after.appliedTransactions[after.appliedTransactions.length - 1]!, before, after, events });
  for (const event of events) occurrences.set(event, occurrence);
}
export function movementOccurrence(event: MovementEvent): MovementOccurrence | undefined { return occurrences.get(event); }
