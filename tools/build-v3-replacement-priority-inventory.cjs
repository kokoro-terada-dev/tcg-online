const fs = require('node:fs'), path = require('node:path');
const { builtinV3Registries, compilerVersionForSchema, v3RegistryHash } = require('../server/dist/test/effects/v3/compiler.js');
const file = path.join(__dirname, '../docs/card-effect-supported-operations.json'), data = JSON.parse(fs.readFileSync(file, 'utf8'));
const schema = '3.0.0-subset.39', previous = '3.0.0-subset.38', registries = builtinV3Registries(schema);
const profile = { compilerVersion: compilerVersionForSchema(schema), registryHash: v3RegistryHash(registries), registries: Object.fromEntries(Object.entries(registries).map(([k, v]) => [k, v.manifest()])) };
data.profiles[schema] = profile;
Object.assign(data, { basedOnCommit: '43d542e', compilerVersion: profile.compilerVersion, registryHash: profile.registryHash, registries: profile.registries });
for (const op of data.operations) if (op.name !== 'REPLACE_EVENT' && op.availableIn.includes(previous) && !op.availableIn.includes(schema)) op.availableIn.push(schema);
const old = data.operations.find(op => op.name === 'REPLACE_EVENT' && op.handlerVersion === '2');
const schemaRef = 'card-effect-replacement-priority.schema.json#/$defs/replacementEffect';
const example = structuredClone(old.example);
example.target = { type: 'OWN_CHARACTER', minPrintedCost: 4 };
example.usageLimit = 'ONCE_PER_TURN';
example.optionalPayment.selector.cardTypes = ['character', 'event', 'stage'];
const op = { ...old, handlerVersion: '3', availableIn: [schema], schemaRef, optionalParameters: [...old.optionalParameters, 'target', 'usageLimit'],
  parameterSchemas: Object.fromEntries(['match', 'condition', 'substitute', 'optionalPayment', 'target', 'usageLimit'].map(key => [key, { $ref: schemaRef + '/properties/' + key }])),
  description: 'Uses public replacement holders, printed cost, per-object turn limits, and explicit priority choices for a single effect KO.',
  runtimeConstraints: 'Own public character only for scoped targets, with an exact-one hand discard. Self-KO also allows exact-one DON return. Simultaneous batches, chained, battle and granted replacements remain unsupported.',
  example };
const index = data.operations.findIndex(row => row.name === op.name && row.handlerVersion === op.handlerVersion);
if (index < 0) data.operations.push(op); else data.operations[index] = op;
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
