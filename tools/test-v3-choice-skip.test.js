import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url), module = { exports: {} };
const localRequire = name => name === "react" ? { useState: initial => [initial, () => {}] } : name === "../utils/localCardImages" ? { getLocalCardImage: () => null } : require(name);
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL("../src/testMatch/V3ChoicePanel.tsx", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, { module, exports: module.exports, require: localRequire });
const nodes = element => !element || typeof element !== "object" ? [] : [element, ...[element.props?.children].flat(Infinity).flatMap(nodes)];
test("optional event skip sends an empty answer only and does not appear for required or legacy choices", () => {
  let tokens;
  const props = { choice: { purpose: "action", min: 0, max: 1, options: [] }, disabled: false, allowSkip: true, onConfirm: value => tokens = value };
  const buttons = p => nodes(module.exports.default(p)).filter(e => e.type === "button");
  assert.equal(buttons(props).length, 2); buttons(props)[1].props.onClick(); assert.equal(tokens.length, 0);
  assert.equal(buttons({ ...props, allowSkip: false }).length, 1);
  assert.equal(buttons({ ...props, choice: { ...props.choice, min: 1 } }).length, 1);
  assert.equal(buttons({ ...props, disabled: true })[1].props.disabled, true);
});
