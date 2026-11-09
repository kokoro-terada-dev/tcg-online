const fs = require('node:fs'), path = require('node:path');
const { builtinV3Registries, compilerVersionForSchema, v3RegistryHash } = require('../server/dist/test/effects/v3/compiler.js');
const file = path.join(__dirname, '../docs/card-effect-supported-operations.json'), data = JSON.parse(fs.readFileSync(file, 'utf8'));
const schema = '3.0.0-subset.32', previous = '3.0.0-subset.31', registries = builtinV3Registries(schema);
const profile = { compilerVersion: compilerVersionForSchema(schema), registryHash: v3RegistryHash(registries), registries: Object.fromEntries(Object.entries(registries).map(([k, v]) => [k, v.manifest()])) };
data.profiles[schema] = profile;
Object.assign(data, { basedOnCommit: '5701f4d', compilerVersion: profile.compilerVersion, registryHash: profile.registryHash, registries: profile.registries });
for (const op of data.operations) if (op.availableIn.includes(previous) && !op.availableIn.includes(schema)) op.availableIn.push(schema);
const op = { name: 'DISCARD_BY_OWNER', category: 'action', handlerVersion: '1', status: 'implemented_limited', availableIn: [schema],
  requiredParameters: ['player', 'chooser', 'count'], optionalParameters: ['id', 'sourceSpan'], schemaRef: 'card-effect-owner-discard.schema.json#/$defs/action',
  parameterSchemas: { player: { const: 'OPPONENT' }, chooser: { const: 'OPPONENT' }, count: { type: 'integer', minimum: 1, maximum: 50 } },
  description: 'The opponent privately chooses cards from their own hand to discard as an effect.',
  runtimeConstraints: 'Mandatory min(count, current hand size); zero is a no-op. No filters, bindings, hidden destination or ordering. Only the committed discard becomes public.',
  example: { type: 'DISCARD_BY_OWNER', player: 'OPPONENT', chooser: 'OPPONENT', count: 1 } };
const index = data.operations.findIndex(row => row.category === op.category && row.name === op.name && row.handlerVersion === op.handlerVersion);
if (index < 0) data.operations.push(op); else data.operations[index] = op;
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
