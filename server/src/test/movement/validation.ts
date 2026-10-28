import type { Location, MovementTransaction } from "./types";
import { dataArray, dataObject, ensureMove, id, MOVEMENT_LIMITS, MOVEMENT_ZONES, player, reference } from "./state";

function at(value: Location): void {
  dataObject(value, ["player", "zone"]); player(value.player); ensureMove(MOVEMENT_ZONES.includes(value.zone), "unknown-movement-zone");
}
export function validateMovementTransaction(value: MovementTransaction): void {
  dataObject(value, ["transactionId", "matchId", "expectedRevision", "turnNumber", "actor", "effectController", "source", "mode", "resolutionId", "operations"]);
  id(value.transactionId, 80); id(value.matchId); player(value.actor);
  ensureMove(Number.isSafeInteger(value.expectedRevision) && value.expectedRevision >= 0 && Number.isSafeInteger(value.turnNumber) && value.turnNumber >= 1, "invalid-transaction-version");
  if (value.effectController !== null) player(value.effectController);
  if (value.source !== null) reference(value.source);
  if (value.resolutionId !== null) id(value.resolutionId);
  ensureMove(["effect", "cost", "rule"].includes(value.mode), "invalid-transaction-mode");
  dataArray(value.operations, MOVEMENT_LIMITS.operations);
  for (const operation of value.operations) {
    ensureMove(operation && typeof operation === "object", "invalid-movement-operation");
    const kind = Object.getOwnPropertyDescriptor(operation, "kind"); ensureMove(kind && Object.hasOwn(kind, "value"), "invalid-operation-kind");
    switch (kind.value) {
      case "move": {
        dataObject(operation, ["kind", "card", "from", "to", "cause"]);
        ensureMove(operation.kind === "move", "invalid-operation-kind"); reference(operation.card); at(operation.from);
        dataObject(operation.to, ["player", "zone", "position", "faceUp", "rotated"], ["slotIndex"]);
        at({ player: operation.to.player, zone: operation.to.zone });
        ensureMove(["top", "bottom", "append", "firstEmpty", "slot"].includes(operation.to.position) && typeof operation.to.faceUp === "boolean" && typeof operation.to.rotated === "boolean", "invalid-movement-destination");
        if (operation.to.slotIndex !== undefined) ensureMove(Number.isSafeInteger(operation.to.slotIndex) && operation.to.slotIndex >= 0 && operation.to.slotIndex < 5, "invalid-slot-index");
        ensureMove(["BATTLE_KO", "EFFECT_KO", "EFFECT_MOVE", "COST_PAYMENT", "RULE_PROCESSING", "DAMAGE", "OTHER"].includes(operation.cause), "unknown-move-cause"); break;
      }
      case "setRest": dataObject(operation, ["kind", "card", "rotated"]); ensureMove(operation.kind === "setRest" && typeof operation.rotated === "boolean", "invalid-rest-operation"); reference(operation.card); break;
      case "attachDon": dataObject(operation, ["kind", "card", "target"]); ensureMove(operation.kind === "attachDon", "invalid-attachment-operation"); reference(operation.card); reference(operation.target); break;
      case "reorder": {
        dataObject(operation, ["kind", "location", "cards", "conceal"]); ensureMove(operation.kind === "reorder" && typeof operation.conceal === "boolean", "invalid-reorder-operation");
        at(operation.location); dataArray(operation.cards, MOVEMENT_LIMITS.cards); operation.cards.forEach(reference); break;
      }
      case "reveal": dataObject(operation, ["kind", "card", "scopeId", "viewers"]); ensureMove(operation.kind === "reveal", "invalid-reveal-operation"); reference(operation.card); id(operation.scopeId); dataArray(operation.viewers, 2); operation.viewers.forEach(player); break;
      case "closeReveals": dataObject(operation, ["kind", "scopeId"]); ensureMove(operation.kind === "closeReveals", "invalid-close-operation"); id(operation.scopeId); break;
      default: ensureMove(false, "unknown-movement-operation");
    }
  }
}
