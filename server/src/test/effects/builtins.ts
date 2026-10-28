import { createRegistries } from "./registry";
import type { ValidationContext } from "./registry";
import type { Action, Scope, Value } from "./types";
import { array, fail, fork, integer, keys, LIMITS, object, oneOf, text, identifier, ZONES } from "./validation";

const players = ["SELF", "OPPONENT"] as const;
const owners = ["SELF", "OPPONENT", "ANY"] as const;
function shape(raw: Record<string, unknown>, ctx: ValidationContext, required: string[], optional: string[] = []): void {
  keys(raw, ["kind", ...required], optional, ctx.path);
}
function cardSelector(input: unknown, ctx: ValidationContext) {
  const node = ctx.read("selector", input, `${ctx.path}.selector`);
  if (node.kind !== "cards") fail(ctx.path, "cost requires a card selector");
  return node;
}
function save(raw: Record<string, unknown>, ctx: ValidationContext, type: "cards" | "result") {
  return raw.saveAs === undefined ? {} : { saveAs: ctx.bind(raw.saveAs, type) };
}
function selectedCards(input: unknown, ctx: ValidationContext): Value {
  const value = ctx.value(input, `${ctx.path}.cards`);
  if (value.kind !== "ref" || value.from !== "VARIABLE" || ctx.scope.bindings.get(value.name) !== "cards") fail(ctx.path, "expected a selected-card variable");
  return value;
}
function cardTarget(input: unknown, ctx: ValidationContext): Value {
  const value = ctx.value(input, `${ctx.path}.target`);
  if (value.kind !== "ref") fail(ctx.path, "expected a card reference");
  if (value.from === "VARIABLE" && ctx.scope.bindings.get(value.name) === "cards") return value;
  if ((value.from === "SOURCE" || value.from === "EVENT_SOURCE") && value.field === "id") return value;
  return fail(ctx.path, "expected selected cards or a source card ID");
}
function valueType(value: Value): string {
  if (value.kind === "literal") return value.value === null ? "null" : Array.isArray(value.value) ? "array" : typeof value.value;
  if (value.from === "VARIABLE") return "unknown";
  if (["lifeCount", "handCount", "characterCount", "cost", "power", "enteredTurn", "turnNumber", "activePlayer", "controller"].includes(value.field)) return "number";
  if (["traits", "attributes", "colors", "abilities"].includes(value.field)) return "array";
  return value.field === "rotated" ? "boolean" : "string";
}
function branch(ctx: ValidationContext, input: unknown, path: string): Action[] { return ctx.actions(input, path, fork(ctx.scope)); }

