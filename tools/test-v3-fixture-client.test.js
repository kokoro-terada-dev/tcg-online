import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const module = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL("../src/testMatch/v3FixtureClient.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { module, exports: module.exports });
const { acceptV3View, v3Command, v3BoardView } = module.exports;
function view() {
  const zones = ['hand', 'deck', 'life', 'trash', 'public', 'character', 'stage', 'leader', 'donDeck', 'activeDon', 'restDon'];
  return { matchId: 'm', localPlayerIndex: 0, actor: 0, imageAliases: { SYNTHETIC: 'IMAGE' }, frame: { status: 'ready', resolutionId: 'r', revision: 1 }, progression: { revision: 3 }, movement: { revision: 2, players: [0, 1].map(() => Object.fromEntries(zones.map(zone => [zone, []]))) } };
}
test('v3 views cannot switch seats or regress any revision, and old match responses are ignored', () => {
  const v = view(); assert.equal(acceptV3View(null, v, 'm'), true);
  for (const next of [{ ...v, localPlayerIndex: 1 }, { ...v, frame: { ...v.frame, revision: 0 } }, { ...v, movement: { ...v.movement, revision: 1 } }, { ...v, progression: { revision: 2 } }]) assert.equal(acceptV3View(v, next, 'm'), false);
  assert.equal(acceptV3View(v, v, null), false); assert.equal(acceptV3View(v, v, 'other'), false);
});
test('v3 commands send three revisions and opaque tokens without client authority', () => {
  const v = view(), c = v3Command(v, 'advance', 'req'); assert.equal(c.frameRevision, 1); assert.equal(c.movementRevision, 2); assert.equal(c.progressionRevision, 3); assert.equal(Object.hasOwn(c, 'actor'), false);
  assert.throws(() => v3Command({ ...v, localPlayerIndex: 1 }, 'advance', 'bad'));
  v.frame.status = 'waitingForChoice'; v.frame.choice = { chooser: 0, selectionId: 's', min: 0, max: 1, options: [{ token: 'opaque', cardId: 'CARD' }] };
  assert.equal(v3Command(v, 'answer', 'answer', ['opaque']).selectionId, 's'); assert.throws(() => v3Command(v, 'answer', 'bad', ['forged']));
  v.movement.players[0].leader.push({ ref: { instanceId: 'source', generation: 0 }, cardId: 'SYNTHETIC', kind: 'leader', rotated: false, faceUp: true });
  assert.equal(v3BoardView(v).players[0].zones.leader[0].cardId, 'IMAGE'); assert.equal(v.movement.players[0].leader[0].cardId, 'SYNTHETIC');
});
