const fs = require('node:fs'), path = require('node:path');
const { builtinV3Registries, compilerVersionForSchema, v3RegistryHash } = require('../server/dist/test/effects/v3/compiler.js');
const file = path.join(__dirname, '../docs/card-effect-supported-operations.json'), data = JSON.parse(fs.readFileSync(file, 'utf8'));
const schema = '3.0.0-subset.24', r = builtinV3Registries(schema);
const profile = { compilerVersion: compilerVersionForSchema(schema), registryHash: v3RegistryHash(r), registries: Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.manifest()])) };
data.profiles[schema] = profile;
Object.assign(data, { basedOnCommit: 'd5f5222', compilerVersion: profile.compilerVersion, registryHash: profile.registryHash, registries: profile.registries });
for (const op of data.operations) if (op.availableIn.includes('3.0.0-subset.23') && !op.availableIn.includes(schema)) op.availableIn.push(schema);
const entry = { category: 'duration', name: 'UNTIL_BOUNDARY', handlerVersion: '1', status: 'implemented_limited', availableIn: [schema], schemaRef: 'card-effect-expiry.schema.json#/$defs/duration',
  requiredParameters: ['player', 'boundary', 'occurrence', 'includeCurrent'], optionalParameters: ['id', 'sourceSpan'], parameterSchemas: {
    player: { enum: ['SELF', 'OPPONENT'] }, boundary: { enum: ['TURN_START', 'END_PHASE_END'] }, occurrence: { enum: [1, 2] }, includeCurrent: { type: 'boolean' } },
  description: 'Expiry of applied power/cost or granted keywords at a certified normal-turn checkpoint.',
  runtimeConstraints: 'Application-time anchor; normal alternating turns only. includeCurrent includes the current matching turn end; start cannot be retroactive. Not continuous effects or automatic card-text conversion.',
  example: { type: 'UNTIL_BOUNDARY', player: 'OPPONENT', boundary: 'END_PHASE_END', occurrence: 1, includeCurrent: false } };
const i = data.operations.findIndex(op => op.category === 'duration' && op.name === 'UNTIL_BOUNDARY');
if (i < 0) data.operations.push(entry); else data.operations[i] = entry;
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
