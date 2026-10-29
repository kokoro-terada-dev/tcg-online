import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const module = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/testMatch/v3RequestId.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { module, exports: module.exports });
const { v3RequestId } = module.exports;
test('v3 request IDs work without randomUUID and never fall back to insecure randomness', () => {
  assert.equal(v3RequestId({ randomUUID: () => 'native-id' }), 'native-id');
  assert.equal(v3RequestId({ getRandomValues: bytes => bytes.fill(0) }), '00000000-0000-4000-8000-000000000000');
  assert.throws(() => v3RequestId({}));
});
