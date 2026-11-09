const fs = require('node:fs'), path = require('node:path');
const { builtinV3Registries, compilerVersionForSchema, v3RegistryHash } = require('../server/dist/test/effects/v3/compiler.js');
const file = path.join(__dirname, '../docs/card-effect-supported-operations.json'), data = JSON.parse(fs.readFileSync(file, 'utf8'));
const schema = '3.0.0-subset.36', previous = '3.0.0-subset.35', registries = builtinV3Registries(schema);
const profile = { compilerVersion: compilerVersionForSchema(schema), registryHash: v3RegistryHash(registries), registries: Object.fromEntries(Object.entries(registries).map(([k, v]) => [k, v.manifest()])) };
data.profiles[schema] = profile;
Object.assign(data, { basedOnCommit: 'fd62ff6', compilerVersion: profile.compilerVersion, registryHash: profile.registryHash, registries: profile.registries });
for (const op of data.operations) if (op.name !== 'CONTINUOUS_EFFECT' && op.availableIn.includes(previous) && !op.availableIn.includes(schema)) op.availableIn.push(schema);
const inherited = data.operations.find(op => op.name === 'CONTINUOUS_EFFECT' && op.handlerVersion === '2');
const schemaFile = 'card-effect-protection.schema.json';
const op = { ...structuredClone(inherited), handlerVersion: '3', availableIn: [schema], schemaRef: schemaFile + '#/$defs/continuousEffect',
  parameterSchemas: { condition: { $ref: schemaFile + '#/$defs/predicate' }, affectedQuery: { $ref: schemaFile + '#/$defs/query' },
    operation: { $ref: schemaFile + '#/$defs/continuousEffect/properties/operation' } },
  description: 'Continuous field protections with separate target eligibility, effect immunity, KO and zone-move policies; inherits prior stat operations.',
  runtimeConstraints: 'Friendly public targets only. KO distinguishes effects and battle, with an optional exact printed attack attribute for battle. Opposing effect immunity does not rewrite costs or game rules.',
  example: { ...inherited.example, operation: { type: 'RESTRICT', policy: 'CANNOT_KO', by: 'OPPONENT', cause: 'EFFECT' } } };
const index = data.operations.findIndex(row => row.category === op.category && row.name === op.name && row.handlerVersion === op.handlerVersion);
if (index < 0) data.operations.push(op); else data.operations[index] = op;
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
