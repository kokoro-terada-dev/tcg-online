const fs = require('node:fs'), path = require('node:path');
const { builtinV3Registries, compilerVersionForSchema, v3RegistryHash } = require('../server/dist/test/effects/v3/compiler.js');
const file = path.join(__dirname, '../docs/card-effect-supported-operations.json'), data = JSON.parse(fs.readFileSync(file, 'utf8'));
const schema = '3.0.0-subset.38', previous = '3.0.0-subset.37', registries = builtinV3Registries(schema);
const profile = { compilerVersion: compilerVersionForSchema(schema), registryHash: v3RegistryHash(registries), registries: Object.fromEntries(Object.entries(registries).map(([k, v]) => [k, v.manifest()])) };
data.profiles[schema] = profile;
Object.assign(data, { basedOnCommit: 'c34e2a0', compilerVersion: profile.compilerVersion, registryHash: profile.registryHash, registries: profile.registries });
for (const op of data.operations) if (op.name !== 'REPLACE_EVENT' && op.availableIn.includes(previous) && !op.availableIn.includes(schema)) op.availableIn.push(schema);
const old = data.operations.find(op => op.name === 'REPLACE_EVENT' && op.handlerVersion === '1');
const schemaFile = 'card-effect-paid-replacement.schema.json', schemaRef = schemaFile + '#/$defs/replacementEffect';
const op = { ...old, handlerVersion: '2', availableIn: [schema], schemaRef, optionalParameters: [...old.optionalParameters, 'optionalPayment'],
  parameterSchemas: Object.fromEntries(['match', 'condition', 'substitute', 'optionalPayment'].map(key => [key, { $ref: schemaRef + '/properties/' + key }])),
  description: 'Inherits free replacement and can prevent an effect KO by discarding one eligible event or stage from the protected character controller’s hand.',
  runtimeConstraints: 'Owner-only exact-one MOVE_AS_COST selector, no extra selector filters. Discard is the replacement effect. Only same-source paid alternatives may share a prompt; mixed, chained, simultaneous, usage-limited and battle replacements remain unsupported.',
  example: { ...old.example, substitute: { type: 'PREVENT' }, optionalPayment: { type: 'MOVE_AS_COST', destination: 'trash', selector: {
    type: 'CARDS', owner: 'SELF', controller: 'SELF', chooser: 'SELF', zone: 'hand', visibility: 'OWNER_ONLY', faceUpOnly: false, cardTypes: ['event', 'stage'],
    filters: { type: 'all', conditions: [] }, excludeSource: true, min: 1, max: 1, selectionMode: 'SELECT', order: 'UNORDERED', onInsufficient: 'fail'
  } } } };
const index = data.operations.findIndex(row => row.name === op.name && row.handlerVersion === op.handlerVersion);
if (index < 0) data.operations.push(op); else data.operations[index] = op;
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
