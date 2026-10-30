const { compileV3CardJson } = require('../../dist/test/effects/v3/compiler.js');
const { ApprovedV3Catalog } = require('../../dist/test/effects/v3/approval.js');
const { V3SyntheticMatchCoordinator } = require('../../dist/test/effects/v3/matchCoordinator.js');
const { createMatch } = require('../../dist/test/game.js');
const { MatchMovementCapture } = require('../../dist/test/effects/matchMovement.js');
const { createProgression } = require('../../dist/test/progression/state.js');
const { applySystemEvent } = require('../../dist/test/progression/transitions.js');
const always = () => ({ type: 'all', conditions: [] });
function definition(cost = 2) {
  return { schemaVersion: '3.0.0-subset.19', cardId: 'MAIN-EVENT-FIXTURE', cardVersion: 'synthetic.1', name: '合成イベント', cardType: 'event',
    baseStats: { cost, power: null, counter: null, life: null }, colors: [], traits: [], attributes: [], keywords: [], reviewStatus: 'approved',
    source: { text: 'Synthetic MAIN draw only; not an official card.', triggerText: '', displayIds: ['MAIN-EVENT-FIXTURE'], datasetSha256: '0'.repeat(64) },
    effects: [{ id: 'main', kind: 'activated', timing: { type: 'MAIN' }, sourceZones: ['hand'], optional: false, usageLimit: null,
      activationConditions: always(), resolutionConditions: always(), costs: [], actions: [{ type: 'DRAW', player: 'SELF', count: 1 }] }] };
}
function setup({ actor = 0, cost = 2, don = 2, field = 0, mutate = () => {} } = {}) {
  const d = definition(cost); mutate(d); const p = compileV3CardJson(JSON.stringify(d)), rulesetVersion = 'main-event-synthetic.1';
  const approval = { status: 'approved', cardId: d.cardId, cardVersion: d.cardVersion, definitionHash: p.definitionHash, sourceHash: p.sourceHash,
    compilerVersion: p.compilerVersion, registryHash: p.registryHash, rulesetVersion, reviewer: 'synthetic-only', approvedAt: '2026-10-30T00:00:00.000Z', ruleEvidence: ['synthetic-not-real-card-approval'] };
  const leaderData = { ...definition(), schemaVersion: '3.0.0-subset.16', cardId: 'LEADER', cardType: 'leader',
    baseStats: { cost: null, power: 5000, counter: null, life: 5 }, effects: [], source: { text: '', triggerText: '', displayIds: ['LEADER'], datasetSha256: '0'.repeat(64) } };
  const characterData = { ...leaderData, cardId: 'TARGET', cardType: 'character', baseStats: { cost: 2, power: 2000, counter: 1000, life: null }, source: { ...leaderData.source, displayIds: ['TARGET'] } };
  const target = compileV3CardJson(JSON.stringify(characterData));
  const l = compileV3CardJson(JSON.stringify(leaderData)), catalog = new ApprovedV3Catalog([p, l, target], [approval, { ...approval, cardId: 'TARGET', definitionHash: target.definitionHash, sourceHash: target.sourceHash, compilerVersion: target.compilerVersion, registryHash: target.registryHash }, { ...approval, cardId: 'LEADER',
    definitionHash: l.definitionHash, sourceHash: l.sourceHash, compilerVersion: l.compilerVersion, registryHash: l.registryHash }], rulesetVersion);
  const card = catalog.get(d.cardId);
  const recipe = { name: 'Synthetic MAIN event', leaderCardId: 'LEADER', mainDeck: Array(50).fill(d.cardId), donDeck: Array(10).fill('DON'), cardTypes: { [d.cardId]: 'event' }, leaderLifeCount: 5 };
  const match = createMatch(recipe, recipe);
  for (const player of match.players) for (let i = 0; i < field; i++) player.zones.character[i] = { ...player.zones.deck.shift(), cardId: 'TARGET', kind: 'character', faceUp: true, rotated: false };
  for (const player of match.players) for (let i = 0; i < don; i++) player.zones.activeDon.push({ ...player.zones.donDeck.shift(), faceUp: true, rotated: false });
  let progression = createProgression(actor);
  while (true) { progression = applySystemEvent(progression, progression.revision, { kind: 'settlePhase', phaseToken: progression.phaseToken });
    if (progression.phase === 'main') break; progression = applySystemEvent(progression, progression.revision, { kind: 'advancePhase', phaseToken: progression.phaseToken }); }
  const options = { mode: 'syntheticNoAbilities', movement: new MatchMovementCapture(match, 1).snapshot().movement, progression, cards: [card, catalog.get('LEADER'), catalog.get('TARGET')], signingKey: Buffer.alloc(32, 64), master: null, now: () => 1000 };
  return { c: new V3SyntheticMatchCoordinator(options), d, p, approval, options };
}

module.exports = { setup, definition, always };
