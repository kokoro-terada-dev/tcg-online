import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url), module = { exports: {} };
const fixtureRequire = name => name === "../utils/localCardImages" ? { getLocalCardImage: () => ({ imageUrl: "data:image/png;base64,fixture" }) } : require(name);
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL("../src/testMatch/V3MainEffectDialog.tsx", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, { module, exports: module.exports, require: fixtureRequire });
const Dialog = module.exports.default;
const all = element => !element || typeof element !== "object" ? [] : [element, ...[element.props?.children].flat(Infinity).flatMap(all)];

test("MAIN dialog binds buttons to the selected object, not a same-name copy or another zone", () => {
  let activated = null, closed = 0;
  const effects = [
    { source: { instanceId: "a", generation: 1 }, sourceToken: "a-token", effectId: "main", label: "自分をレスト", enabled: true, used: 0, limit: 1 },
    { source: { instanceId: "b", generation: 1 }, sourceToken: "b-token", effectId: "main", label: "別個体", enabled: true, used: 0, limit: 1 },
  ];
  const view = { localPlayerIndex: 0, effects, imageAliases: {}, publicStats: [
    { card: effects[0].source, cardId: "SAME", player: 0, zone: "character", slot: 0 },
    { card: effects[1].source, cardId: "SAME", player: 0, zone: "character", slot: 1 },
  ] };
  const props = { view, sourceId: "a", disabled: false, onClose: () => closed++, onActivate: e => activated = e };
  const elements = all(Dialog(props)), buttons = elements.filter(e => e.type === "button");
  assert.equal(buttons.length, 2); assert.equal(buttons[1].key, "a-token"); assert.equal(buttons[1].props.disabled, false);
  buttons[1].props.onClick(); assert.equal(activated, effects[0]); buttons[0].props.onClick(); assert.equal(closed, 1);
  assert.equal(all(Dialog({ ...props, disabled: true })).filter(e => e.type === "button")[1].props.disabled, true);
  effects[0].enabled = false;
  assert.equal(all(Dialog(props)).filter(e => e.type === "button")[1].props.disabled, true);
  assert.equal(Dialog({ ...props, sourceId: "missing" }), null);
});

test("stage MAIN dialog and empty effects retain a close button without borrowing leader actions", () => {
  const view = { localPlayerIndex: 0, effects: [], imageAliases: {}, publicStats: [{ card: { instanceId: "stage", generation: 2 }, cardId: "STAGE", player: 0, zone: "stage", slot: 0 }] };
  const elements = all(Dialog({ view, sourceId: "stage", disabled: false, onClose: () => {}, onActivate: () => assert.fail() }));
  assert.equal(elements.filter(e => e.type === "button").length, 1);
  assert.equal(elements.some(e => e.props?.role === "status"), true);
});

test("hand event uses its own MAIN token without borrowing a field or counter effect", () => {
  let selected;
  const source = { instanceId: "event", generation: 2 }, view = { localPlayerIndex: 0, effects: [], publicStats: [], imageAliases: {},
    movement: { players: [{ hand: [{ ref: source, cardId: "EVENT" }] }] },
    mainEventChoices: [{ source, sourceToken: "event-token", cardId: "EVENT", effectId: "main", cost: 1, enabled: true }] };
  const buttons = all(Dialog({ view, sourceId: "event", disabled: false, onClose: () => {}, onActivate: e => selected = e })).filter(e => e.type === "button");
  assert.equal(buttons.length, 2); buttons[1].props.onClick(); assert.equal(selected.sourceToken, "event-token"); assert.equal(selected.event, true);
});
