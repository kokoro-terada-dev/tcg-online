import { EffectMatchOwner } from "./effectMatchOwner";
import type { EffectCommandResponse, EffectTransportView } from "./effectCommandHost";
import type { Player } from "../movement/types";

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
    const result = this.#owner.handleEffect(actor, input);
    if (!("view" in result)) throw new OwnedEffectUnavailable();
    return result;
  }
  toJSON(): never { throw new Error("server-only-owned-effect-endpoint"); }
}
