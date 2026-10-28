import { createHash } from "node:crypto";
import { dataArray, dataObject, ensureMove, freezeMovement } from "../movement/state";
import { validateEffectDefinition } from "./validation";
import type { DeepReadonly, EffectDefinition } from "./types";

export const EFFECT_CATALOG_LIMITS = Object.freeze({ definitions: 4096, bytes: 8 * 1024 * 1024 });
export class EffectCatalog {
  readonly version: string;
  #definitions = new Map<string, DeepReadonly<EffectDefinition>>();
  constructor(input: unknown) {
    dataArray(input, EFFECT_CATALOG_LIMITS.definitions);
    let bytes = 2;
    for (const raw of input) {
      const definition = validateEffectDefinition(raw).definition;
      ensureMove(!this.#definitions.has(definition.effectId), "duplicate-catalog-effect-id");
      bytes += Buffer.byteLength(JSON.stringify(definition), "utf8") + 1;
      ensureMove(bytes <= EFFECT_CATALOG_LIMITS.bytes, "effect-catalog-byte-limit");
      this.#definitions.set(definition.effectId, definition);
    }
    const sorted = [...this.#definitions.values()].sort((a, b) => a.effectId < b.effectId ? -1 : a.effectId > b.effectId ? 1 : 0);
    this.version = createHash("sha256").update(JSON.stringify({ catalogVersion: 1, definitions: sorted })).digest("hex");
    Object.freeze(this);
  }
  resolve(effectId: string, cardId: string): DeepReadonly<EffectDefinition> | null {
    const definition = this.#definitions.get(effectId);
    return definition?.cardId === cardId ? definition : null;
  }
  listForCard(cardId: string) {
    return freezeMovement([...this.#definitions.values()].filter(definition => definition.cardId === cardId).sort((a, b) => a.effectId < b.effectId ? -1 : a.effectId > b.effectId ? 1 : 0)
      .map(definition => ({ effectId: definition.effectId, trigger: definition.trigger, status: "schemaOnly" as const })));
  }
  toJSON(): never { throw new Error("server-only-effect-catalog"); }
}
export function parseEffectCatalog(json: string): EffectCatalog {
  ensureMove(typeof json === "string" && Buffer.byteLength(json, "utf8") <= EFFECT_CATALOG_LIMITS.bytes, "effect-catalog-byte-limit");
  const input: unknown = JSON.parse(json);
  dataObject(input, ["catalogVersion", "definitions"]);
  ensureMove(input.catalogVersion === 1, "unsupported-effect-catalog-version");
  return new EffectCatalog(input.definitions);
}
