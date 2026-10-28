import { Buffer } from "node:buffer";
import { DefinitionError, sealRegistries } from "./registry";
import type { Registries, ValidationContext, Parser, StepEstimator } from "./registry";
import type { Action, BindingType, Category, Destination, EffectDefinition, NodeFor, Scope, ValidatedDefinition, Value, Scalar } from "./types";
import { createBuiltinRegistries } from "./builtins";

export const LIMITS = Object.freeze({ bytes: 65536, depth: 24, nodes: 4096, array: 128, string: 4096, steps: 4096, repeat: 20 });
const forbiddenKeys = new Set(["__proto__", "prototype", "constructor"]);
const playerFields = ["lifeCount", "handCount", "characterCount"];
const cardFields = ["id", "name", "type", "cost", "power", "traits", "attributes", "colors", "abilities", "zone", "rotated", "enteredTurn"];
export const ZONES = ["deck", "hand", "life", "character", "leader", "stage", "donDeck", "activeDon", "restDon", "trash", "public", "resolving"] as const;

export function fail(path: string, message: string): never { throw new DefinitionError(path, message); }
export function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(path, "expected an object");
  return value as Record<string, unknown>;
}
export function keys(value: Record<string, unknown>, required: string[], optional: string[], path: string): void {
  for (const key of required) if (!Object.hasOwn(value, key)) fail(`${path}.${key}`, "required field");
  for (const key of Object.keys(value)) if (!required.includes(key) && !optional.includes(key)) fail(`${path}.${key}`, "unknown field");
}
export function text(value: unknown, path: string, max = 120): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\x00-\x1f]/.test(value)) fail(path, "expected nonempty bounded text");
  return value;
}
export function identifier(value: unknown, path: string): string {
  const name = text(value, path, 100);
  if (!/^[A-Za-z][A-Za-z0-9_.-]*$/.test(name) || forbiddenKeys.has(name)) fail(path, "invalid identifier");
  return name;
}
export function integer(value: unknown, path: string, min = 0, max = 128): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) fail(path, `expected integer ${min}..${max}`);
  return value;
}
export function oneOf<const T extends readonly string[]>(value: unknown, choices: T, path: string): T[number] {
  if (typeof value !== "string" || !choices.includes(value)) fail(path, `expected one of ${choices.join(", ")}`);
  return value as T[number];
}
export function array(value: unknown, path: string, min = 0): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > LIMITS.array) fail(path, "invalid array length");
  return value;
}
export function fork(scope: Scope, targetAllowed = scope.targetAllowed): Scope { return { bindings: new Map(scope.bindings), targetAllowed }; }

// Iterative inspection rejects cyclic/non-JSON objects before recursive parsers run.
function inspect(input: unknown): void {
  const stack = [{ value: input, depth: 0 }];
  const seen = new WeakSet<object>(); let nodes = 0;
  while (stack.length) {
    const { value, depth } = stack.pop()!;
    if (++nodes > LIMITS.nodes || depth > LIMITS.depth) fail("$", "document complexity limit exceeded");
    if (value === null || typeof value === "boolean") continue;
    if (typeof value === "number") { if (!Number.isFinite(value)) fail("$", "non-finite number"); continue; }
    if (typeof value === "string") { if (value.length > LIMITS.string) fail("$", "string too long"); continue; }
    if (typeof value !== "object") fail("$", "non-JSON value");
    if (seen.has(value)) fail("$", "cyclic or shared object reference");
    seen.add(value);
    const prototype = Object.getPrototypeOf(value);
    if (Array.isArray(value)) {
      if (prototype !== Array.prototype || value.length > LIMITS.array) fail("$", "invalid array");
    } else if (prototype !== Object.prototype && prototype !== null) fail("$", "non-plain object");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== "string" || forbiddenKeys.has(key)) fail("$", "unsafe key");
      if (Array.isArray(value) && key === "length") continue;
      if (Array.isArray(value) && !/^(0|[1-9][0-9]*)$/.test(key)) fail("$", "array has extra properties");
      const descriptor = descriptors[key]!;
      if (!Object.hasOwn(descriptor, "value") || !descriptor.enumerable) fail("$", "accessors/non-enumerable properties are not JSON");
      stack.push({ value: descriptor.value, depth: depth + 1 });
    }
    if (Array.isArray(value) && Object.keys(value).length !== value.length) fail("$", "sparse array");
  }
  if (Buffer.byteLength(JSON.stringify(input), "utf8") > LIMITS.bytes) fail("$", "document byte limit exceeded");
}

