const { setup: base, finish, selector, id, always } = require('./v3-observed.cjs');
const { compileV3CardJson } = require('../../dist/test/effects/v3/compiler.js');
const { ApprovedV3Catalog } = require('../../dist/test/effects/v3/approval.js');
const { V3SyntheticMatchCoordinator } = require('../../dist/test/effects/v3/matchCoordinator.js');
const { createProgression } = require('../../dist/test/progression/state.js');
const { applySystemEvent } = require('../../dist/test/progression/transitions.js');
const remember = (change = {}) => ({ type: 'REMEMBER_FACTS', result: 'returned', cards: null, snapshot: 'BEFORE', basis: 'CURRENT', field: 'colors', bindAs: 'colors', ...change });
const predicate = (change = {}) => ({ type: 'REMEMBERED_COLORS', memory: 'colors', subject: 'SOURCE', basis: 'CURRENT', match: 'OVERLAP', ...change });
function setup({ count = 1, actor = 0, from = 'character', to = 'hand', mutate = () => {} } = {}) {
  const h = base({ field: 3, count: 1, mutate: raw => {
    raw.schemaVersion = '3.0.0-subset.26'; raw.colors = ['Red'];
    const s = selector('SELF'); Object.assign(s, { zone: from, min: count, max: Math.max(1, count), excludeSource: false, visibility: from === 'hand' ? 'OWNER_ONLY' : 'PUBLIC', faceUpOnly: from !== 'hand' });
    Object.assign(raw.effects[0], { kind: 'activated', timing: { type: 'MAIN' }, actions: [{ type: 'SELECT', selector: s, bindAs: 'chosen' },
      { type: 'MOVE_CARD', cards: { ref: 'bindings.chosen' }, destination: { owner: 'SELF', zone: to, position: 'append', faceUp: true }, cause: 'EFFECT' },
      { type: 'MOVE_RESULT', bindAs: 'returned' }, remember(), { type: 'IF', condition: predicate(), then: [{ type: 'DRAW', player: 'SELF', count: 1 }], else: [] }] }); mutate(raw);
  } });
  const options = { ...h.options, cards: [...h.options.cards], movement: structuredClone(h.options.movement) };
  const original = options.cards.find(c => c.definition.cardId === 'TARGET');
  for (const [name, colors] of [['RED', ['Red']], ['BLUE', ['Blue']], ['MULTI', ['Red', 'Blue']]]) {
    const raw = structuredClone(original.definition); raw.cardId = name; raw.colors = colors;
    const p = compileV3CardJson(JSON.stringify(raw)), a = { status: 'approved', cardId: name, cardVersion: raw.cardVersion, definitionHash: p.definitionHash, sourceHash: p.sourceHash,
      compilerVersion: p.compilerVersion, registryHash: p.registryHash, rulesetVersion: h.approved.rulesetVersion, reviewer: 'synthetic-only', approvedAt: '2026-10-30T00:00:00.000Z', ruleEvidence: ['synthetic'] };
    options.cards.push(new ApprovedV3Catalog([p], [a], a.rulesetVersion).get(name));
  }
  for (const player of [0, 1]) {
    options.movement.players[player].character.forEach((instanceId, index) => { if (instanceId) options.movement.cards[instanceId].cardId = ['RED', 'BLUE', 'MULTI'][index]; });
    options.movement.players[player].hand.forEach(instanceId => { options.movement.cards[instanceId].cardId = 'RED'; });
  }
  if (actor === 1) {
    let p = createProgression(1);
    while (true) { p = applySystemEvent(p, p.revision, { kind: 'settlePhase', phaseToken: p.phaseToken }); if (p.phase === 'main') break; p = applySystemEvent(p, p.revision, { kind: 'advancePhase', phaseToken: p.phaseToken }); }
    options.progression = p;
  }
  const c = new V3SyntheticMatchCoordinator(options), card = options.movement.cards[options.movement.players[actor].leader[0]];
  return { ...h, options, c, actor, source: { instanceId: card.instanceId, generation: card.generation } };
}
function start(h, n = 1) {
  h.c.activate(h.actor, id(), h.c.context(), h.source, 'watch-0'); finish(h.c, h.actor);
  const q = h.c.viewFor(h.actor).frame.choice;
  h.c.answer(h.actor, id(), h.c.context(), q.selectionId, q.options.slice(0, n).map(row => row.token));
  return finish(h.c, h.actor);
}
const frame = h => JSON.parse(JSON.parse(h.c.snapshotForCoordinator().active.frame).payload);
module.exports = { setup, start, frame, remember, predicate, finish, selector, id, always };
