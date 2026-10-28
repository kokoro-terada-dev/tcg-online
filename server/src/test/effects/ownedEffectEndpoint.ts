import { EffectMatchOwner } from "./effectMatchOwner";
import type { EffectCommandResponse, EffectTransportView } from "./effectCommandHost";
import type { Player } from "../movement/types";
import { dataObject, ensureMove, id, reference } from "../movement/state";
import type { CardObjectRef } from "./types";
import type { EffectCatalogView } from "../effectProtocol";

export class OwnedEffectUnavailable extends Error {
  constructor() { super("owned-effect-unavailable"); }
}

// Stable server-owned endpoint across resolution changes. Never exposes the raw per-effect Host.
export class OwnedEffectEndpoint {
  #owner: EffectMatchOwner;
  constructor(owner: EffectMatchOwner) { this.#owner = owner; }
  available(): boolean { return this.#owner.effectViewFor(0) !== null; }
  viewFor(viewer: Player): EffectTransportView {
    const view = this.#owner.effectViewFor(viewer);
    if (!view) throw new OwnedEffectUnavailable();
    return view;
  }
  handle(actor: Player, input: unknown): EffectCommandResponse {
    if (input && typeof input === "object" && Object.getOwnPropertyDescriptor(input, "kind")?.value === "activateRegistered") return this.#owner.activateRegistered(actor, input);
    const result = this.#owner.handleEffect(actor, input);
    if (!("view" in result)) throw new OwnedEffectUnavailable();
    return result;
  }
  catalogFor(actor: Player, input: unknown): EffectCatalogView {
    dataObject(input, ["matchId", "expectedMovementRevision", "expectedProgressionRevision", "source"]);
    id(input.matchId); reference(input.source as CardObjectRef);
    ensureMove(Number.isSafeInteger(input.expectedMovementRevision) && (input.expectedMovementRevision as number) >= 0 &&
      Number.isSafeInteger(input.expectedProgressionRevision) && (input.expectedProgressionRevision as number) >= 0, "invalid-effect-catalog-revision");
    return this.#owner.registeredEffectsFor(actor, { matchId: input.matchId, expectedMovementRevision: input.expectedMovementRevision as number,
      expectedProgressionRevision: input.expectedProgressionRevision as number, source: { ...(input.source as CardObjectRef) } });
  }
  toJSON(): never { throw new Error("server-only-owned-effect-endpoint"); }
}