export function validateEffectDefinition(input: unknown, registries: Registries = createBuiltinRegistries()): ValidatedDefinition {
  inspect(input);
  sealRegistries(registries);
  const root = object(input, "$");
  keys(root, ["dslVersion", "effectId", "cardId", "trigger", "costs", "actions"], ["condition"], "$");
  if (root.dslVersion !== 1) fail("$.dslVersion", "unsupported DSL version");
  let parsedNodes = 0;
  function context(path: string, scope: Scope): ValidationContext {
    return {
      path, scope,
      read<C extends Category>(category: C, value: unknown, childPath: string, childScope = scope): NodeFor<C> {
        if (++parsedNodes > LIMITS.nodes) fail(childPath, "parsed node limit exceeded");
        const raw = object(value, childPath);
        const kind = text(raw.kind, `${childPath}.kind`);
        const entry = registries[category].get(kind);
        if (!entry) fail(childPath, `unknown ${category} command: ${kind}`);
        const node = (entry.parse as Parser<NodeFor<C>>)(raw, context(childPath, childScope));
        if (object(node, childPath).kind !== kind) fail(childPath, "registry returned mismatched kind");
        return node;
      },
      value(value: unknown, childPath: string): Value {
        const raw = object(value, childPath);
        if (raw.kind === "literal") {
          keys(raw, ["kind", "value"], [], childPath);
          const scalar = (v: unknown) => v === null || ["string", "boolean", "number"].includes(typeof v);
          if (!scalar(raw.value) && !(Array.isArray(raw.value) && raw.value.every(scalar))) fail(childPath, "literal must be scalar or scalar array");
          return { kind: "literal", value: (Array.isArray(raw.value) ? [...raw.value] : raw.value) as Scalar | Scalar[] };
        }
        if (raw.kind !== "ref") fail(childPath, "unknown value expression");
        if (raw.from === "VARIABLE") {
          keys(raw, ["kind", "from", "name"], [], childPath);
          const name = identifier(raw.name, `${childPath}.name`);
          if (!scope.bindings.has(name)) fail(childPath, `unbound variable: ${name}`);
          return { kind: "ref", from: "VARIABLE", name };
        }
        keys(raw, ["kind", "from", "field"], [], childPath);
        const from = oneOf(raw.from, ["SELF", "OPPONENT", "SOURCE", "TARGET", "EVENT_SOURCE", "EVENT", "GAME"], childPath);
        if (from === "TARGET" && !scope.targetAllowed) fail(childPath, "TARGET is only available inside selector conditions");
        const fields = from === "SELF" || from === "OPPONENT" ? playerFields : from === "GAME" ? ["turnNumber", "activePlayer", "phase"] : from === "EVENT" ? ["type", "cause", "controller", "sourceId"] : cardFields;
        const field = oneOf(raw.field, fields, `${childPath}.field`);
        return { kind: "ref", from, field } as Value;
      },
      destination(value: unknown, childPath: string): Destination {
        const raw = object(value, childPath);
        keys(raw, ["zone", "owner", "position", "visibility"], [], childPath);
        return { zone: oneOf(raw.zone, ZONES, childPath), owner: oneOf(raw.owner, ["SELF", "OPPONENT"], childPath), position: oneOf(raw.position, ["top", "bottom", "append", "firstEmpty"], childPath), visibility: oneOf(raw.visibility, ["faceUp", "faceDown"], childPath) };
      },
      actions(value: unknown, childPath: string, childScope = scope): Action[] {
        return array(value, childPath).map((action, i) => context(childPath, childScope).read("action", action, `${childPath}[${i}]`));
      },
      bind(value: unknown, type: BindingType): string {
        const name = identifier(value, `${path}.saveAs`);
        if (scope.bindings.has(name)) fail(path, `duplicate binding: ${name}`);
        scope.bindings.set(name, type);
        return name;
      },
    };
  }
  const scope: Scope = { bindings: new Map(), targetAllowed: false };
  const ctx = context("$", scope);
  const trigger = ctx.read("trigger", root.trigger, "$.trigger");
  const condition = root.condition === undefined ? undefined : ctx.read("predicate", root.condition, "$.condition");
  const costs = array(root.costs, "$.costs").map((cost, i) => ctx.read("cost", cost, `$.costs[${i}]`));
  const actions = ctx.actions(root.actions, "$.actions");
  function estimate(nodes: Action[]): number {
    let total = 0;
    for (const node of nodes) {
      const entry = registries.action.get(node.kind)!;
      const cost = (entry.estimateSteps as StepEstimator<Action>)(node, estimate);
      if (!Number.isSafeInteger(cost) || cost < 1 || cost > LIMITS.steps) fail("$.actions", "invalid or excessive action step budget");
      total += cost;
      if (total > LIMITS.steps) fail("$.actions", "expanded action step limit exceeded");
    }
    return total;
  }
  const estimatedSteps = costs.length + estimate(actions);
  if (estimatedSteps > LIMITS.steps) fail("$", "effect step limit exceeded");
  const definition: EffectDefinition = { dslVersion: 1, effectId: identifier(root.effectId, "$.effectId"), cardId: identifier(root.cardId, "$.cardId"), trigger, ...(condition === undefined ? {} : { condition }), costs, actions };
  inspect(definition);
  const freeze = (value: unknown): void => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } };
  freeze(definition);
  return Object.freeze({ status: "schemaOnly", definition, estimatedSteps });
}

export function parseEffectDefinition(json: string, registries?: Registries): ValidatedDefinition {
  if (typeof json !== "string" || Buffer.byteLength(json, "utf8") > LIMITS.bytes) fail("$", "document byte limit exceeded");
  let value: unknown;
  try { value = JSON.parse(json); } catch { return fail("$", "invalid JSON"); }
  return validateEffectDefinition(value, registries);
}
