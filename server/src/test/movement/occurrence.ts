import type { MovementEvent, MovementState } from "./types";

export type MovementOccurrence = Readonly<{
  transactionId: string; before: MovementState; after: MovementState; events: readonly MovementEvent[];
}>;
const tracked = new WeakSet<MovementState>();
const occurrences = new WeakMap<MovementEvent, MovementOccurrence>();

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
