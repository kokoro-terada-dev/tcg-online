const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const ts = require("typescript");

test("declaration merging extends typed registries and rejects mismatched commands", () => {
  const file = path.resolve(__dirname, "../src/test/effects/__contract_check__.ts");
  const source = `
import { Registry } from "./registry";
import { createBuiltinRegistries } from "./builtins";
import type { ActionMap, PredicateMap, ReplacementMap } from "./types";
declare module "./types" {
  interface ActionMap { probeAction: { kind: "probeAction"; amount: number } }
  interface PredicateMap { probePredicate: { kind: "probePredicate"; enabled: boolean } }
  interface ReplacementMap { probeReplacement: { kind: "probeReplacement"; token: string } }
}
const actions = new Registry<ActionMap>();
actions.register("probeAction", () => ({ kind: "probeAction", amount: 1 }));
const predicates = new Registry<PredicateMap>();
predicates.register("probePredicate", () => ({ kind: "probePredicate", enabled: true }));
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
