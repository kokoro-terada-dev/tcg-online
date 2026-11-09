const fs = require('node:fs'), path = require('node:path');
const { builtinV3Registries, compilerVersionForSchema, v3RegistryHash } = require('../server/dist/test/effects/v3/compiler.js');
const file = path.join(__dirname, '../docs/card-effect-supported-operations.json'), data = JSON.parse(fs.readFileSync(file, 'utf8'));
const schema = '3.0.0-subset.33', previous = '3.0.0-subset.32', registries = builtinV3Registries(schema);
const profile = { compilerVersion: compilerVersionForSchema(schema), registryHash: v3RegistryHash(registries), registries: Object.fromEntries(Object.entries(registries).map(([k, v]) => [k, v.manifest()])) };
data.profiles[schema] = profile;
Object.assign(data, { basedOnCommit: 'd26144a', compilerVersion: profile.compilerVersion, registryHash: profile.registryHash, registries: profile.registries });
for (const op of data.operations) if (op.availableIn.includes(previous) && !op.availableIn.includes(schema)) op.availableIn.push(schema);
const op = { name: 'ORDER_THEN_MOVE', category: 'action', handlerVersion: '1', status: 'implemented_limited', availableIn: [schema],
  requiredParameters: ['player', 'chooser', 'count', 'destination'], optionalParameters: ['id', 'sourceSpan'], schemaRef: 'card-effect-owner-deck-bottom.schema.json#/$defs/action',
  parameterSchemas: { player: { const: 'OPPONENT' }, chooser: { const: 'OPPONENT' }, count: { type: 'integer', minimum: 1, maximum: 50 }, destination: { const: 'deckBottom' } },
  description: 'The opponent selects cards from their hand and puts them face down at the bottom of their own deck in the submitted order.',
  runtimeConstraints: 'Mandatory min(count, current hand size); zero is a no-op. First chosen is nearest the top of the appended group. No reveal, filters, binding, blind selection or random selection.',
  example: { type: 'ORDER_THEN_MOVE', player: 'OPPONENT', chooser: 'OPPONENT', count: 2, destination: 'deckBottom' } };
const index = data.operations.findIndex(row => row.category === op.category && row.name === op.name && row.handlerVersion === op.handlerVersion);
if (index < 0) data.operations.push(op); else data.operations[index] = op;
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
