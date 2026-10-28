const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const ts = require("typescript");

test("declaration merging extends typed registries and rejects mismatched commands", () => {
  const file = path.resolve(__dirname, "../src/test/effects/__contract_check__.ts");
  const source = `
import { Registry } from "./registry";
import { createBuiltinRegistries } from "./builtins";
import { PredicateRuntimeRegistry } from "./predicates";
import { SelectorRuntimeRegistry } from "./selectors";
import { CostRuntimeRegistry } from "./costs";
import type { ActionMap, PredicateMap, ReplacementMap, SelectorMap, CostMap } from "./types";
declare module "./types" {
  interface ActionMap { probeAction: { kind: "probeAction"; amount: number } }
  interface PredicateMap { probePredicate: { kind: "probePredicate"; enabled: boolean } }
  interface ReplacementMap { probeReplacement: { kind: "probeReplacement"; token: string } }
  interface SelectorMap { probeSelector: { kind: "probeSelector"; label: string } }
  interface CostMap { probeCost: { kind: "probeCost"; amount: number } }
}
const actions = new Registry<ActionMap>();
actions.register("probeAction", () => ({ kind: "probeAction", amount: 1 }));
const predicates = new Registry<PredicateMap>();
predicates.register("probePredicate", () => ({ kind: "probePredicate", enabled: true }));
const runtime = new PredicateRuntimeRegistry();
runtime.register("probePredicate", node => ({ state: "known", value: node.enabled }));
// @ts-expect-error predicate runtime results must be boolean, not numeric
runtime.register("probePredicate", () => ({ state: "known", value: 1 }));
const selectors = new SelectorRuntimeRegistry();
selectors.register("probeSelector", (node, context) => ({ state: "known", value: { kind: "choice", chooser: context.actor, options: [{ id: "one", label: node.label }] } }));
// @ts-expect-error selector runtime cannot return a boolean as its plan
selectors.register("probeSelector", () => ({ state: "known", value: true }));
const costRegistry = new CostRuntimeRegistry();
costRegistry.register("probeCost", node => ({ operation: "rest", selector: { kind: "cards", owner: "SELF", chooser: "SELF", zones: ["activeDon"], min: node.amount, max: node.amount, mode: "SELECT" } }));
// @ts-expect-error only standard cost operations may be produced by this stage
costRegistry.register("probeCost", () => ({ operation: "payMoney" }));
const replacements = new Registry<ReplacementMap>();
replacements.register("probeReplacement", () => ({ kind: "probeReplacement", token: "a" }));
const builtins = createBuiltinRegistries();
builtins.action.register("probeAction", () => ({ kind: "probeAction", amount: 1 }));
// @ts-expect-error unregistered type key
actions.register("notInMap", () => ({ kind: "notInMap" }));
// @ts-expect-error payload field type must match its discriminator
actions.register("probeAction", () => ({ kind: "probeAction", amount: "one" }));
// @ts-expect-error discriminator must match the registered key
actions.register("probeAction", () => ({ kind: "draw", amount: 1, player: "SELF" }));
`;
  const options = { noEmit: true, strict: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true, skipLibCheck: true, types: ["node"], target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.CommonJS };
  const host = ts.createCompilerHost(options);
  const originalSource = host.getSourceFile.bind(host);
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) => path.resolve(name) === file ? ts.createSourceFile(name, source, languageVersion, true) : originalSource(name, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram([file], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: () => process.cwd(), getCanonicalFileName: name => name, getNewLine: () => "\n" }));
});
