import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import type { CardMetadata } from "./protocol";

export type EffectDefinition = Readonly<{ cardId: string; timing: string; displayText: string | null; implementation: "manual" | "unsupported" }>;
export type MasterSnapshot = Readonly<{ version: string; cards: Readonly<Record<string, Readonly<CardMetadata>>>; effects: Readonly<Record<string, EffectDefinition>>;
  factPresence?: Readonly<Record<string, readonly string[]>> }>;
const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const validId = (v: string) => /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(v);
const types = new Set(["leader", "character", "event", "stage", "don", "unknown"]);
const timings = new Set(["onPlay", "onAttack", "onKo", "activateMain", "main", "counter", "trigger", "continuous"]);
function number(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) throw new Error("Invalid numeric value");
  return v;
}
function strings(v: unknown): readonly string[] {
  if (v === undefined) return Object.freeze([]);
  if (!Array.isArray(v) || !v.every(s => typeof s === "string" && s.length > 0)) throw new Error("Invalid string list");
  return Object.freeze([...new Set(v as string[])]);
}
function nullableText(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v !== "string") throw new Error("Invalid text");
  return v.trim() || null;
}

export function parseMaster(raw: string): MasterSnapshot {
  const data: unknown = JSON.parse(raw);
  if (!isObject(data) || !isObject(data.cards) || ![undefined, 1, 2].includes(data.schemaVersion as number | undefined)) throw new Error("Unsupported card master");
  const cards: Record<string, Readonly<CardMetadata>> = Object.create(null);
  const factPresence: Record<string, readonly string[]> = Object.create(null);
  for (const [id, entry] of Object.entries(data.cards)) {
    if (!validId(id) || !isObject(entry) || typeof entry.type !== "string" || !types.has(entry.type)) throw new Error(`Invalid card: ${id}`);
    cards[id] = Object.freeze({ type: entry.type as CardMetadata["type"], name: nullableText(entry.name), cost: number(entry.cost), power: number(entry.power), counter: number(entry.counter), life: number(entry.life), colors: strings(entry.colors), attributes: strings(entry.attributes), traits: strings(entry.traits), effectIds: strings(entry.effectIds) });
    factPresence[id] = Object.freeze(["colors", "attributes", "traits"].filter(field => Object.hasOwn(entry, field)));
  }
  if (!Object.keys(cards).length) throw new Error("Empty card master");
  const effects: Record<string, EffectDefinition> = Object.create(null);
  if (data.effectDefinitions !== undefined) {
    if (!isObject(data.effectDefinitions)) throw new Error("Invalid effects");
    for (const [id, entry] of Object.entries(data.effectDefinitions)) {
      if (!validId(id) || !isObject(entry) || typeof entry.cardId !== "string" || !cards[entry.cardId] || typeof entry.timing !== "string" || !timings.has(entry.timing) || (entry.implementation !== "manual" && entry.implementation !== "unsupported")) throw new Error(`Invalid effect: ${id}`);
      effects[id] = Object.freeze({ cardId: entry.cardId, timing: entry.timing, displayText: nullableText(entry.displayText), implementation: entry.implementation });
    }
  }
  for (const [id, card] of Object.entries(cards)) for (const effectId of card.effectIds) {
    if (effects[effectId]?.cardId !== id) throw new Error(`Missing effect: ${effectId}`);
  }
  for (const [id, effect] of Object.entries(effects)) if (!cards[effect.cardId]!.effectIds.includes(id)) throw new Error(`Unlinked effect: ${id}`);
  const content = { cards: data.cards, effectDefinitions: data.effectDefinitions ?? {} };
  return Object.freeze({ version: createHash("sha256").update(JSON.stringify(content)).digest("hex"), cards: Object.freeze(cards), effects: Object.freeze(effects), factPresence: Object.freeze(factPresence) });
}

export function loadMaster(file = process.env.TEST_CARD_MASTER_PATH ?? resolve(__dirname, "../../../public/card-master.json")): MasterSnapshot | null {
  try { return parseMaster(readFileSync(file, "utf8")); }
  catch (error) { console.warn("[test-card-master] unavailable; metadata stays unknown:", error instanceof Error ? error.message : error); return null; }
}
