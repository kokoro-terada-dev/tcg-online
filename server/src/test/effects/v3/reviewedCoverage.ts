import { dataArray, dataObject, ensureMove } from "../../movement/state";
import type { CompiledCard } from "./dsl";

export function verifyReviewedCoverage(review: unknown, definition: CompiledCard["definition"]): void {
  dataObject(review, ["status", "coverage"]);
  ensureMove(review.status === "verified", "v3-reviewed-coverage-unverified");
  dataArray(review.coverage, 256);
  const main = new Set<string>(), trigger = new Set<string>();
  for (const effect of definition.effects) (effect.timing.type === "TRIGGER" ? trigger : main).add(`effect:${effect.id}`);
  for (const keyword of definition.keywords) main.add(`keyword:${keyword.type}`);
  for (const effect of definition.continuousEffects ?? []) {
    ensureMove(effect.id, "v3-reviewed-coverage-handler-id-required"); main.add(`continuous:${effect.id}`);
  }
  for (const rule of definition.replacementEffects ?? []) main.add(`replacement:${rule.id}`);
  const seen = new Set<string>(), offsets = { text: 0, triggerText: 0 };
  for (const span of review.coverage) {
    dataObject(span, ["field", "start", "end", "references"]);
    const field = span.field;
    ensureMove(field === "text" || field === "triggerText", "v3-reviewed-coverage-field");
    const text = definition.source[field], start = span.start, end = span.end;
    ensureMove(typeof start === "number" && typeof end === "number" && Number.isSafeInteger(end) &&
      start === offsets[field] && start < end && end <= text.length, "v3-reviewed-coverage-gap");
    const allowed = field === "text" ? main : trigger;
    dataArray(span.references, 32);
    ensureMove(span.references.length > 0 && new Set(span.references).size === span.references.length, "v3-reviewed-coverage-reference");
    for (const reference of span.references) {
      ensureMove(typeof reference === "string" && allowed.has(reference), "v3-reviewed-coverage-reference"); seen.add(reference);
    }
    offsets[field] = end;
  }
  ensureMove(offsets.text === definition.source.text.length && offsets.triggerText === definition.source.triggerText.length &&
    [...main, ...trigger].every(reference => seen.has(reference)), "v3-reviewed-coverage-incomplete");
}
