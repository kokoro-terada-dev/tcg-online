import type { DeepReadonly, Evaluation, Predicate, PredicateMap, Value, Comparison } from "./types";
import type { Facts, FactValue } from "./facts";
import { ConditionError, known, unknown, resolveValue } from "./facts";

export type EvaluationContext = Readonly<{
  resolve(value: DeepReadonly<Value>): Evaluation<FactValue>;
  evaluate(predicate: DeepReadonly<Predicate>): Evaluation<boolean>;
}>;
export type PredicateHandler<T> = (node: DeepReadonly<T>, context: EvaluationContext) => Evaluation<boolean>;
export class PredicateRuntimeRegistry {
  private readonly handlers = new Map<string, PredicateHandler<Predicate>>();
  private sealed = false;
  register<K extends keyof PredicateMap & string>(kind: K, handler: PredicateHandler<PredicateMap[K]>): this {
    if (this.sealed) throw new ConditionError("Predicate runtime registry is sealed");
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(kind) || this.handlers.has(kind)) throw new ConditionError("Invalid or duplicate predicate runtime kind");
    this.handlers.set(kind, (node, context) => handler(node as DeepReadonly<PredicateMap[K]>, context));
    return this;
  }
  get(kind: string): PredicateHandler<Predicate> | undefined { return this.handlers.get(kind); }
  seal(): void { this.sealed = true; }
}
function compare(operator: Comparison, left: FactValue, right: FactValue): Evaluation<boolean> {
  if (!["EQ", "NEQ", "GT", "GTE", "LT", "LTE", "IN", "NOT_IN", "CONTAINS"].includes(operator)) throw new ConditionError("Unknown comparison operator");
  if (operator === "EQ" || operator === "NEQ") {
    if (Array.isArray(left) || Array.isArray(right)) return unknown("array-equality-not-supported");
    if (left !== null && right !== null && typeof left !== typeof right) return unknown("comparison-type-mismatch");
    return known(operator === "EQ" ? left === right : left !== right);
  }
  if (operator === "IN" || operator === "NOT_IN") {
    if (!Array.isArray(right) || Array.isArray(left)) return unknown("membership-type-mismatch");
    const included = right.some(item => item === left);
    return known(operator === "IN" ? included : !included);
  }
  if (operator === "CONTAINS") {
    if (Array.isArray(left) && !Array.isArray(right)) return known(left.some(item => item === right));
    if (typeof left === "string" && typeof right === "string") return known(left.includes(right));
    return unknown("contains-type-mismatch");
  }
  if (typeof left !== "number" || typeof right !== "number") return unknown("numeric-comparison-type-mismatch");
  const operators = { GT: (a: number, b: number) => a > b, GTE: (a: number, b: number) => a >= b, LT: (a: number, b: number) => a < b, LTE: (a: number, b: number) => a <= b };
  const operation = operators[operator];
  if (!operation) throw new ConditionError("Unknown comparison operator");
  return known(operation(left, right));
}

export function createPredicateRuntimeRegistry(): PredicateRuntimeRegistry {
  return new PredicateRuntimeRegistry()
    .register("compare", (node, ctx) => {
      const left = ctx.resolve(node.left), right = ctx.resolve(node.right);
      if (left.state === "unknown") return left;
      if (right.state === "unknown") return right;
      return compare(node.operator, left.value, right.value);
    })
    .register("exists", (node, ctx) => {
      const result = ctx.resolve(node.value);
      return result.state === "unknown" ? result : known(result.value !== null);
    })
    .register("not", (node, ctx) => {
      const result = ctx.evaluate(node.condition);
      return result.state === "unknown" ? result : known(!result.value);
    })
    .register("all", (node, ctx) => {
      let missing: Evaluation<boolean> | null = null;
      for (const condition of node.conditions) {
        const result = ctx.evaluate(condition);
        if (result.state === "known" && !result.value) return result;
        if (result.state === "unknown") missing = result;
      }
      return missing ?? known(true);
    })
    .register("any", (node, ctx) => {
      let missing: Evaluation<boolean> | null = null;
      for (const condition of node.conditions) {
        const result = ctx.evaluate(condition);
        if (result.state === "known" && result.value) return result;
        if (result.state === "unknown") missing = result;
      }
      return missing ?? known(false);
    });
}

export const EVALUATION_LIMITS = Object.freeze({ steps: 512, depth: 24 });
export type EvaluationBudget = Readonly<{ spend(): void }>;
export function createEvaluationBudget(): EvaluationBudget {
  let steps = 0;
  return Object.freeze({ spend() { if (++steps > 4096) throw new ConditionError("Cumulative evaluation budget exceeded"); } });
}
// A parsed definition is required by the caller; success never authorizes an action.
export function evaluateCondition(predicate: DeepReadonly<Predicate> | undefined, facts: Facts, registry = createPredicateRuntimeRegistry(), budget?: EvaluationBudget): Evaluation<boolean> {
  registry.seal();
  let steps = 0, depth = 0;
  const spend = () => { if (++steps > EVALUATION_LIMITS.steps) throw new ConditionError("Condition evaluation step limit exceeded"); budget?.spend(); };
  const ctx: EvaluationContext = {
    resolve(value) { spend(); return resolveValue(value, facts); },
    evaluate(node) {
      spend();
      if (++depth > EVALUATION_LIMITS.depth) throw new ConditionError("Condition evaluation depth limit exceeded");
      try {
        const handler = registry.get(node.kind);
        if (!handler) throw new ConditionError(`No runtime predicate handler: ${node.kind}`);
        const result = handler(node, ctx);
        if (result?.state === "unknown" && typeof result.reason === "string") return unknown(result.reason);
        if (result?.state === "known" && typeof result.value === "boolean") return known(result.value);
        throw new ConditionError("Predicate handler returned an invalid result");
      } finally { depth--; }
    },
  };
  Object.freeze(ctx);
  return predicate === undefined ? known(true) : ctx.evaluate(predicate);
}
