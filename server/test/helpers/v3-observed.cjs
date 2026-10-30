const { setup: base, always } = require('./v3-event.cjs');
const { compileV3CardJson } = require('../../dist/test/effects/v3/compiler.js');
const { ApprovedV3Catalog } = require('../../dist/test/effects/v3/approval.js');
const { V3SyntheticMatchCoordinator } = require('../../dist/test/effects/v3/matchCoordinator.js');
let n = 0;
const id = () => `observed-${++n}`;
const selector = (owner = 'OPPONENT', chooser = 'SELF') => ({ type: 'CARDS', owner, controller: owner, chooser, zone: 'character', visibility: 'PUBLIC', faceUpOnly: true,
  cardTypes: ['character'], filters: always(), excludeSource: true, min: 0, max: 1, selectionMode: 'SELECT', order: 'UNORDERED', onInsufficient: 'fail' });
function setup({ count = 2, sourceType = 'leader', field = 1, mutate = () => {}, mutateBoard = () => {} } = {}) {
  const { options, approval } = base({ field }), cards = [...options.cards];
  const raw = structuredClone(cards.find(c => c.definition.cardType === sourceType).definition);
  raw.schemaVersion = '3.0.0-subset.22'; raw.source.text = 'Synthetic resolving observer, not a real card.';
  raw.effects = Array.from({ length: count }, (_, i) => ({ id: `watch-${i}`, kind: 'triggered', timing: { type: 'ON_EVENT', event: 'CARD_ENTERED',
    snapshot: 'TRANSACTION_AFTER', relation: 'OTHER', owner: 'SELF', controller: 'SELF', fromZones: ['hand'], toZones: ['character'], cardTypes: ['character'], filters: always() },
    sourceZones: [sourceType], optional: false, usageLimit: null, activationConditions: always(), resolutionConditions: always(), costs: [],
    actions: [{ type: 'DRAW', player: 'SELF', count: 1 }] }));
  mutate(raw); const plan = compileV3CardJson(JSON.stringify(raw));
  const approved = new ApprovedV3Catalog([plan], [{ ...approval, cardId: raw.cardId, definitionHash: plan.definitionHash, sourceHash: plan.sourceHash,
    compilerVersion: plan.compilerVersion, registryHash: plan.registryHash }], approval.rulesetVersion).get(raw.cardId);
  cards[cards.findIndex(c => c.definition.cardId === raw.cardId)] = approved;
  const board = structuredClone(options.movement);
  for (const player of [0, 1]) for (const instance of board.players[player].hand) Object.assign(board.cards[instance], { cardId: 'TARGET', kind: 'character' });
  mutateBoard(board); const o = { ...options, cards, movement: board }, c = new V3SyntheticMatchCoordinator(o);
  return { c, options: o, raw, approved };
}
function play(c, actor = 0) { const card = c.playableCardsFor(actor).find(c => c.enabled).card; c.playCard(actor, id(), c.context(), card); return card; }
function select(c, effectId, actor = c.viewFor(0).triggerChooser) {
  const choice = c.viewFor(actor).triggerChoices.find(c => c.effectId === effectId); c.resolveTrigger(actor, id(), c.context(), choice.token); return choice;
}
function finish(c, actor = c.viewFor(0).resolutionActor) {
  for (let i = 0; i < 40; i++) {
    const frame = c.viewFor(actor).frame;
    if (frame.status === 'completed') return;
    if (frame.status === 'ready') c.advance(actor, id(), c.context());
    else if (frame.status === 'waitingForWork') c.applyPendingWork(actor, id(), c.context());
    else return frame;
  }
  throw Error('Resolution did not terminate');
}
module.exports = { setup, play, select, finish, selector, id, always };
