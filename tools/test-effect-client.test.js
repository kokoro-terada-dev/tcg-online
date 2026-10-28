import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const module = { exports: {} };
const source = fs.readFileSync(new URL("../src/testMatch/effectClientState.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
vm.runInNewContext(compiled, { exports: module.exports, module });
const { acceptEffectView, effectCommand, effectBoardView, effectCatalogQuery, acceptEffectCatalog, registeredEffectCommand } = module.exports;
const plain = value => JSON.parse(JSON.stringify(value));
function view() {
  const zones = ["hand", "deck", "life", "trash", "public", "character", "stage", "leader", "donDeck", "activeDon", "restDon", "attachedDon", "resolving"];
  const players = [0, 1].map(() => Object.fromEntries(zones.map(z => [z, z === "character" ? Array(5).fill(null) : z === "stage" || z === "leader" ? [null] : []])));
  players[0].hand.push({ ref: { instanceId: "a", generation: 3 }, cardId: "CARD", kind: "character", rotated: false, faceUp: true, attachedTo: null });
  players[1].hand.push({ ref: null, cardId: null, kind: null, rotated: false, faceUp: false, attachedTo: null });
  return { matchId: "m", localPlayerIndex: 0, movement: { matchId: "m", revision: 3, players }, effect: { resolutionId: "r", actor: 0, status: "prepared", completedSteps: 0, masterVersion: null }, progression: { revision: 7 }, selection: null };
}
test("effect views reject either stale revision, a different match, and a changed seat", () => {
  const current = view(); assert.equal(acceptEffectView(null, current), true);
  assert.equal(acceptEffectView(current, view()), true);
  for (const next of [{ ...view(), matchId: "other" }, { ...view(), localPlayerIndex: 1 }, { ...view(), movement: { ...view().movement, revision: 2 } }, { ...view(), progression: { revision: 6 } }]) assert.equal(acceptEffectView(current, next), false);
});
test("commands use the latest two revisions and only opaque selection tokens", () => {
  const v = view(); v.selection = { chooser: 0, selectionId: "select" };
  const tokens = ["opaque"], c = effectCommand(v, "answerCosts", "request", tokens); tokens[0] = "changed";
  assert.deepEqual(plain(c), { matchId: "m", resolutionId: "r", requestId: "request", expectedMovementRevision: 3, expectedProgressionRevision: 7, kind: "answerCosts", selectionId: "select", tokens: ["opaque"] });
});
test("other players and missing selections cannot be answered", () => {
  const v = view(); assert.throws(() => effectCommand(v, "answerEffect", "request"));
  v.selection = { chooser: 1, selectionId: "other" }; assert.throws(() => effectCommand(v, "answerCosts", "request"));
});
test("non-selection commands contain no selection fields or client authority", () => {
  const c = effectCommand(view(), "beginCosts", "request");
  for (const field of ["actor", "sourceId", "definition", "rules", "selectionId", "tokens"]) assert.equal(Object.hasOwn(c, field), false);
});
test("read-only board adapter preserves visible IDs and produces placeholders only for hidden cards", () => {
  const v = view(), before = structuredClone(v), board = effectBoardView(v);
  assert.equal(board.players[0].zones.hand[0].id, "a"); assert.equal(board.players[1].zones.hand[0].cardId, null);
  assert.equal(board.players[1].zones.hand[0].id, "hidden:1:hand:0"); assert.equal(board.attack, null);
  assert.deepEqual(v, before); assert.equal(board.players[0].zones.character.length, 5);
});
test("unsupported extra zones are refused rather than silently dropping cards", () => {
  for (const zone of ["attachedDon", "resolving"]) { const v = view(); v.movement.players[0][zone].push(v.movement.players[0].hand[0]); assert.throws(() => effectBoardView(v)); }
});

test("catalog queries preserve generation and both revisions for either seat", () => {
  for (const seat of [0, 1]) {
    const v = view(); v.localPlayerIndex = seat;
    v.movement.players[seat].leader[0] = { ...v.movement.players[0].hand[0], ref: { instanceId: "leader", generation: 4 } };
    const q = effectCatalogQuery(v, "leader");
    assert.deepEqual(plain(q), { matchId: "m", expectedMovementRevision: 3, expectedProgressionRevision: 7, source: { instanceId: "leader", generation: 4 } });
    q.source.generation = 99; assert.equal(v.movement.players[seat].leader[0].ref.generation, 4);
  }
});
test("catalog queries exclude hidden, opposing and off-board cards", () => {
  const v = view();
  assert.throws(() => effectCatalogQuery(v, "a"));
  v.movement.players[1].leader[0] = { ...v.movement.players[0].hand[0], ref: { instanceId: "other", generation: 0 } };
  assert.throws(() => effectCatalogQuery(v, "other"));
  v.movement.players[0].leader[0] = { ...v.movement.players[0].hand[0], faceUp: false };
  assert.throws(() => effectCatalogQuery(v, "a"));
});
test("catalog responses reject stale revisions, generations, wrong cards and matches", () => {
  const v = view(); v.movement.players[0].leader[0] = { ...v.movement.players[0].hand[0] };
  const q = effectCatalogQuery(v, "a"), c = { matchId: "m", movementRevision: 3, progressionRevision: 7, source: { instanceId: "a", generation: 3 }, effects: [], catalogVersion: null };
  assert.equal(acceptEffectCatalog(v, q, c), true);
  for (const patch of [{ matchId: "old" }, { movementRevision: 2 }, { progressionRevision: 6 }, { source: { instanceId: "other", generation: 3 } }, { source: { instanceId: "a", generation: 2 } }]) assert.equal(acceptEffectCatalog(v, q, { ...c, ...patch }), false);
  v.movement.revision++; assert.equal(acceptEffectCatalog(v, q, c), false);
  v.movement.revision--; v.movement.players[0].leader[0] = null; assert.equal(acceptEffectCatalog(v, q, c), false);
});
test("registered activation requests contain only the current server context and selected ID", () => {
  const v = view(); v.movement.players[0].leader[0] = { ...v.movement.players[0].hand[0] };
  const c = { matchId: 'm', movementRevision: 3, progressionRevision: 7, source: { instanceId: 'a', generation: 3 }, catalogVersion: 'version', activationEnabled: true, effects: [{ effectId: 'TEST.main', timingAvailable: true }] };
  const command = registeredEffectCommand(v, c, 'TEST.main', 'request');
  assert.equal(command.kind, 'activateRegistered'); assert.equal(command.resolutionId, 'r'); assert.equal(command.effectId, 'TEST.main');
  for (const key of ['actor', 'definition', 'rules', 'numericPolicy']) assert.equal(Object.hasOwn(command, key), false);
  c.source.generation = 99; assert.equal(command.source.generation, 3);
});
test("stale, disabled and unlisted registered activations are not sent", () => {
  const v = view(); v.movement.players[0].leader[0] = { ...v.movement.players[0].hand[0] };
  const c = { matchId: 'm', movementRevision: 3, progressionRevision: 7, source: { instanceId: 'a', generation: 3 }, catalogVersion: 'version', activationEnabled: true, effects: [{ effectId: 'TEST.main', timingAvailable: true }] };
  assert.throws(() => registeredEffectCommand(v, c, 'missing', 'request'));
  for (const patch of [{ activationEnabled: false }, { movementRevision: 2 }, { catalogVersion: null }, { effects: [{ effectId: 'TEST.main', timingAvailable: false }] }]) assert.throws(() => registeredEffectCommand(v, { ...c, ...patch }, 'TEST.main', 'request'));
});
test("idle views are displayable and synchronizable but cannot issue running-effect commands", () => {
  const v = view(); v.effect.status = 'idle';
  assert.equal(effectBoardView(v).players[0].zones.hand.length, 1); assert.equal(acceptEffectView(null, v), true);
  for (const kind of ['start', 'beginCosts', 'cancelCosts', 'advance', 'commitCosts', 'answerCosts', 'answerEffect']) assert.throws(() => effectCommand(v, kind, 'request'));
});
test("an idle context can activate a registered effect and reject a late previous-context view", () => {
  const v = view(); v.effect.status = 'idle'; v.effect.resolutionId = 'next'; v.movement.players[0].leader[0] = { ...v.movement.players[0].hand[0] };
  const c = { matchId: 'm', movementRevision: 3, progressionRevision: 7, source: { instanceId: 'a', generation: 3 }, catalogVersion: 'version', activationEnabled: true, effects: [{ effectId: 'TEST.main', timingAvailable: true }] };
  assert.equal(registeredEffectCommand(v, c, 'TEST.main', 'request').resolutionId, 'next');
  assert.equal(acceptEffectView(v, { ...view(), progression: { revision: 6 } }), false);
});
