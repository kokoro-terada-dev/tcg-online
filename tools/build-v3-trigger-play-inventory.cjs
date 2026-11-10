const fs = require('node:fs'), path = require('node:path');
const { builtinV3Registries, compilerVersionForSchema, v3RegistryHash } = require('../server/dist/test/effects/v3/compiler.js');
const file = path.join(__dirname, '../docs/card-effect-supported-operations.json'), data = JSON.parse(fs.readFileSync(file, 'utf8'));
const schema = '3.0.0-subset.45', previous = '3.0.0-subset.44', registries = builtinV3Registries(schema);
const profile = { compilerVersion: compilerVersionForSchema(schema), registryHash: v3RegistryHash(registries), registries: Object.fromEntries(Object.entries(registries).map(([k, v]) => [k, v.manifest()])) };
data.profiles[schema] = profile;
Object.assign(data, { basedOnCommit: '2fa9917', compilerVersion: profile.compilerVersion, registryHash: profile.registryHash, registries: profile.registries });
for (const op of data.operations) if (op.availableIn.includes(previous) && !op.availableIn.includes(schema)) op.availableIn.push(schema);
const entry = { category: 'action', name: 'PLAY_TRIGGER_SOURCE', handlerVersion: '1', status: 'implemented', availableIn: [schema],
  schemaRef: '../schemas/effect-v3-subset45.schema.json#/$defs/action', requiredParameters: [], optionalParameters: ['id', 'sourceSpan'], parameterSchemas: {},
  description: 'Play the resolving life trigger Character or Stage itself without paying the printed cost.',
  runtimeConstraints: 'Only the entire unconditional Character or Stage TRIGGER. An occupied Stage or full Character area requires trashing an existing card by rule, not KO.',
  example: { type: 'PLAY_TRIGGER_SOURCE' } };
const index = data.operations.findIndex(op => op.category === entry.category && op.name === entry.name);
if (index < 0) data.operations.push(entry); else data.operations[index] = entry;
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
