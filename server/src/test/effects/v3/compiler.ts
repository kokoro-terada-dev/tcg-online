import { createHash } from "node:crypto";
import { dataArray, dataObject, ensureMove, freezeMovement } from "../../movement/state";
import { isSimpleMainEvent, isInteractiveMainEvent } from "./simpleMainEvent";
import type { AbilityTag, CardDefinition, CardSetRef, CardSubject, Category, CompiledCard, DonZone, Node, NodeMeta, SchemaVersion, Value } from "./dsl";

export const COMPILER_VERSION = "v3-subset-compiler.16.3";
export const METADATA_COMPILER_VERSION = "v3-subset-compiler.17.1";
export const QUERY_COMPILER_VERSION = "v3-subset-compiler.18.1";
export const MAIN_EVENT_COMPILER_VERSION = "v3-subset-compiler.19.1";
export const INTERACTIVE_EVENT_COMPILER_VERSION = "v3-subset-compiler.20.1";
export const CONDITIONAL_TRIGGER_COMPILER_VERSION = "v3-subset-compiler.21.1";
export const ABILITY_TAGS: readonly AbilityTag[] = ["BLOCKER", "RUSH", "RUSH_CHARACTER", "CANNOT_BE_BLOCKED", "MAIN", "ON_PLAY", "ON_ATTACK", "ON_OPPONENT_ATTACK", "ON_KO", "COUNTER", "TRIGGER"];
export function compilerVersionForSchema(schema: SchemaVersion): string {
  if (schema === "3.0.0-subset.23") return "v3-subset-compiler.23.1";
  if (schema === "3.0.0-subset.22") return "v3-subset-compiler.22.1";
  if (schema === "3.0.0-subset.21") return CONDITIONAL_TRIGGER_COMPILER_VERSION;
  ensureMove(schema === "3.0.0-subset.16" || schema === "3.0.0-subset.17" || schema === "3.0.0-subset.18" || schema === "3.0.0-subset.19" || schema === "3.0.0-subset.20", "unsupported-v3-schema-version");
  return schema === "3.0.0-subset.20" ? INTERACTIVE_EVENT_COMPILER_VERSION : schema === "3.0.0-subset.19" ? MAIN_EVENT_COMPILER_VERSION : schema === "3.0.0-subset.18" ? QUERY_COMPILER_VERSION : schema === "3.0.0-subset.17" ? METADATA_COMPILER_VERSION : COMPILER_VERSION;
}
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
function donZones(input: unknown): DonZone[] {
  const zones = typeof input === "string" ? [input] : input;
  dataArray(zones, 3);
  ensureMove(zones.length > 0 && new Set(zones).size === zones.length && zones.every(zone => ["activeDon", "restDon", "attachedDon"].includes(zone as string)), "v3-invalid-don-return-source");
  return [...zones] as DonZone[];
}
export interface CompileContext {
  read<C extends Category>(category: C, input: unknown): Node<C>;
  list<C extends Category>(category: C, input: unknown): Node<C>[];
  fields(input: Record<string, unknown>, required: string[]): NodeMeta;
  value(input: unknown): Value;
  cards(input: unknown): CardSetRef;
  bind(input: unknown, maxCards: number): string;
  bindSource(input: unknown): string;
  maxCards(input: CardSetRef): number;
  branch(input: unknown): Node<"action">[];
  candidate(input: unknown): Node<"predicate">;
  subject(input: unknown): CardSubject;
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
export type V3Registries = { [C in Exclude<Category, "query">]: V3Registry<C> } & { query?: V3Registry<"query"> };
export function v3RegistryHash(registries: V3Registries): string {
  return digest(canonical(Object.fromEntries(Object.entries(registries).map(([category, registry]) => [category, registry.manifest()]))));
}
function value(input: unknown, bindings: ReadonlyMap<string, number>, candidateAllowed: boolean, queryProfile: boolean): Value {
  if (input === null || typeof input === "boolean") return input;
  if (typeof input === "string") { ensureMove(input.length <= 1000, "v3-literal-too-long"); return input; }
  if (typeof input === "number") { ensureMove(Number.isSafeInteger(input), "v3-invalid-numeric-literal"); return input; }
  dataObject(input, ["ref"]);
  ensureMove(typeof input.ref === "string", "unsupported-v3-reference");
  const binding = /^bindings\.([A-Za-z][A-Za-z0-9_]{0,63})\.count$/.exec(input.ref);
  const field = /^(SOURCE|CANDIDATE)\.(cost|power|cardType|rotated)$/.exec(input.ref);
  const basedField = queryProfile ? /^(SOURCE|CANDIDATE)\.(printed|current)\.(cost|power)$/.exec(input.ref) : null;
  ensureMove(["SELF.lifeCount", "SELF.handCount", "OPPONENT.lifeCount", "OPPONENT.handCount"].includes(input.ref) ||
    binding && bindings.has(binding[1]!) || field && (field[1] === "SOURCE" || candidateAllowed) || basedField && (basedField[1] === "SOURCE" || candidateAllowed), "unsupported-or-out-of-scope-v3-reference");
  return { ref: input.ref as Extract<Value, object>["ref"] };
}
function valueType(value: Value): string {
  if (value !== null && typeof value === "object") return value.ref.endsWith(".cardType") ? "string" : value.ref.endsWith(".rotated") ? "boolean" : "number";
  return value === null ? "null" : typeof value;
}
export function builtinV3Registries(schema: SchemaVersion = "3.0.0-subset.16"): V3Registries {
  compilerVersionForSchema(schema);
  const r: V3Registries = { predicate: new V3Registry(), action: new V3Registry(), cost: new V3Registry(), replacement: new V3Registry(), selector: new V3Registry(), duration: new V3Registry(), timing: new V3Registry(), keyword: new V3Registry() };
  if (schema !== "3.0.0-subset.16") {
    const text = (input: unknown): string => { ensureMove(typeof input === "string" && input.trim().length > 0 && input.length <= 300, "v3-invalid-metadata-literal"); return input; };
    const basis = (input: unknown): "PRINTED" | "CURRENT" => { ensureMove(input === "PRINTED" || input === "CURRENT", "v3-invalid-metadata-basis"); return input; };
    r.predicate.register("CARD_NAME", "1", (n, c) => {
      const meta = c.fields(n, ["subject", "basis", "op", "value"]);
      ensureMove(n.op === "eq" || n.op === "ne", "v3-invalid-name-comparison");
      return { type: "CARD_NAME", ...meta, subject: c.subject(n.subject), basis: basis(n.basis), op: n.op, value: text(n.value) };
    });
    r.predicate.register("CARD_METADATA", "1", (n, c) => {
      const meta = c.fields(n, ["subject", "basis", "field", "match", "comparison", "values"]);
      ensureMove(n.field === "traits" || n.field === "colors" || n.field === "attributes", "v3-invalid-metadata-field");
      ensureMove(["ANY", "ALL", "NONE", "EXACT"].includes(n.match as string) && (n.comparison === "EXACT" || n.comparison === "CONTAINS"), "v3-invalid-metadata-comparison");
      ensureMove(n.comparison !== "CONTAINS" || n.field === "traits" && n.match !== "EXACT", "v3-unsupported-metadata-substring");
      dataArray(n.values, 32); ensureMove(n.values.length > 0, "v3-empty-metadata-query");
      const values = n.values.map(text); ensureMove(new Set(values).size === values.length, "v3-duplicate-metadata-query");
      return { type: "CARD_METADATA", ...meta, subject: c.subject(n.subject), basis: basis(n.basis), field: n.field,
        match: n.match as "ANY" | "ALL" | "NONE" | "EXACT", comparison: n.comparison, values };
    });
    r.predicate.register("HAS_ABILITY", "1", (n, c) => {
      const meta = c.fields(n, ["subject", "basis", "ability"]);
      ensureMove(ABILITY_TAGS.includes(n.ability as AbilityTag), "v3-unsupported-ability-tag");
      ensureMove(n.basis === "PRINTED" || n.basis === "CURRENT" || n.basis === "GRANTED", "v3-invalid-ability-basis");
      ensureMove(n.basis !== "GRANTED" || ["BLOCKER", "RUSH", "RUSH_CHARACTER", "CANNOT_BE_BLOCKED"].includes(n.ability as string), "v3-unsupported-granted-ability");
      return { type: "HAS_ABILITY", ...meta, subject: c.subject(n.subject), basis: n.basis, ability: n.ability as AbilityTag };
    });
  }
  if (schema === "3.0.0-subset.18" || schema === "3.0.0-subset.19" || schema === "3.0.0-subset.20" || schema === "3.0.0-subset.21" || schema === "3.0.0-subset.22" || schema === "3.0.0-subset.23") {
    r.query = new V3Registry<"query">();
    r.query.register("QUERY_CARDS", "1", (n, c) => {
      const meta = c.fields(n, ["owner", "controller", "zone", "visibility", "faceUpOnly", "cardTypes", "filters", "excludeSource"]);
      ensureMove(["leader", "character", "stage", "trash", "public", "hand"].includes(n.zone as string), "v3-unsupported-query-zone");
      dataArray(n.cardTypes, 4);
      ensureMove(n.cardTypes.length > 0 && n.cardTypes.every(type => ["leader", "character", "stage", "event"].includes(type as string)), "v3-invalid-query-card-types");
      // Reuse the selector parser and candidate scope, without registering a selectable query.
      const scope = c.read("selector", { type: "CARDS", owner: n.owner, controller: n.controller, zone: n.zone, visibility: n.visibility,
        faceUpOnly: n.faceUpOnly, cardTypes: n.cardTypes, filters: n.filters, excludeSource: n.excludeSource,
        min: 0, max: 50, chooser: "SELF", selectionMode: "SELECT", order: "UNORDERED", onInsufficient: "fail" });
      ensureMove(scope.type === "CARDS", "v3-invalid-query-scope");
      if (scope.excludeSource) c.subject("SOURCE");
      return { type: "QUERY_CARDS", ...meta, owner: scope.owner, controller: scope.controller, zone: scope.zone,
        visibility: scope.visibility, faceUpOnly: scope.faceUpOnly, cardTypes: scope.cardTypes, filters: scope.filters, excludeSource: scope.excludeSource } as Node<"query">;
    });
    r.predicate.register("EXISTS", "1", (n, c) => ({ type: "EXISTS", ...c.fields(n, ["query"]), query: c.read("query", n.query) }));
    r.predicate.register("COUNT", "1", (n, c) => {
      const meta = c.fields(n, ["query", "op", "value"]);
      ensureMove(["eq", "ne", "lt", "lte", "gt", "gte"].includes(n.op as string), "v3-invalid-query-comparison");
      ensureMove(typeof n.value === "number" && Number.isSafeInteger(n.value) && n.value >= 0 && n.value <= 256, "v3-invalid-query-count");
      return { type: "COUNT", ...meta, query: c.read("query", n.query), op: n.op as Extract<Node<"predicate">, { type: "COUNT" }>["op"], value: n.value };
    });
  }
  if (schema === "3.0.0-subset.21" || schema === "3.0.0-subset.22" || schema === "3.0.0-subset.23") {
    r.predicate.register("TURN_IS", "1", (n, c) => {
      const meta = c.fields(n, ["player"]);
      ensureMove(n.player === "SELF" || n.player === "OPPONENT", "v3-invalid-turn-player");
      return { type: "TURN_IS", ...meta, player: n.player };
    });
    r.timing.register("ON_EVENT", schema === "3.0.0-subset.21" ? "candidate.1" : "1", (n, c) => {
      const meta = c.fields(n, ["event", "snapshot", "relation", "owner", "controller", "fromZones", "toZones", "cardTypes", "filters"]);
      ensureMove(["CARD_ENTERED", "CARD_KO", "CARD_MOVED"].includes(n.event as string) &&
        ["TRANSACTION_BEFORE", "TRANSACTION_AFTER"].includes(n.snapshot as string) &&
        ["SELF", "OTHER", "ANY"].includes(n.relation as string) &&
        ["SELF", "OPPONENT", "ANY"].includes(n.owner as string) && ["SELF", "OPPONENT", "ANY"].includes(n.controller as string), "v3-invalid-event-scope");
      const list = (input: unknown, allowed: string[]) => {
        dataArray(input, allowed.length);
        ensureMove(input.length > 0 && new Set(input).size === input.length && input.every(item => allowed.includes(item as string)), "v3-invalid-event-set");
        return [...input];
      };
      const zones = ["hand", "deck", "life", "trash", "public", "character", "stage"];
      const fromZones = list(n.fromZones, zones), toZones = list(n.toZones, zones), cardTypes = list(n.cardTypes, ["character", "stage", "event"]);
      return { type: "ON_EVENT", ...meta, event: n.event, snapshot: n.snapshot, relation: n.relation, owner: n.owner, controller: n.controller,
        fromZones, toZones, cardTypes, filters: c.candidate(n.filters) } as Extract<Node<"timing">, { type: "ON_EVENT" }>;
    });
  }
  if (schema === "3.0.0-subset.23") {
    r.timing.register("ON_BLOCK", "1", (n, c) => ({ type: "ON_BLOCK", ...c.fields(n, []) }));
    for (const type of ["MAIN_START", "TURN_END"] as const) r.timing.register(type, "1", (n, c) => {
      const meta = c.fields(n, ["player"]); ensureMove(n.player === "SELF" || n.player === "OPPONENT", "v3-invalid-boundary-player");
      return { type, ...meta, player: n.player };
    });
  }
  for (const type of ["BLOCKER", "RUSH", "RUSH_CHARACTER", "CANNOT_BE_BLOCKED"] as const) r.keyword.register(type, "1", (n, c) => ({ type, ...c.fields(n, []) }));
  r.action.register("GRANT_KEYWORD", "1", (n, c) => ({ type: "GRANT_KEYWORD", ...c.fields(n, ["cards", "keyword", "duration"]), cards: c.cards(n.cards), keyword: c.read("keyword", n.keyword), duration: c.read("duration", n.duration) }));
  r.action.register("BIND_SOURCE", "2", (n, c) => ({ type: "BIND_SOURCE", ...c.fields(n, ["bindAs"]), bindAs: c.bindSource(n.bindAs) }));
  r.duration.register("TURN_END", "1", (n, c) => {
    const meta = c.fields(n, ["player", "occurrence"]);
    ensureMove((n.player === "SELF" || n.player === "OPPONENT") && (n.occurrence === 1 || n.occurrence === 2), "unsupported-v3-turn-duration");
    return { type: "TURN_END", ...meta, player: n.player, occurrence: n.occurrence };
  });
  r.duration.register("BATTLE_END", "1", (n, c) => ({ type: "BATTLE_END", ...c.fields(n, []) }));
  r.action.register("MODIFY_STAT", "1", (n, c) => {
    const meta = c.fields(n, ["cards", "stat", "amount", "duration"]);
    ensureMove((n.stat === "power" || n.stat === "cost") && typeof n.amount === "number" && Number.isSafeInteger(n.amount) && n.amount !== 0 && Math.abs(n.amount) <= 100000, "invalid-v3-stat-change");
    return { type: "MODIFY_STAT", ...meta, cards: c.cards(n.cards), stat: n.stat, amount: n.amount, duration: c.read("duration", n.duration) };
  });
  r.timing.register("MAIN", "1", (n, c) => ({ type: "MAIN", ...c.fields(n, []) }));
  r.timing.register("COUNTER", "1", (n, c) => ({ type: "COUNTER", ...c.fields(n, []) }));
  r.timing.register("TRIGGER", "1", (n, c) => ({ type: "TRIGGER", ...c.fields(n, []) }));
  r.timing.register("ON_PLAY", "1", (n, c) => ({ type: "ON_PLAY", ...c.fields(n, []) }));
  for (const type of ["ON_ATTACK", "ON_OPPONENT_ATTACK", "ON_KO"] as const) r.timing.register(type, "1", (n, c) => ({ type, ...c.fields(n, []) }));
  for (const type of ["all", "any"] as const) r.predicate.register(type, "1", (n, c) => ({ type, ...c.fields(n, ["conditions"]), conditions: c.list("predicate", n.conditions) }));
  r.predicate.register("not", "1", (n, c) => ({ type: "not", ...c.fields(n, ["condition"]), condition: c.read("predicate", n.condition) }));
  r.predicate.register("compare", "3", (n, c) => {
    const meta = c.fields(n, ["left", "op", "right"]), left = c.value(n.left), right = c.value(n.right);
    ensureMove(["eq", "ne", "lt", "lte", "gt", "gte"].includes(n.op as string), "unsupported-v3-comparison");
    const numeric = (v: Value) => valueType(v) === "number";
    ensureMove(n.op === "eq" || n.op === "ne" || (numeric(left) && numeric(right)), "v3-nonnumeric-order-comparison");
    ensureMove(n.op !== "eq" && n.op !== "ne" || left === null || right === null || valueType(left) === valueType(right), "v3-comparison-type-mismatch");
    return { type: "compare", ...meta, left, op: n.op as Extract<Node<"predicate">, { type: "compare" }>["op"], right };
  });
  r.action.register("DRAW", "2", (n, c) => {
    const meta = c.fields(n, ["player", "count"]); ensureMove(n.player === "SELF" || n.player === "OPPONENT", "invalid-v3-player");
    return { type: "DRAW", ...meta, player: n.player, count: count(n.count) };
  });
  r.action.register("LOOK_TOP", "1", (n, c) => {
    const meta = c.fields(n, ["player", "count", "bindAs", "onInsufficient"]), amount = count(n.count);
    ensureMove(n.player === "SELF" && ["fail", "takeAvailable"].includes(n.onInsufficient as string), "unsupported-v3-look-policy");
    return { type: "LOOK_TOP", ...meta, player: "SELF", count: amount, bindAs: c.bind(n.bindAs, amount), onInsufficient: n.onInsufficient as "fail" | "takeAvailable" };
  });
  r.action.register("REVEAL", "1", (n, c) => {
    const meta = c.fields(n, ["cards", "viewers"]); ensureMove(n.viewers === "BOTH", "unsupported-v3-reveal-viewers");
    return { type: "REVEAL", ...meta, cards: c.cards(n.cards), viewers: "BOTH" };
  });
  r.action.register("ORDER_CARDS", "1", (n, c) => {
    const meta = c.fields(n, ["cards", "excludeCards", "bindAs", "chooser"]), cards = c.cards(n.cards), excludeCards = n.excludeCards === null ? null : c.cards(n.excludeCards);
    ensureMove(n.chooser === "SELF", "unsupported-v3-order-chooser");
    return { type: "ORDER_CARDS", ...meta, cards, excludeCards, bindAs: c.bind(n.bindAs, c.maxCards(cards)), chooser: "SELF" };
  });
  r.action.register("RETURN_TO_DECK", "1", (n, c) => {
    const meta = c.fields(n, ["cards", "player", "position"]);
    ensureMove(n.player === "SELF" && (n.position === "top" || n.position === "bottom"), "unsupported-v3-deck-return");
    return { type: "RETURN_TO_DECK", ...meta, cards: c.cards(n.cards), player: "SELF", position: n.position };
  });
  r.action.register("SEQUENCE", "1", (n, c) => ({ type: "SEQUENCE", ...c.fields(n, ["actions"]), actions: c.list("action", n.actions) }));
  r.action.register("IF", "2", (n, c) => ({ type: "IF", ...c.fields(n, ["condition", "then", "else"]), condition: c.read("predicate", n.condition), then: c.branch(n.then), else: c.branch(n.else) }));
  r.selector.register("CARDS", "4", (n, c) => {
    const meta = c.fields(n, ["owner", "controller", "zone", "cardTypes", "filters", "excludeSource", "faceUpOnly", "min", "max", "visibility", "selectionMode", "chooser", "order", "onInsufficient"]);
    ensureMove([n.owner, n.controller, n.chooser].every(player => player === "SELF" || player === "OPPONENT"), "invalid-v3-selector-player");
    const publicSelection = ["leader", "character", "stage", "trash", "public"].includes(n.zone as string) && n.visibility === "PUBLIC" && n.faceUpOnly === true;
    const ownHand = n.zone === "hand" && n.visibility === "OWNER_ONLY" && n.faceUpOnly === false && n.owner === "SELF" && n.controller === "SELF" && n.chooser === "SELF";
    const donZone = Array.isArray(n.zone) || ["activeDon", "restDon", "attachedDon"].includes(n.zone as string);
    const ownDon = donZone && n.visibility === "PUBLIC" && n.faceUpOnly === true && n.owner === "SELF" && n.controller === "SELF" && n.chooser === "SELF";
    ensureMove(publicSelection || ownHand || ownDon, "unsupported-v3-hidden-selection");
    ensureMove(n.selectionMode === "SELECT" && n.order === "UNORDERED" && n.onInsufficient === "fail" && typeof n.excludeSource === "boolean", "unsupported-v3-selection-policy");
    dataArray(n.cardTypes, 5);
    ensureMove(n.cardTypes.length > 0 && new Set(n.cardTypes).size === n.cardTypes.length && n.cardTypes.every(type => ["leader", "character", "event", "stage", "don"].includes(type as string)), "invalid-v3-selector-types");
    ensureMove(!ownDon || n.cardTypes.length === 1 && n.cardTypes[0] === "don", "v3-don-selector-type");
    const max = count(n.max);
    ensureMove(typeof n.min === "number" && Number.isSafeInteger(n.min) && n.min >= 0 && n.min <= max, "invalid-v3-selection-bounds");
    return { type: "CARDS", ...meta, owner: n.owner, controller: n.controller, chooser: n.chooser, zone: ownDon ? donZones(n.zone) : n.zone, cardTypes: [...n.cardTypes], filters: c.candidate(n.filters),
      excludeSource: n.excludeSource, faceUpOnly: n.faceUpOnly, min: n.min, max, visibility: n.visibility, selectionMode: "SELECT", order: "UNORDERED", onInsufficient: "fail" } as Extract<Node<"selector">, { type: "CARDS" }>;
  });
  r.action.register("SELECT", "1", (n, c) => {
    const meta = c.fields(n, ["selector", "bindAs"]), selector = c.read("selector", n.selector);
    return { type: "SELECT", ...meta, selector, bindAs: c.bind(n.bindAs, selector.max) };
  });
  r.selector.register("BOUND_CARDS", "1", (n, c) => {
    const meta = c.fields(n, ["cards", "excludeCards", "owner", "controller", "chooser", "zone", "visibility", "faceUpOnly", "cardTypes", "filters", "excludeSource", "min", "max", "selectionMode", "order", "onInsufficient"]);
    const cards = c.cards(n.cards), excludeCards = n.excludeCards === null ? null : c.cards(n.excludeCards), max = count(n.max);
    ensureMove(n.owner === "SELF" && n.controller === "SELF" && n.chooser === "SELF" && n.zone === "deck" && n.visibility === "OWNER_ONLY" && n.faceUpOnly === false &&
      n.selectionMode === "SELECT" && n.order === "UNORDERED" && n.onInsufficient === "fail" && typeof n.excludeSource === "boolean", "unsupported-v3-bound-selection");
    ensureMove(typeof n.min === "number" && Number.isSafeInteger(n.min) && n.min >= 0 && n.min <= max && max <= c.maxCards(cards), "invalid-v3-bound-selection-bounds");
    dataArray(n.cardTypes, 3); ensureMove(n.cardTypes.length > 0 && new Set(n.cardTypes).size === n.cardTypes.length && n.cardTypes.every(type => ["character", "event", "stage"].includes(type as string)), "invalid-v3-bound-selector-types");
    return { type: "BOUND_CARDS", ...meta, cards, excludeCards, owner: "SELF", controller: "SELF", chooser: "SELF", zone: "deck", visibility: "OWNER_ONLY", faceUpOnly: false,
      cardTypes: [...n.cardTypes] as ("character" | "event" | "stage")[], filters: c.candidate(n.filters), excludeSource: n.excludeSource, min: n.min, max, selectionMode: "SELECT", order: "UNORDERED", onInsufficient: "fail" };
  });
  r.action.register("MOVE_CARD", "2", (n, c) => {
    const meta = c.fields(n, ["cards", "destination", "cause"]), cards = c.cards(n.cards);
    dataObject(n.destination, ["owner", "zone", "position", "faceUp"]); const destination = n.destination;
    ensureMove((destination.owner === "SELF" || destination.owner === "OPPONENT") && n.cause === "EFFECT", "unsupported-v3-move-cause-or-owner");
    ensureMove((destination.zone === "hand" || destination.zone === "trash" || destination.zone === "public") && destination.position === "append" && destination.faceUp === true ||
      destination.zone === "deck" && (destination.position === "top" || destination.position === "bottom") && destination.faceUp === false, "unsupported-v3-destination");
    ensureMove(destination.zone !== "deck" || c.maxCards(cards) === 1, "v3-multi-card-deck-order-not-implemented");
    return { type: "MOVE_CARD", ...meta, cards, destination: { ...destination } as Extract<Node<"action">, { type: "MOVE_CARD" }>["destination"], cause: "EFFECT" };
  });
  for (const type of ["KO", "REST", "SET_ACTIVE"] as const) r.action.register(type, "1", (n, c) => ({ type, ...c.fields(n, ["cards"]), cards: c.cards(n.cards) }));
  r.cost.register("REST_DON", "1", (n, c) => ({ type: "REST_DON", ...c.fields(n, ["count"]), count: count(n.count) }));
  r.cost.register("REST_SOURCE", "1", (n, c) => ({ type: "REST_SOURCE", ...c.fields(n, []) }));
  r.cost.register("DON_RETURN", "2", (n, c) => {
    const meta = c.fields(n, ["count", "from"]);
    return { type: "DON_RETURN", ...meta, count: count(n.count), from: donZones(n.from) };
  });
  r.cost.register("DISCARD_HAND", "1", (n, c) => ({ type: "DISCARD_HAND", ...c.fields(n, ["count"]), count: count(n.count) }));
  return r;
}

export function isCompiledV3Card(value: unknown): value is CompiledCard { return typeof value === "object" && value !== null && compiled.has(value); }
export function compileV3CardJson(json: string, registries?: V3Registries): CompiledCard {
  ensureMove(typeof json === "string" && Buffer.byteLength(json) <= 262144, "v3-document-too-large");
  const input: unknown = JSON.parse(json);
  inspectData(input);
  dataObject(input, ["schemaVersion", "cardId", "cardVersion", "name", "cardType", "baseStats", "colors", "traits", "attributes", "keywords", "reviewStatus", "source", "effects"]);
  ensureMove(input.schemaVersion === "3.0.0-subset.16" || input.schemaVersion === "3.0.0-subset.17" || input.schemaVersion === "3.0.0-subset.18" || input.schemaVersion === "3.0.0-subset.19" || input.schemaVersion === "3.0.0-subset.20" || input.schemaVersion === "3.0.0-subset.21" || input.schemaVersion === "3.0.0-subset.22" || input.schemaVersion === "3.0.0-subset.23", "unsupported-v3-schema-version");
  const schemaVersion = input.schemaVersion, compilerVersion = compilerVersionForSchema(schemaVersion);
  const interactiveEventProfile = ["3.0.0-subset.20", "3.0.0-subset.21", "3.0.0-subset.22", "3.0.0-subset.23"].includes(schemaVersion);
  registries ??= builtinV3Registries(schemaVersion);
  const cardId = label(input.cardId), cardVersion = label(input.cardVersion);
  ensureMove(typeof input.name === "string" && input.name.trim().length > 0 && input.name.length <= 300, "invalid-v3-card-name");
  ensureMove(input.cardType === "leader" || input.cardType === "character" || input.cardType === "stage" || input.cardType === "event", "unsupported-v3-card-type");
  dataObject(input.baseStats, ["cost", "power", "counter", "life"]);
  for (const number of Object.values(input.baseStats)) ensureMove(number === null || typeof number === "number" && Number.isSafeInteger(number) && number >= 0, "invalid-v3-base-stat");
  const stringList = (value: unknown): string[] => {
    dataArray(value, 32); ensureMove(value.every(item => typeof item === "string" && item.trim().length > 0 && item.length <= 300) && new Set(value).size === value.length, "invalid-v3-string-list");
    return [...value] as string[];
  };
  const colors = stringList(input.colors), traits = stringList(input.traits), attributes = stringList(input.attributes);
  ensureMove(["needs_review", "unsupported", "approved"].includes(input.reviewStatus as string), "invalid-v3-review-status");
  dataObject(input.source, ["text", "triggerText", "displayIds", "datasetSha256"]);
  ensureMove(typeof input.source.text === "string" && input.source.text.length <= 32768 && typeof input.source.triggerText === "string" && input.source.triggerText.length <= 32768, "invalid-v3-source-text");
  const displayIds = stringList(input.source.displayIds); ensureMove(displayIds.length > 0, "v3-source-variant-required"); displayIds.forEach(id => label(id));
  ensureMove(typeof input.source.datasetSha256 === "string" && /^[a-f0-9]{64}$/.test(input.source.datasetSha256), "invalid-v3-dataset-hash");
  const source = { text: input.source.text, triggerText: input.source.triggerText, displayIds, datasetSha256: input.source.datasetSha256 };
  Object.values(registries).forEach(registry => registry.seal());
  const registryHash = v3RegistryHash(registries);
  const used = new Set<string>(), ids = new Set<string>();
  let bindings = new Map<string, number>(), candidateAllowed = false, currentTiming: string | null = null, parsingQuery = false;
  const context: CompileContext = {
    read(category, node) {
      ensureMove(node && typeof node === "object" && !Array.isArray(node), "v3-node-object-required");
      const input = node as Record<string, unknown>; const type = label(input.type);
      const registry = registries[category]; ensureMove(registry, `unsupported-v3-category:${category}`);
      used.add(`${category}:${type}`);
      if (category === "query") {
        ensureMove(!parsingQuery, "v3-nested-query-unsupported"); parsingQuery = true;
        try { return registry.parse(type, input, context) as Node<typeof category>; } finally { parsingQuery = false; }
      }
      return registry.parse(type, input, context) as Node<typeof category>;
    },
    list(category, nodes) { dataArray(nodes, 128); return nodes.map(node => context.read(category, node)); },
    value(input) {
      const parsed = value(input, bindings, candidateAllowed, schemaVersion === "3.0.0-subset.18" || schemaVersion === "3.0.0-subset.19" || schemaVersion === "3.0.0-subset.20" || schemaVersion === "3.0.0-subset.21" || schemaVersion === "3.0.0-subset.22" || schemaVersion === "3.0.0-subset.23");
      ensureMove(currentTiming !== "ON_KO" || parsed === null || typeof parsed !== "object" || !parsed.ref.startsWith("SOURCE."), "v3-ko-source-facts-unresolved");
      ensureMove(currentTiming !== "TRIGGER" || parsed === null || typeof parsed !== "object" || !parsed.ref.startsWith("SOURCE."), "v3-trigger-source-facts-unresolved");
      return parsed;
    },
    cards(input) {
      dataObject(input, ["ref"]); ensureMove(typeof input.ref === "string", "v3-card-binding-required");
      const match = /^bindings\.([A-Za-z][A-Za-z0-9_]{0,63})$/.exec(input.ref);
      ensureMove(match && bindings.has(match[1]!), "v3-undefined-card-binding"); return { ref: input.ref as CardSetRef["ref"] };
    },
    bind(input, maxCards) {
      ensureMove(typeof input === "string" && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(input) && !["constructor", "prototype"].includes(input) && !bindings.has(input), "v3-invalid-or-duplicate-binding");
      count(maxCards); bindings.set(input, maxCards); return input;
    },
    bindSource(input) { ensureMove(currentTiming !== "TRIGGER", "v3-trigger-source-movement-unresolved"); return context.bind(input, 1); },
    maxCards(input) { const max = bindings.get(input.ref.slice("bindings.".length)); ensureMove(max !== undefined, "v3-undefined-card-binding"); return max; },
    branch(input) {
      const parent = bindings; bindings = new Map(parent);
      try { return context.list("action", input); } finally { bindings = parent; }
    },
    candidate(input) {
      const parent = candidateAllowed; candidateAllowed = true;
      try { return context.read("predicate", input); } finally { candidateAllowed = parent; }
    },
    subject(input) {
      ensureMove(input === "SOURCE" || input === "CANDIDATE" && candidateAllowed, "v3-out-of-scope-metadata-subject");
      ensureMove(input !== "SOURCE" || currentTiming !== "ON_KO" && currentTiming !== "TRIGGER", "v3-unresolved-metadata-source");
      return input;
    },
    fields(node, required) {
      dataObject(node, ["type", ...required], ["id", "sourceSpan"]); const meta: NodeMeta = {};
      if (Object.hasOwn(node, "id")) { meta.id = label(node.id); ensureMove(!ids.has(meta.id), "duplicate-v3-node-id"); ids.add(meta.id); }
      if (Object.hasOwn(node, "sourceSpan")) {
        dataObject(node.sourceSpan, ["start", "end"]); const { start, end } = node.sourceSpan;
        const text = currentTiming === "TRIGGER" || node.type === "TRIGGER" ? source.triggerText : source.text;
        ensureMove(typeof start === "number" && typeof end === "number" && Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && end > start && end <= text.length, "invalid-v3-source-span");
        meta.sourceSpan = { start, end };
      }
      return meta;
    },
  };
  const keywords = context.list("keyword", input.keywords);
  ensureMove(keywords.length <= 4 && new Set(keywords.map(keyword => keyword.type)).size === keywords.length && keywords.every(keyword => input.cardType === "character" || input.cardType === "leader" && keyword.type !== "RUSH" && keyword.type !== "RUSH_CHARACTER"), "v3-invalid-printed-keywords");
  dataArray(input.effects, 32);
  ensureMove(input.effects.length > 0 || keywords.length > 0 ? source.text.length > 0 || source.triggerText.length > 0 : source.text.trim() === "" && source.triggerText.trim() === "", "v3-unmapped-card-text");
  const effects: CardDefinition["effects"] = input.effects.map(effect => {
    bindings = new Map(); candidateAllowed = false; currentTiming = null;
    dataObject(effect, ["id", "kind", "timing", "sourceZones", "optional", "usageLimit", "activationConditions", "resolutionConditions", "costs", "actions"]);
    const id = label(effect.id); ensureMove(!ids.has(id), "duplicate-v3-effect-id"); ids.add(id);
    ensureMove((effect.kind === "activated" || effect.kind === "triggered") && typeof effect.optional === "boolean", "unsupported-v3-effect-kind-or-optionality");
    let usageLimit: CardDefinition["effects"][number]["usageLimit"] = null;
    if (effect.usageLimit !== null) {
      dataObject(effect.usageLimit, ["type", "scope", "count"]);
      ensureMove(effect.usageLimit.type === "PER_TURN" && effect.usageLimit.scope === "SOURCE_OBJECT", "unsupported-v3-usage-limit");
      usageLimit = { type: "PER_TURN", scope: "SOURCE_OBJECT", count: count(effect.usageLimit.count) };
    }
    const timing = context.read("timing", effect.timing); currentTiming = timing.type;
    const boundary = timing.type === "ON_BLOCK" || timing.type === "MAIN_START" || timing.type === "TURN_END";
    ensureMove(!boundary || effect.kind === "triggered" && input.cardType !== "event" && (timing.type !== "ON_BLOCK" || input.cardType === "character"), "v3-boundary-source-kind");
    ensureMove((timing.type === "TRIGGER" ? source.triggerText : source.text).trim().length > 0, "v3-missing-effect-source-text");
    dataArray(effect.sourceZones, 3); ensureMove(effect.sourceZones.length === 1 && effect.sourceZones[0] === (timing.type === "TRIGGER" ? "life" : input.cardType === "event" ? "hand" : input.cardType), "unsupported-v3-source-zones");
    const activationConditions = context.read("predicate", effect.activationConditions),
      resolutionConditions = context.read("predicate", effect.resolutionConditions), costs = context.list("cost", effect.costs);
    ensureMove(boundary || (timing.type === "TRIGGER" ? input.cardType !== "leader" && effect.kind === "triggered" : input.cardType === "event" ? effect.kind === "activated" && (timing.type === "COUNTER" || (schemaVersion === "3.0.0-subset.19" || interactiveEventProfile) && timing.type === "MAIN") : effect.kind === "activated" ? timing.type === "MAIN" : timing.type === "ON_EVENT" || timing.type === "ON_PLAY" && input.cardType !== "leader" || timing.type === "ON_ATTACK" && input.cardType !== "stage" || timing.type === "ON_OPPONENT_ATTACK" || timing.type === "ON_KO" && input.cardType === "character"), "v3-kind-timing-mismatch");
    if (input.cardType === "event") ensureMove(!effect.optional && usageLimit === null && costs.length === 0 && activationConditions.type === "all" && activationConditions.conditions.length === 0, "v3-event-additional-activation-unresolved");
    if (timing.type === "TRIGGER") ensureMove(!effect.optional && usageLimit === null && costs.length === 0 && activationConditions.type === "all" && activationConditions.conditions.length === 0, "v3-trigger-additional-activation-unresolved");
    ensureMove(timing.type !== "ON_KO" || costs.length === 0, "v3-ko-activation-cost-unresolved");
    ensureMove(effect.kind !== "triggered" || boundary || timing.type === "ON_EVENT" || activationConditions.type === "all" && activationConditions.conditions.length === 0, "v3-trigger-event-conditions-unresolved");
    ensureMove(costs.reduce((sum, cost) => sum + (cost.type === "DISCARD_HAND" ? cost.count : 0), 0) <= 50, "v3-discard-cost-limit");
    ensureMove(costs.filter(cost => cost.type === "REST_SOURCE").length <= 1, "v3-duplicate-rest-source-cost");
    ensureMove(costs.filter(cost => cost.type === "DON_RETURN").length <= 1, "v3-multiple-don-return-costs-unsupported");
    const actions = context.list("action", effect.actions); ensureMove(actions.length > 0, "v3-action-required");
    const parsed: CardDefinition["effects"][number] = { id, kind: effect.kind, optional: effect.optional, usageLimit, sourceZones: effect.sourceZones as CardDefinition["effects"][number]["sourceZones"], timing,
      activationConditions, resolutionConditions, costs, actions };
    if (input.cardType === "event" && timing.type === "MAIN") ensureMove(interactiveEventProfile ? isInteractiveMainEvent(parsed) : isSimpleMainEvent(parsed), "v3-main-event-unsupported-program");
    return parsed;
  });
  const triggers = effects.filter(effect => effect.timing.type === "TRIGGER");
  ensureMove(triggers.length <= 1 && (triggers.length === 1) === (source.triggerText.trim().length > 0), "v3-trigger-text-definition-mismatch");
  const definition: CardDefinition = { schemaVersion, cardId, cardVersion, name: input.name, cardType: input.cardType,
    baseStats: input.baseStats as CardDefinition["baseStats"], colors, traits, attributes, keywords, reviewStatus: input.reviewStatus as CardDefinition["reviewStatus"], source, effects };
  inspectData(definition);
  const plan = freezeMovement({ status: "compiled_not_executable" as const, compilerVersion, registryHash, definitionHash: digest(canonical(definition)), sourceHash: digest(canonical(source)), definition, requiredHandlers: [...used].sort() });
  compiled.add(plan); return plan;
}

export function supportsV3RuntimeProfile(card: Pick<CompiledCard, "definition" | "compilerVersion" | "registryHash">): boolean {
  return card.compilerVersion === compilerVersionForSchema(card.definition.schemaVersion) &&
    card.registryHash === v3RegistryHash(builtinV3Registries(card.definition.schemaVersion));
}
