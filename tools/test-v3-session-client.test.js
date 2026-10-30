import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const module = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL("../src/testMatch/v3SessionClient.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { module, exports: module.exports });
const { acceptV3SessionView, v3SessionCommand } = module.exports;
function view() { return { mode: 'v3-synthetic-session', matchId: 'm', localPlayerIndex: 0, activePlayer: 0, turnNumber: 1, phase: 'main', gate: 'idle', frame: null, resolutionActor: null,
  context: { revision: 0, movementRevision: 0, progressionRevision: 0, resolutionId: null, frameRevision: null }, movement: { revision: 0 }, effects: [{ sourceToken: 'main-token', effectId: 'draw', enabled: true }], playableCards: [] }; }

test('conditional-trigger hold blocks new commands but preserves current choice/resume permissions', () => {
  const v = { ...view(), conditionalTriggerHold: true };
  assert.throws(() => v3SessionCommand(v, 'endTurn', 'held'), /held/);
  assert.throws(() => v3SessionCommand(v, 'activate', 'held-main', { sourceToken: 'main-token', effectId: 'draw' }), /held/);
  v.frame = { status: 'waitingForChoice', choice: { selectionId: 'selection', chooser: 0, min: 0, max: 1, options: [] } };
  v.gate = 'choice'; v.resolutionActor = 0;
  assert.equal(v3SessionCommand(v, 'answer', 'continue', { tokens: [] }).selectionId, 'selection');
});
test('session views allow new resolution IDs only with increasing session revisions, without seat or board rollback', () => {
  const v = view(); assert.equal(acceptV3SessionView(null, v, 'm'), true);
  const next = { ...v, frame: { resolutionId: 'r', revision: 0 }, context: { ...v.context, revision: 1, resolutionId: 'r', frameRevision: 0 } };
  assert.equal(acceptV3SessionView(v, next, 'm'), true); assert.equal(acceptV3SessionView(next, v, 'm'), false);
  assert.equal(acceptV3SessionView(v, { ...next, context: { ...next.context, revision: 0 } }, 'm'), false);
  assert.equal(acceptV3SessionView(v, { ...v, localPlayerIndex: 1 }, 'm'), false); assert.equal(acceptV3SessionView(v, v, null), false);
  assert.equal(acceptV3SessionView(v, { ...v, context: { ...v.context, frameRevision: 1 } }, 'm'), false);
});
test('session commands use current context and chooser tokens without sending actor or card authority', () => {
  const v = view(), command = v3SessionCommand(v, 'activate', 'request', { sourceToken: 'main-token', effectId: 'draw' });
  assert.equal(command.effectId, 'draw'); assert.equal(Object.hasOwn(command, 'actor'), false); assert.equal(Object.hasOwn(command, 'source'), false);
  assert.equal(command.sourceToken, 'main-token');
  assert.throws(() => v3SessionCommand({ ...v, activePlayer: 1 }, 'activate', 'wrong-turn', { effectId: 'draw' }));
  v.frame = { status: 'waitingForChoice', choice: { selectionId: 's', chooser: 0, min: 1, max: 1, options: [{ token: 'opaque' }] } }; v.gate = 'choice';
  assert.equal(v3SessionCommand(v, 'answer', 'answer', { tokens: ['opaque'] }).selectionId, 's');
  assert.throws(() => v3SessionCommand(v, 'answer', 'forged', { tokens: ['other'] })); assert.throws(() => v3SessionCommand(v, 'endTurn', 'pending'));
});

test('MAIN client requires an exact source token and effect pair; no leader fallback or stale modal authority', () => {
  const v = view(); v.effects.push({ sourceToken: 'stage-token', effectId: 'stage-main', enabled: true });
  for (const details of [{ effectId: 'draw' }, { sourceToken: 'stale-token', effectId: 'draw' }, { sourceToken: 'main-token', effectId: 'stage-main' }]) assert.throws(() => v3SessionCommand(v, 'activate', 'bad', details));
  assert.throws(() => v3SessionCommand({ ...v, phase: 'end' }, 'activate', 'phase', { sourceToken: 'main-token', effectId: 'draw' }));
  v.effects[0].enabled = false; assert.throws(() => v3SessionCommand(v, 'activate', 'disabled', { sourceToken: 'main-token', effectId: 'draw' }));
  const command = v3SessionCommand(v, 'activate', 'stage', { sourceToken: 'stage-token', effectId: 'stage-main' });
  assert.equal(command.sourceToken, 'stage-token'); assert.equal(command.effectId, 'stage-main');
});

test('event MAIN client sends only the current token/effect pair and rejects counter-only or blocked use', () => {
  const v = view(); v.mainEventChoices = [{ sourceToken: 'event-token', effectId: 'main', enabled: true }];
  assert.equal(v3SessionCommand(v, 'mainEvent', 'use', { sourceToken: 'event-token', effectId: 'main' }).sourceToken, 'event-token');
  for (const patch of [{ activePlayer: 1 }, { phase: 'end' }, { gate: 'choice' }, { mainEventChoices: [] }]) assert.throws(() => v3SessionCommand({ ...v, ...patch }, 'mainEvent', 'bad', { sourceToken: 'event-token', effectId: 'main' }));
  for (const details of [{ sourceToken: 'old', effectId: 'main' }, { sourceToken: 'event-token', effectId: 'counter' }, { effectId: 'main' }]) assert.throws(() => v3SessionCommand(v, 'mainEvent', 'bad', details));
});

test('event selection chooser may differ from the effect controller but cannot execute its work', () => {
  const v = view(); v.localPlayerIndex = 1; v.resolutionActor = 0; v.gate = 'choice';
  v.frame = { status: 'waitingForChoice', choice: { chooser: 1, selectionId: 's', min: 0, max: 1, options: [{ token: 'choice' }] } };
  assert.equal(v3SessionCommand(v, 'answer', 'answer', { tokens: ['choice'] }).selectionId, 's');
  assert.throws(() => v3SessionCommand(v, 'answer', 'bad', { tokens: ['fake'] }));
  assert.throws(() => v3SessionCommand(v, 'work', 'foreign-work'));
});

test('normal play uses only the current approved playable reference and rejects disabled or stale cards', () => {
  const v = view(), card = { instanceId: 'hand-card', generation: 1 }; v.playableCards = [{ card, enabled: true }];
  const play = v3SessionCommand(v, 'play', 'play', { card }); assert.equal(play.card.instanceId, 'hand-card'); assert.equal(play.card.generation, 1);
  assert.equal(Object.hasOwn(play, 'actor'), false); assert.equal(Object.hasOwn(play, 'cost'), false);
  assert.throws(() => v3SessionCommand(v, 'play', 'stale', { card: { ...card, generation: 0 } }));
  v.playableCards[0].enabled = false; assert.throws(() => v3SessionCommand(v, 'play', 'disabled', { card }));
});
