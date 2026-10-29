import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const module = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL("../src/testMatch/v3SetupClient.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { module, exports: module.exports });
const { acceptV3SetupView, v3SetupCommand } = module.exports;
const initial = () => ({ mode: 'v3-reviewed-setup', matchId: 'm', roomId: '1234', revision: 0, localPlayerIndex: 0, status: 'firstChoice', choicePlayer: 0, firstPlayer: null, mulliganPlayer: null,
  movement: { matchId: 'm', revision: 0 } });

test('reviewed setup views reject stale matches, viewers and movement rollbacks', () => {
  const v = initial(); assert.equal(acceptV3SetupView(null, v, 'm'), true);
  assert.equal(acceptV3SetupView(v, { ...v, matchId: 'other' }, 'm'), false);
  assert.equal(acceptV3SetupView(v, { ...v, localPlayerIndex: 1 }, 'm'), false);
  assert.equal(acceptV3SetupView(v, { ...v, revision: -1 }, 'm'), false);
  assert.equal(acceptV3SetupView(v, { ...v, movement: { matchId: 'm', revision: -1 } }, 'm'), false);
});

test('first and mulligan controls only send the current chooser choice and revision', () => {
  const v = initial(), command = v3SetupCommand(v, 'first', 'second', 'request');
  assert.equal(command.value, 'second'); assert.equal(command.revision, 0); assert.equal(Object.hasOwn(command, 'actor'), false);
  assert.throws(() => v3SetupCommand({ ...v, localPlayerIndex: 1 }, 'first', 'first', 'foreign'));
  assert.throws(() => v3SetupCommand(v, 'mulligan', true, 'early'));
  const mulligan = { ...v, status: 'mulligan', revision: 1, firstPlayer: 0, mulliganPlayer: 1 };
  assert.throws(() => v3SetupCommand(mulligan, 'mulligan', true, 'wrong-seat'));
  assert.equal(v3SetupCommand({ ...mulligan, localPlayerIndex: 1 }, 'mulligan', false, 'keep').revision, 1);
});
