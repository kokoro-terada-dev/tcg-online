import type { DeepReadonly, Evaluation, Scalar, Value } from "./types";

export type FactValue = Scalar | readonly Scalar[];
export type FactRecord = Readonly<Record<string, FactValue | undefined>>;
// Only authoritative server snapshots may populate these facts, never player views.
export type Facts = Readonly<{
  self?: FactRecord; opponent?: FactRecord;
  source?: FactRecord | null; target?: FactRecord | null; eventSource?: FactRecord | null;
  game?: FactRecord; event?: FactRecord;
  variables?: ReadonlyMap<string, Evaluation<FactValue>>;
}>;
export const unknown = (reason: string): Evaluation<never> => Object.freeze({ state: "unknown", reason });
export const known = <T>(value: T): Evaluation<T> => Object.freeze({ state: "known", value });
export class ConditionError extends Error {
  constructor(message: string) { super(message); this.name = "ConditionError"; }
}
const fields = {
  SELF: ["lifeCount", "handCount", "characterCount"], OPPONENT: ["lifeCount", "handCount", "characterCount"],
  SOURCE: ["id", "name", "type", "cost", "power", "traits", "attributes", "colors", "abilities", "zone", "rotated", "enteredTurn"],
  TARGET: ["id", "name", "type", "cost", "power", "traits", "attributes", "colors", "abilities", "zone", "rotated", "enteredTurn"],
  EVENT_SOURCE: ["id", "name", "type", "cost", "power", "traits", "attributes", "colors", "abilities", "zone", "rotated", "enteredTurn"],
  GAME: ["turnNumber", "activePlayer", "phase"], EVENT: ["type", "cause", "controller", "sourceId"],
};
const numeric = new Set(["lifeCount", "handCount", "characterCount", "cost", "power", "enteredTurn", "turnNumber", "activePlayer", "controller"]);
const lists = new Set(["traits", "attributes", "colors", "abilities"]);

function own(object: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
}
function scalar(value: unknown): value is Scalar {
  return value === null || (typeof value === "string" && value.length <= 4096) || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
}
function safeValue(value: unknown): Evaluation<FactValue> {
  if (scalar(value)) return known(value);
  if (Array.isArray(value) && value.length <= 128) {
    const copy: Scalar[] = [];
    for (let i = 0; i < value.length; i++) {
      const element = own(value, String(i));
      if (!scalar(element)) return unknown("invalid-runtime-list");
      copy.push(element);
    }
    return known(Object.freeze(copy));
  }
  return unknown("invalid-runtime-value");
}

export function resolveValue(value: DeepReadonly<Value>, facts: Facts): Evaluation<FactValue> {
  if (!value || typeof value !== "object") throw new ConditionError("Invalid value expression");
  if (value.kind === "literal") {
    const result = safeValue(value.value);
    if (result.state === "unknown") throw new ConditionError("Invalid DSL literal");
    return result;
  }
  if (value.kind !== "ref") throw new ConditionError("Unknown value expression");
  if (value.from === "VARIABLE") {
    const result = facts.variables?.get(value.name);
    if (!result) return unknown("variable-unavailable");
    if (result.state === "unknown") return unknown(result.reason);
    if (result.state !== "known") return unknown("invalid-variable-result");
    return safeValue(result.value);
  }
  if (!Object.hasOwn(fields, value.from)) throw new ConditionError("Unknown reference source");
  const allowed = fields[value.from];
  if (!allowed?.includes(value.field)) throw new ConditionError("Unknown reference field");
  const source = value.from === "SELF" ? facts.self : value.from === "OPPONENT" ? facts.opponent : value.from === "SOURCE" ? facts.source : value.from === "TARGET" ? facts.target : value.from === "EVENT_SOURCE" ? facts.eventSource : value.from === "GAME" ? facts.game : facts.event;
  if (source === undefined) return unknown("reference-context-unavailable");
  if (source === null) return known(null);
  const raw = own(source, value.field);
  if (raw === undefined || raw === null) return unknown("field-unavailable");
  if (numeric.has(value.field)) {
    if (typeof raw !== "number" || !Number.isSafeInteger(raw)) return unknown("invalid-numeric-fact");
    if (value.field !== "power" && raw < 0) return unknown("invalid-negative-fact");
    if (value.field === "turnNumber" && raw < 1) return unknown("invalid-turn-number");
    if ((value.field === "controller" || value.field === "activePlayer") && raw !== 0 && raw !== 1) return unknown("invalid-player-fact");
  } else if (lists.has(value.field)) {
    const result = safeValue(raw);
    if (result.state === "unknown" || !Array.isArray(result.value) || !result.value.every(v => typeof v === "string")) return unknown("invalid-string-list-fact");
    return result;
  } else if (value.field === "rotated") {
    if (typeof raw !== "boolean") return unknown("invalid-boolean-fact");
  } else if (typeof raw !== "string") return unknown("invalid-text-fact");
  return safeValue(raw);
}