export function createBuiltinRegistries() {
  const r = createRegistries();
  r.trigger.register("event", (raw, ctx) => {
    shape(raw, ctx, ["event"]);
    return { kind: "event", event: oneOf(raw.event, ["onPlay", "onAttack", "onKo", "turnStart", "turnEnd"], ctx.path) };
  });
  r.trigger.register("activate", (raw, ctx) => {
    shape(raw, ctx, ["window"]);
    return { kind: "activate", window: oneOf(raw.window, ["main", "counter", "trigger"], ctx.path) };
  });
  r.predicate.register("compare", (raw, ctx) => {
    shape(raw, ctx, ["operator", "left", "right"]);
    const operator = oneOf(raw.operator, ["EQ", "NEQ", "GT", "GTE", "LT", "LTE", "IN", "NOT_IN", "CONTAINS"], ctx.path);
    const left = ctx.value(raw.left, `${ctx.path}.left`), right = ctx.value(raw.right, `${ctx.path}.right`);
    // Missing runtime values remain unknown; static field types forbid coercion.
    const leftType = valueType(left), rightType = valueType(right);
    if (["GT", "GTE", "LT", "LTE"].includes(operator)) {
      if (![leftType, rightType].every(type => type === "number" || type === "unknown")) fail(ctx.path, "numeric comparison requires numbers");
    }
    if ((operator === "IN" || operator === "NOT_IN") && rightType !== "array" && rightType !== "unknown") fail(ctx.path, "IN requires an array on the right");
    if (operator === "CONTAINS" && !["string", "array", "unknown"].includes(leftType)) fail(ctx.path, "CONTAINS requires text or an array");
    if ((operator === "EQ" || operator === "NEQ") && ![leftType, rightType].some(type => type === "unknown" || type === "null") && leftType !== rightType) fail(ctx.path, "comparison types do not match");
    return { kind: "compare", operator, left, right };
  });
  r.predicate.register("exists", (raw, ctx) => {
    shape(raw, ctx, ["value"]); return { kind: "exists", value: ctx.value(raw.value, `${ctx.path}.value`) };
  });
  r.predicate.register("all", (raw, ctx) => {
    shape(raw, ctx, ["conditions"]); return { kind: "all", conditions: array(raw.conditions, ctx.path, 1).map((v, i) => ctx.read("predicate", v, `${ctx.path}.conditions[${i}]`)) };
  });
  r.predicate.register("any", (raw, ctx) => {
    shape(raw, ctx, ["conditions"]); return { kind: "any", conditions: array(raw.conditions, ctx.path, 1).map((v, i) => ctx.read("predicate", v, `${ctx.path}.conditions[${i}]`)) };
  });
  r.predicate.register("not", (raw, ctx) => {
    shape(raw, ctx, ["condition"]); return { kind: "not", condition: ctx.read("predicate", raw.condition, `${ctx.path}.condition`) };
  });
  r.selector.register("cards", (raw, ctx) => {
    shape(raw, ctx, ["chooser", "owner", "zones", "min", "max", "mode"], ["controller", "condition", "exclude"]);
    const min = integer(raw.min, `${ctx.path}.min`), max = integer(raw.max, `${ctx.path}.max`);
    if (min > max) fail(ctx.path, "min exceeds max");
    const zones = array(raw.zones, ctx.path, 1).map(v => oneOf(v, ZONES, ctx.path));
    if (new Set(zones).size !== zones.length) fail(ctx.path, "duplicate zones");
    const scope: Scope = fork(ctx.scope, true);
    return {
      kind: "cards", chooser: oneOf(raw.chooser, players, ctx.path), owner: oneOf(raw.owner, owners, ctx.path), zones, min, max,
      mode: oneOf(raw.mode, ["SELECT", "RANDOM", "BLIND_SELECT", "ALL", "ORDER"], ctx.path),
      ...(raw.controller === undefined ? {} : { controller: oneOf(raw.controller, owners, ctx.path) }),
      ...(raw.condition === undefined ? {} : { condition: ctx.read("predicate", raw.condition, `${ctx.path}.condition`, scope) }),
      ...(raw.exclude === undefined ? {} : { exclude: ctx.read("predicate", raw.exclude, `${ctx.path}.exclude`, scope) }),
    };
  });
  r.selector.register("choice", (raw, ctx) => {
    shape(raw, ctx, ["chooser", "options"]);
    const options = array(raw.options, ctx.path, 1).map((value, i) => {
      const path = `${ctx.path}.options[${i}]`, option = object(value, path);
      keys(option, ["id", "label"], [], path);
      return { id: identifier(option.id, path), label: text(option.label, path, 200) };
    });
    if (new Set(options.map(v => v.id)).size !== options.length) fail(ctx.path, "duplicate option IDs");
    return { kind: "choice", chooser: oneOf(raw.chooser, players, ctx.path), options };
  });
  r.cost.register("payDon", (raw, ctx) => {
    shape(raw, ctx, ["amount"]); return { kind: "payDon", amount: integer(raw.amount, ctx.path, 1) };
  });
  r.cost.register("moveCards", (raw, ctx) => {
    shape(raw, ctx, ["selector", "destination"], ["saveAs"]);
    const selector = cardSelector(raw.selector, ctx), destination = ctx.destination(raw.destination, `${ctx.path}.destination`);
    return { kind: "moveCards", selector, destination, ...save(raw, ctx, "cards") };
  });
  r.cost.register("restCards", (raw, ctx) => {
    shape(raw, ctx, ["selector"], ["saveAs"]); const selector = cardSelector(raw.selector, ctx);
    return { kind: "restCards", selector, ...save(raw, ctx, "cards") };
  });
  r.action.register("draw", (raw, ctx) => {
    shape(raw, ctx, ["player", "amount"], ["saveAs"]);
    const player = oneOf(raw.player, players, ctx.path), amount = integer(raw.amount, ctx.path, 1);
    return { kind: "draw", player, amount, ...save(raw, ctx, "cards") };
  });
  r.action.register("select", (raw, ctx) => {
    shape(raw, ctx, ["selector", "saveAs"]); const selector = ctx.read("selector", raw.selector, `${ctx.path}.selector`);
    return { kind: "select", selector, saveAs: ctx.bind(raw.saveAs, selector.kind === "cards" ? "cards" : "choice") };
  });
  r.action.register("move", (raw, ctx) => {
    shape(raw, ctx, ["cards", "destination", "cause"], ["saveAs"]);
    const cards = selectedCards(raw.cards, ctx), destination = ctx.destination(raw.destination, `${ctx.path}.destination`);
    const cause = oneOf(raw.cause, ["BATTLE_KO", "EFFECT_KO", "EFFECT_MOVE", "COST_PAYMENT", "RULE_PROCESSING", "DAMAGE", "OTHER"], ctx.path);
    return { kind: "move", cards, destination, cause, ...save(raw, ctx, "result") };
  });
  r.action.register("sequence", (raw, ctx) => {
    shape(raw, ctx, ["actions"]); return { kind: "sequence", actions: ctx.actions(raw.actions, `${ctx.path}.actions`) };
  }, (node, estimate) => 1 + estimate(node.actions));
  r.action.register("if", (raw, ctx) => {
    shape(raw, ctx, ["condition", "then", "else"]);
    return { kind: "if", condition: ctx.read("predicate", raw.condition, `${ctx.path}.condition`), then: branch(ctx, raw.then, `${ctx.path}.then`), else: branch(ctx, raw.else, `${ctx.path}.else`) };
  }, (node, estimate) => 1 + Math.max(estimate(node.then), estimate(node.else)));
  r.action.register("optional", (raw, ctx) => {
    shape(raw, ctx, ["player", "actions"]); return { kind: "optional", player: oneOf(raw.player, players, ctx.path), actions: branch(ctx, raw.actions, `${ctx.path}.actions`) };
  }, (node, estimate) => 1 + estimate(node.actions));
  r.action.register("repeat", (raw, ctx) => {
    shape(raw, ctx, ["count", "actions"]); return { kind: "repeat", count: integer(raw.count, ctx.path, 0, LIMITS.repeat), actions: branch(ctx, raw.actions, `${ctx.path}.actions`) };
  }, (node, estimate) => 1 + node.count * estimate(node.actions));
  r.modifier.register("power", (raw, ctx) => {
    shape(raw, ctx, ["target", "amount"]); return { kind: "power", target: cardTarget(raw.target, ctx), amount: integer(raw.amount, ctx.path, -1000000, 1000000) };
  });
  r.duration.register("thisTurn", (raw, ctx) => { shape(raw, ctx, []); return { kind: "thisTurn" }; });
  r.duration.register("nextOpponentTurnEnd", (raw, ctx) => { shape(raw, ctx, []); return { kind: "nextOpponentTurnEnd" }; });
  r.duration.register("permanent", (raw, ctx) => { shape(raw, ctx, []); return { kind: "permanent" }; });
  r.restriction.register("forbid", (raw, ctx) => {
    shape(raw, ctx, ["target", "operation"]); return { kind: "forbid", target: cardTarget(raw.target, ctx), operation: oneOf(raw.operation, ["attack", "activate", "move"], ctx.path) };
  });
  r.replacement.register("replaceMove", (raw, ctx) => {
    shape(raw, ctx, ["condition", "actions"]); return { kind: "replaceMove", condition: ctx.read("predicate", raw.condition, `${ctx.path}.condition`), actions: branch(ctx, raw.actions, `${ctx.path}.actions`) };
  }, (node, estimate) => 1 + estimate(node.actions));
  r.action.register("modify", (raw, ctx) => {
    shape(raw, ctx, ["modifier", "duration"]); return { kind: "modify", modifier: ctx.read("modifier", raw.modifier, `${ctx.path}.modifier`), duration: ctx.read("duration", raw.duration, `${ctx.path}.duration`) };
  });
  r.action.register("installRestriction", (raw, ctx) => {
    shape(raw, ctx, ["restriction", "duration"]); return { kind: "installRestriction", restriction: ctx.read("restriction", raw.restriction, `${ctx.path}.restriction`), duration: ctx.read("duration", raw.duration, `${ctx.path}.duration`) };
  });
  r.action.register("installReplacement", (raw, ctx) => {
    shape(raw, ctx, ["replacement", "duration"]); return { kind: "installReplacement", replacement: ctx.read("replacement", raw.replacement, `${ctx.path}.replacement`), duration: ctx.read("duration", raw.duration, `${ctx.path}.duration`) };
  }, (node, estimate) => 1 + r.replacement.get(node.replacement.kind)!.estimateSteps(node.replacement, estimate));
  return r;
}
