const fs = require('node:fs'), path = require('node:path');
const { builtinV3Registries, compilerVersionForSchema, v3RegistryHash } = require('../server/dist/test/effects/v3/compiler.js');
const file = path.join(__dirname, '../docs/card-effect-supported-operations.json'), data = JSON.parse(fs.readFileSync(file, 'utf8'));
const schema = '3.0.0-subset.28', registries = builtinV3Registries(schema);
const profile = { compilerVersion: compilerVersionForSchema(schema), registryHash: v3RegistryHash(registries), registries: Object.fromEntries(Object.entries(registries).map(([k, v]) => [k, v.manifest()])) };
data.profiles[schema] = profile;
Object.assign(data, { basedOnCommit: 'bde8a25', compilerVersion: profile.compilerVersion, registryHash: profile.registryHash, registries: profile.registries });
for (const op of data.operations) if (op.availableIn.includes('3.0.0-subset.27') && !op.availableIn.includes(schema)) op.availableIn.push(schema);
const state = { enum: ['ACTIVE', 'REST'] };
for (const op of [
  { name: 'SET_DON_STATE', requiredParameters: ['cards', 'from', 'to'], parameterSchemas: { cards: { $ref: 'card-effect-don-effects.schema.json#/$defs/cardSetRef' }, from: state, to: state },
    description: 'Change the state of selected own unattached cost-area DON cards.', runtimeConstraints: 'Different states required; maximum ten distinct exact refs; current zone must match from. Use existing CARDS selection.',
    example: { type: 'SET_DON_STATE', cards: { ref: 'bindings.chosen' }, from: 'REST', to: 'ACTIVE' } },
  { name: 'ADD_DON', requiredParameters: ['player', 'count', 'state', 'onInsufficient'], parameterSchemas: { player: { const: 'SELF' }, count: { type: 'integer', minimum: 1, maximum: 10 }, state, onInsufficient: { const: 'fail' } },
    description: 'Move exactly count DON cards from the top of the own DON deck to the requested state.', runtimeConstraints: 'No partial application on shortage. Not a cost, attachment or return.',
    example: { type: 'ADD_DON', player: 'SELF', count: 1, state: 'ACTIVE', onInsufficient: 'fail' } }
]) {
  const entry = { ...op, category: 'action', handlerVersion: '1', status: 'implemented_limited', availableIn: [schema], optionalParameters: ['id', 'sourceSpan'], schemaRef: 'card-effect-don-effects.schema.json#/$defs/action' };
  const i = data.operations.findIndex(x => x.category === entry.category && x.name === entry.name);
  if (i < 0) data.operations.push(entry); else data.operations[i] = entry;
}
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
