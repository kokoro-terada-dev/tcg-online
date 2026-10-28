import { createHash } from "node:crypto";
import { dataArray, dataObject, ensureMove, freezeMovement } from "../../movement/state";
import type { CardDefinition, Category, CompiledCard, Node, NodeMeta, Value } from "./dsl";

export const COMPILER_VERSION = "v3-subset-compiler.1";
const compiled = new WeakSet<object>();
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
function inspectData(input: unknown): void {
  let inspected = 0; const seen = new WeakSet<object>(), stack = [{ value: input, depth: 0 }];
  while (stack.length) {
    const node = stack.pop()!; ensureMove(++inspected <= 4096 && node.depth <= 24, "v3-complexity-limit");
    const value = node.value;
    if (value === null || typeof value === "boolean") continue;
    if (typeof value === "string") { ensureMove(value.length <= 32768, "v3-string-limit"); continue; }
    if (typeof value === "number") { ensureMove(Number.isSafeInteger(value), "v3-non-json-number"); continue; }
    ensureMove(typeof value === "object" && !seen.has(value), "v3-non-json-or-cyclic-plan"); seen.add(value);
    if (Array.isArray(value)) dataArray(value, 128);
    else {
      ensureMove(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null, "v3-non-plain-object");
      for (const key of Reflect.ownKeys(value)) {
        ensureMove(typeof key === "string" && !["__proto__", "prototype", "constructor"].includes(key), "v3-unsafe-key");
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
        ensureMove(Object.hasOwn(descriptor, "value") && descriptor.enumerable, "v3-accessor-plan");
      }
    }
    stack.push(...Object.values(value).map(value => ({ value, depth: node.depth + 1 })));
  }
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
export function label(value: unknown, max = 100): string {
  ensureMove(typeof value === "string" && value.length > 0 && value.length <= max && /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(value) && !["constructor", "prototype"].includes(value), "invalid-v3-identifier");
  return value;
}
export function count(value: unknown): number {
  ensureMove(typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 50, "invalid-v3-count"); return value;
}
export interface CompileContext {
  read<C extends Category>(category: C, input: unknown): Node<C>;
  list<C extends Category>(category: C, input: unknown): Node<C>[];
  fields(input: Record<string, unknown>, required: string[]): NodeMeta;
}
type Parser<C extends Category> = (input: Record<string, unknown>, context: CompileContext) => Node<C>;
export class V3Registry<C extends Category> {
  #entries = new Map<string, { version: string; parse: Parser<C> }>();
  #sealed = false;
  register<K extends keyof import("./dsl").Categories[C] & string>(type: K, version: string, parse: (input: Record<string, unknown>, context: CompileContext) => import("./dsl").Categories[C][K]): this {
    ensureMove(!this.#sealed && !this.#entries.has(type), "v3-duplicate-or-sealed-registry"); label(type); label(version);
    ensureMove(typeof parse === "function", "v3-parser-required"); this.#entries.set(type, { version, parse: parse as Parser<C> }); return this;
  }
  seal(): void { this.#sealed = true; }
  manifest(): readonly string[] { return [...this.#entries].map(([type, entry]) => `${type}@${entry.version}`).sort(); }
  parse(type: string, input: Record<string, unknown>, context: CompileContext): Node<C> {
    const entry = this.#entries.get(type); ensureMove(entry, `unsupported-v3-command:${type}`);
    const parsed = entry.parse(input, context);
    ensureMove(parsed !== null && typeof parsed === "object" && (parsed as { type?: unknown }).type === type, "v3-parser-node-type-mismatch");
    return parsed;
  }
}
export type V3Registries = { [C in Category]: V3Registry<C> };
function value(input: unknown): Value {
  if (input === null || typeof input === "boolean") return input;
  if (typeof input === "string") { ensureMove(input.length <= 1000, "v3-literal-too-long"); return input; }
  if (typeof input === "number") { ensureMove(Number.isSafeInteger(input), "v3-invalid-numeric-literal"); return input; }
  dataObject(input, ["ref"]);
  ensureMove(["SELF.lifeCount", "SELF.handCount", "OPPONENT.lifeCount", "OPPONENT.handCount"].includes(input.ref as string), "unsupported-v3-reference");
  return { ref: input.ref as Extract<Value, object>["ref"] };
}
export function builtinV3Registries(): V3Registries {
  const r: V3Registries = { predicate: new V3Registry(), action: new V3Registry(), cost: new V3Registry(), replacement: new V3Registry(), selector: new V3Registry(), duration: new V3Registry(), timing: new V3Registry() };
  r.timing.register("MAIN", "1", (n, c) => ({ type: "MAIN", ...c.fields(n, []) }));
  for (const type of ["all", "any"] as const) r.predicate.register(type, "1", (n, c) => ({ type, ...c.fields(n, ["conditions"]), conditions: c.list("predicate", n.conditions) }));
  r.predicate.register("not", "1", (n, c) => ({ type: "not", ...c.fields(n, ["condition"]), condition: c.read("predicate", n.condition) }));
  r.predicate.register("compare", "1", (n, c) => {
    const meta = c.fields(n, ["left", "op", "right"]), left = value(n.left), right = value(n.right);
    ensureMove(["eq", "ne", "lt", "lte", "gt", "gte"].includes(n.op as string), "unsupported-v3-comparison");
    const numeric = (v: Value) => typeof v === "number" || (v !== null && typeof v === "object");
    ensureMove(n.op === "eq" || n.op === "ne" || (numeric(left) && numeric(right)), "v3-nonnumeric-order-comparison");
    ensureMove(n.op !== "eq" && n.op !== "ne" || left === null || right === null || (numeric(left) && numeric(right)) || typeof left === typeof right, "v3-comparison-type-mismatch");
    return { type: "compare", ...meta, left, op: n.op as Extract<Node<"predicate">, { type: "compare" }>["op"], right };
  });
  r.action.register("DRAW", "1", (n, c) => {
    const meta = c.fields(n, ["player", "count"]); ensureMove(n.player === "SELF" || n.player === "OPPONENT", "invalid-v3-player");
    return { type: "DRAW", ...meta, player: n.player, count: count(n.count) };
  });
  r.action.register("SEQUENCE", "1", (n, c) => ({ type: "SEQUENCE", ...c.fields(n, ["actions"]), actions: c.list("action", n.actions) }));
  r.action.register("IF", "1", (n, c) => ({ type: "IF", ...c.fields(n, ["condition", "then", "else"]), condition: c.read("predicate", n.condition), then: c.list("action", n.then), else: c.list("action", n.else) }));
  r.cost.register("REST_DON", "1", (n, c) => ({ type: "REST_DON", ...c.fields(n, ["count"]), count: count(n.count) }));
  return r;
}

export function isCompiledV3Card(value: unknown): value is CompiledCard { return typeof value === "object" && value !== null && compiled.has(value); }
export function compileV3CardJson(json: string, registries: V3Registries = builtinV3Registries()): CompiledCard {
  ensureMove(typeof json === "string" && Buffer.byteLength(json) <= 262144, "v3-document-too-large");
  const input: unknown = JSON.parse(json);
  inspectData(input);
  dataObject(input, ["schemaVersion", "cardId", "cardVersion", "name", "cardType", "baseStats", "colors", "traits", "attributes", "reviewStatus", "source", "effects"]);
  ensureMove(input.schemaVersion === "3.0.0-subset.1", "unsupported-v3-schema-version");
  const cardId = label(input.cardId), cardVersion = label(input.cardVersion);
  ensureMove(typeof input.name === "string" && input.name.trim().length > 0 && input.name.length <= 300, "invalid-v3-card-name");
  ensureMove(input.cardType === "leader" || input.cardType === "character" || input.cardType === "stage", "unsupported-v3-card-type");
  dataObject(input.baseStats, ["cost", "power", "counter", "life"]);
  for (const number of Object.values(input.baseStats)) ensureMove(number === null || typeof number === "number" && Number.isSafeInteger(number) && number >= 0, "invalid-v3-base-stat");
  const stringList = (value: unknown): string[] => {
    dataArray(value, 32); ensureMove(value.every(item => typeof item === "string" && item.trim().length > 0 && item.length <= 300) && new Set(value).size === value.length, "invalid-v3-string-list");
    return [...value] as string[];
  };
  const colors = stringList(input.colors), traits = stringList(input.traits), attributes = stringList(input.attributes);
  ensureMove(["needs_review", "unsupported", "approved"].includes(input.reviewStatus as string), "invalid-v3-review-status");
  dataObject(input.source, ["text", "triggerText", "displayIds", "datasetSha256"]);
  ensureMove(typeof input.source.text === "string" && input.source.text.length > 0 && input.source.text.length <= 32768 && typeof input.source.triggerText === "string" && input.source.triggerText.length <= 32768, "invalid-v3-source-text");
  const displayIds = stringList(input.source.displayIds); ensureMove(displayIds.length > 0, "v3-source-variant-required"); displayIds.forEach(id => label(id));
  ensureMove(typeof input.source.datasetSha256 === "string" && /^[a-f0-9]{64}$/.test(input.source.datasetSha256), "invalid-v3-dataset-hash");
  const source = { text: input.source.text, triggerText: input.source.triggerText, displayIds, datasetSha256: input.source.datasetSha256 };
  Object.values(registries).forEach(registry => registry.seal());
  const registryHash = digest(canonical(Object.fromEntries(Object.entries(registries).map(([category, r]) => [category, r.manifest()]))));
  const used = new Set<string>(), ids = new Set<string>();
  const context: CompileContext = {
    read(category, node) {
      ensureMove(node && typeof node === "object" && !Array.isArray(node), "v3-node-object-required");
      const input = node as Record<string, unknown>; const type = label(input.type);
      used.add(`${category}:${type}`); return registries[category].parse(type, input, context);
    },
    list(category, nodes) { dataArray(nodes, 128); return nodes.map(node => context.read(category, node)); },
    fields(node, required) {
      dataObject(node, ["type", ...required], ["id", "sourceSpan"]); const meta: NodeMeta = {};
      if (Object.hasOwn(node, "id")) { meta.id = label(node.id); ensureMove(!ids.has(meta.id), "duplicate-v3-node-id"); ids.add(meta.id); }
      if (Object.hasOwn(node, "sourceSpan")) {
        dataObject(node.sourceSpan, ["start", "end"]); const { start, end } = node.sourceSpan;
        ensureMove(typeof start === "number" && typeof end === "number" && Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && end > start && end <= source.text.length, "invalid-v3-source-span");
        meta.sourceSpan = { start, end };
      }
      return meta;
    },
  };
  dataArray(input.effects, 32); ensureMove(input.effects.length > 0, "v3-effect-required");
  const effects: CardDefinition["effects"] = input.effects.map(effect => {
    dataObject(effect, ["id", "kind", "timing", "sourceZones", "optional", "activationConditions", "resolutionConditions", "costs", "actions"]);
    const id = label(effect.id); ensureMove(!ids.has(id), "duplicate-v3-effect-id"); ids.add(id);
    ensureMove(effect.kind === "activated" && effect.optional === false, "unsupported-v3-effect-kind-or-optionality");
    dataArray(effect.sourceZones, 3); ensureMove(effect.sourceZones.length === 1 && effect.sourceZones[0] === input.cardType, "unsupported-v3-source-zones");
    const actions = context.list("action", effect.actions); ensureMove(actions.length > 0, "v3-action-required");
    return { id, kind: "activated", optional: false, sourceZones: effect.sourceZones as ("leader" | "character" | "stage")[], timing: context.read("timing", effect.timing),
      activationConditions: context.read("predicate", effect.activationConditions), resolutionConditions: context.read("predicate", effect.resolutionConditions), costs: context.list("cost", effect.costs), actions };
  });
  const definition: CardDefinition = { schemaVersion: "3.0.0-subset.1", cardId, cardVersion, name: input.name, cardType: input.cardType,
    baseStats: input.baseStats as CardDefinition["baseStats"], colors, traits, attributes, reviewStatus: input.reviewStatus as CardDefinition["reviewStatus"], source, effects };
  inspectData(definition);
  const plan = freezeMovement({ status: "compiled_not_executable" as const, compilerVersion: COMPILER_VERSION, registryHash, definitionHash: digest(canonical(definition)), sourceHash: digest(canonical(source)), definition, requiredHandlers: [...used].sort() });
  compiled.add(plan); return plan;
}
