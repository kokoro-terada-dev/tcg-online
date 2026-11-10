const fs = require('node:fs'), path = require('node:path');
const { builtinV3Registries, compilerVersionForSchema, v3RegistryHash } = require('../server/dist/test/effects/v3/compiler.js');
const file = path.join(__dirname, '../docs/card-effect-supported-operations.json'), data = JSON.parse(fs.readFileSync(file, 'utf8'));
const schema = '3.0.0-subset.44', previous = '3.0.0-subset.43', registries = builtinV3Registries(schema);
const profile = { compilerVersion: compilerVersionForSchema(schema), registryHash: v3RegistryHash(registries), registries: Object.fromEntries(Object.entries(registries).map(([k, v]) => [k, v.manifest()])) };
data.profiles[schema] = profile;
Object.assign(data, { basedOnCommit: 'b4aa4f7', compilerVersion: profile.compilerVersion, registryHash: profile.registryHash, registries: profile.registries });
for (const op of data.operations) if (op.availableIn.includes(previous) && !op.availableIn.includes(schema)) op.availableIn.push(schema);
const entry = { category: 'action', name: 'EXTRA_TURN', handlerVersion: '1', status: 'implemented', availableIn: [schema],
  schemaRef: 'card-effect-extra-turn.schema.json#/$defs/action', requiredParameters: [], optionalParameters: ['id', 'sourceSpan'], parameterSchemas: {},
  description: 'Reserve one extra turn for the resolving effect controller after their current turn.',
  runtimeConstraints: 'Character ON_PLAY during the controller’s main phase only. A second pending reservation, a chain from an extra turn, or an out-of-turn grant is held.',
  example: { type: 'EXTRA_TURN' } };
const index = data.operations.findIndex(row => row.category === entry.category && row.name === entry.name);
if (index < 0) data.operations.push(entry); else data.operations[index] = entry;
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
