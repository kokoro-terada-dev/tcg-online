const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { compileV3CardJson } = require('../dist/test/effects/v3/compiler.js');
const { ApprovedV3Catalog } = require('../dist/test/effects/v3/approval.js');
const { createMatch } = require('../dist/test/game.js');
const { MatchMovementCapture } = require('../dist/test/effects/matchMovement.js');
const { createProgression } = require('../dist/test/progression/state.js');
const { applyPlayerIntent, applySystemEvent } = require('../dist/test/progression/transitions.js');
const { attackOptions, declareAttack, blockerOptions } = require('../dist/test/effects/v3/battle.js');
const { addKeywordGrants, endTurnKeywordGrants } = require('../dist/test/effects/v3/keywordEffects.js');
const { availableTriggers, triggerChooser } = require('../dist/test/effects/v3/triggerScheduler.js');

test('Rush:Character excludes leaders until Rush is granted; Blocker excludes the attack target and respects Cannot Be Blocked', () => {
  const plans = ['character', 'leader'].map(kind => {
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/v3-vanilla-character.json'), 'utf8'));
    Object.assign(data, { cardId: kind.toUpperCase(), cardType: kind, reviewStatus: 'approved', keywords: kind === 'character' ? [{ type: 'RUSH_CHARACTER' }] : [] });
    data.source.text = kind === 'character' ? 'Synthetic Rush:Character fixture, not a real card.' : ''; data.baseStats.power = 5000;
    return compileV3CardJson(JSON.stringify(data));
  });
  const catalog = new ApprovedV3Catalog(plans, plans.map(plan => ({ status: 'approved', cardId: plan.definition.cardId, cardVersion: plan.definition.cardVersion, definitionHash: plan.definitionHash,
    sourceHash: plan.sourceHash, compilerVersion: plan.compilerVersion, registryHash: plan.registryHash, rulesetVersion: 'synthetic.1', reviewer: 'test', approvedAt: '2026-10-29T00:00:00.000Z', ruleEvidence: ['synthetic:not-official-cards'] })), 'synthetic.1');
  const definitions = plans.map(plan => catalog.get(plan.definition.cardId)), known = new Map(definitions.map(card => [card.definition.cardId, card]));
  const recipe = { name: 'Fixture', leaderCardId: 'LEADER', mainDeck: Array(50).fill('CHARACTER'), donDeck: Array(10).fill('DON'), cardTypes: { CHARACTER: 'character' }, leaderLifeCount: 5 };
  const match = createMatch(recipe, recipe);
  for (const player of [0, 1]) match.players[player].zones.character[0] = { ...match.players[player].zones.hand.shift(), faceUp: true, rotated: player === 1 };
  const board = structuredClone(new MatchMovementCapture(match, 3).snapshot().movement);
  const ref = id => ({ instanceId: id, generation: board.cards[id].generation });
  const source = ref(board.players[0].character[0]), target = ref(board.players[1].character[0]), leader = ref(board.players[1].leader[0]); board.cards[source.instanceId].enteredTurn = 3;
  let progression = createProgression(0);
  while (true) {
    if (!progression.phaseSettled) progression = applySystemEvent(progression, progression.revision, { kind: 'settlePhase', phaseToken: progression.phaseToken });
    if (progression.phase === 'main') { if (progression.turnNumber === 3) break; progression = applyPlayerIntent(progression, progression.revision, progression.activePlayer, 'endMain'); }
    else progression = applySystemEvent(progression, progression.revision, { kind: 'advancePhase', phaseToken: progression.phaseToken });
  }
  const hasPair = (choices, to) => choices.pairs.some(pair => pair.sourceId === source.instanceId && pair.targetId === to.instanceId);
  assert.equal(hasPair(attackOptions(board, progression, 0, known, []), target), true); assert.equal(hasPair(attackOptions(board, progression, 0, known, []), leader), false);
  assert.throws(() => declareAttack(board, progression, 0, source, leader, known, [], 'battle-bad', 'attack-bad'));
  const rush = addKeywordGrants(board, [], 'rush', source, 0, [source], { type: 'RUSH' }, { type: 'TURN_END', player: 'SELF', occurrence: 1 }, definitions);
  assert.equal(hasPair(attackOptions(board, progression, 0, known, rush), leader), true); assert.equal(endTurnKeywordGrants(rush, 0).length, 0);
  let grants = addKeywordGrants(board, [], 'blocker', source, 0, [leader, target], { type: 'BLOCKER' }, { type: 'TURN_END', player: 'OPPONENT', occurrence: 1 }, definitions);
  const attack = declareAttack(board, progression, 0, source, target, known, grants, 'battle-ok', 'attack-ok');
  assert.deepEqual(blockerOptions(attack.movement, attack.progression, 1, known, grants).map(option => option.card.instanceId), [leader.instanceId]);
  grants = addKeywordGrants(attack.movement, grants, 'unblockable', source, 0, [source], { type: 'CANNOT_BE_BLOCKED' }, { type: 'TURN_END', player: 'SELF', occurrence: 1 }, definitions);
  assert.deepEqual(blockerOptions(attack.movement, attack.progression, 1, known, grants), []);
});

test('derived triggers never overtake an earlier group even when the derived controller is the turn player', () => {
  const queue = [{ batchId: 'earlier', actor: 0, token: 'a' }, { batchId: 'earlier', actor: 1, token: 'b' }, { batchId: 'derived', actor: 0, token: 'c' }];
  assert.deepEqual(availableTriggers(queue, 0).map(entry => entry.token), ['a']);
  assert.equal(triggerChooser(queue.slice(1), 0), 1); assert.deepEqual(availableTriggers(queue.slice(1), 0).map(entry => entry.token), ['b']);
});
