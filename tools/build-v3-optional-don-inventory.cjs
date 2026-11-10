const fs = require('node:fs'), path = require('node:path');
const { builtinV3Registries, compilerVersionForSchema, v3RegistryHash } = require('../server/dist/test/effects/v3/compiler.js');
const file = path.join(__dirname, '../docs/card-effect-supported-operations.json'), data = JSON.parse(fs.readFileSync(file, 'utf8'));
const schema = '3.0.0-subset.46', previous = '3.0.0-subset.45', registries = builtinV3Registries(schema);
const profile = { compilerVersion: compilerVersionForSchema(schema), registryHash: v3RegistryHash(registries), registries: Object.fromEntries(Object.entries(registries).map(([k, v]) => [k, v.manifest()])) };
data.profiles[schema] = profile;
Object.assign(data, { basedOnCommit: 'fae8a08', compilerVersion: profile.compilerVersion, registryHash: profile.registryHash, registries: profile.registries });
for (const op of data.operations) if (op.availableIn.includes(previous) && !op.availableIn.includes(schema)) op.availableIn.push(schema);
const entry = { category: 'action', name: 'ADD_DON_UP_TO', handlerVersion: '1', status: 'implemented', availableIn: [schema],
  schemaRef: '../schemas/effect-v3-subset46.schema.json#/$defs/action', requiredParameters: ['player', 'max', 'state'], optionalParameters: ['id', 'sourceSpan'],
  parameterSchemas: { player: { const: 'SELF' }, max: { type: 'integer', minimum: 1, maximum: 10 }, state: { enum: ['ACTIVE', 'REST'] } },
  description: 'Choose a count from zero to the printed cap or remaining DON deck size, whichever is smaller.',
  runtimeConstraints: 'Zero does not change the board. Positive counts use the existing fixed-count ADD_DON work.',
  example: { type: 'ADD_DON_UP_TO', player: 'SELF', max: 2, state: 'REST' } };
const index = data.operations.findIndex(op => op.category === entry.category && op.name === entry.name);
if (index < 0) data.operations.push(entry); else data.operations[index] = entry;
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
