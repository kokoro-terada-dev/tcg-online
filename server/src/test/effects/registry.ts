import type { Action, Category, CategoryMaps, NodeFor, Scope, Value, Destination, BindingType } from "./types";

export class DefinitionError extends Error {
  constructor(public readonly path: string, message: string) { super(`${path}: ${message}`); this.name = "DefinitionError"; }
}
export interface ValidationContext {
  readonly path: string;
  readonly scope: Scope;
  read<C extends Category>(category: C, input: unknown, path: string, scope?: Scope): NodeFor<C>;
  value(input: unknown, path: string): Value;
  destination(input: unknown, path: string): Destination;
  actions(input: unknown, path: string, scope?: Scope): Action[];
  bind(name: unknown, type: BindingType): string;
}
export type Parser<T> = (input: Record<string, unknown>, context: ValidationContext) => T;
export type StepEstimator<T> = (node: T, children: (nodes: Action[]) => number) => number;
export type RegistryEntry<T> = { readonly kind: string; readonly parse: Parser<T>; readonly estimateSteps: StepEstimator<T>; readonly status: "schemaOnly" };

export class Registry<M> {
  private readonly entries = new Map<string, RegistryEntry<M[keyof M]>>();
  private sealed = false;
  register<K extends keyof M & string>(kind: K, parse: Parser<M[K]>, estimateSteps: StepEstimator<M[K]> = () => 1): this {
    if (this.sealed) throw new Error("Registry is sealed");
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(kind)) throw new Error("Invalid registry kind");
    if (this.entries.has(kind)) throw new Error(`Duplicate registry kind: ${kind}`);
    this.entries.set(kind, Object.freeze({ kind, parse, estimateSteps: (node: M[keyof M], children: (nodes: Action[]) => number) => estimateSteps(node as M[K], children), status: "schemaOnly" }));
    return this;
  }
  get(kind: string): RegistryEntry<M[keyof M]> | undefined { return this.entries.get(kind); }
  seal(): void { this.sealed = true; }
}
export type Registries = { [C in Category]: Registry<CategoryMaps[C]> };
export function createRegistries(): Registries {
  return { trigger: new Registry(), predicate: new Registry(), selector: new Registry(), cost: new Registry(), action: new Registry(), replacement: new Registry(), modifier: new Registry(), duration: new Registry(), restriction: new Registry() };
}
export function sealRegistries(registries: Registries): void {
  Object.values(registries).forEach(registry => registry.seal());
}
