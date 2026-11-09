const fs = require('node:fs'), path = require('node:path');
const { builtinV3Registries, compilerVersionForSchema, v3RegistryHash } = require('../server/dist/test/effects/v3/compiler.js');
const file = path.join(__dirname, '../docs/card-effect-supported-operations.json'), data = JSON.parse(fs.readFileSync(file, 'utf8'));
const schema = '3.0.0-subset.35', previous = '3.0.0-subset.34', registries = builtinV3Registries(schema);
const profile = { compilerVersion: compilerVersionForSchema(schema), registryHash: v3RegistryHash(registries), registries: Object.fromEntries(Object.entries(registries).map(([k, v]) => [k, v.manifest()])) };
data.profiles[schema] = profile;
Object.assign(data, { basedOnCommit: '206ca7a', compilerVersion: profile.compilerVersion, registryHash: profile.registryHash, registries: profile.registries });
for (const op of data.operations) if (op.name !== 'CONTINUOUS_EFFECT' && op.availableIn.includes(previous) && !op.availableIn.includes(schema)) op.availableIn.push(schema);
const inherited = data.operations.find(op => op.name === 'CONTINUOUS_EFFECT' && op.handlerVersion === '1');
const schemaFile = 'card-effect-base-counter.schema.json';
const generated = JSON.parse(fs.readFileSync(path.join(__dirname, '../docs', schemaFile), 'utf8'));
const op = { ...structuredClone(inherited), handlerVersion: '2', availableIn: [schema], schemaRef: schemaFile + '#/$defs/continuousEffect',
  parameterSchemas: { condition: { $ref: schemaFile + '#/$defs/predicate' }, affectedQuery: { $ref: schemaFile + '#/$defs/query' },
    operation: { $ref: schemaFile + '#/$defs/continuousEffect/properties/operation' } },
  description: 'Public-field additions and base stat setters, plus explicit counter additions or grants to authorized own-hand/public characters.',
  runtimeConstraints: 'Highest applicable power/cost setter first, then additions. A missing printed counter is not numeric zero. Dependent/circular conditions and overlapping counter grants are not resolved.',
  example: { ...inherited.example, operation: { type: 'SET_BASE_STAT', stat: 'cost', value: 3 } } };
if (generated.properties.schemaVersion.const !== schema) throw Error('Schema profile mismatch');
const index = data.operations.findIndex(row => row.category === op.category && row.name === op.name && row.handlerVersion === op.handlerVersion);
if (index < 0) data.operations.push(op); else data.operations[index] = op;
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
