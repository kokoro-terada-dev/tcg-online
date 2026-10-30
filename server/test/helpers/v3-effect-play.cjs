const memory = require('./v3-memory.cjs');
const { V3SyntheticMatchCoordinator } = require('../../dist/test/effects/v3/matchCoordinator.js');
const play = (change = {}) => ({ type: 'PLAY_BY_EFFECT', cards: { ref: 'bindings.chosen' }, from: 'hand',
  destination: { owner: 'SELF', zone: 'character', slotPolicy: 'FIRST_EMPTY' }, enterState: 'ACTIVE', provenance: 'EFFECT', condition: memory.always(), ...change });
function setup({ count = 1, min = count, actor = 0, filter = memory.always(), condition = filter, enterState = 'ACTIVE', mutate = () => {}, board = () => {}, definitions = cards => cards } = {}) {
  const h = memory.setup({ actor, mutate: raw => {
    raw.schemaVersion = '3.0.0-subset.27';
    const s = memory.selector('SELF'); Object.assign(s, { zone: 'hand', visibility: 'OWNER_ONLY', faceUpOnly: false, excludeSource: false, min, max: Math.max(1, count), filters: filter });
    raw.effects[0].actions = [{ type: 'SELECT', selector: s, bindAs: 'chosen' }, play({ condition, enterState })]; mutate(raw);
  } });
  const options = { ...h.options, movement: structuredClone(h.options.movement), cards: definitions([...h.options.cards]) }; board(options.movement);
  const c = new V3SyntheticMatchCoordinator(options);
  return { ...h, options, c };
}
function start(h, n = 1) {
  h.c.activate(h.actor, memory.id(), h.c.context(), h.source, 'watch-0'); memory.finish(h.c, h.actor);
  const q = h.c.viewFor(h.actor).frame.choice;
  if (q) h.c.answer(h.actor, memory.id(), h.c.context(), q.selectionId, q.options.slice(0, n).map(row => row.token));
  return memory.finish(h.c, h.actor);
}
module.exports = { ...memory, setup, play, start };
