const fs = require('node:fs'), path = require('node:path');
const { builtinV3Registries, compilerVersionForSchema, v3RegistryHash } = require('../server/dist/test/effects/v3/compiler.js');
const file = path.join(__dirname, '../docs/card-effect-supported-operations.json'), data = JSON.parse(fs.readFileSync(file, 'utf8'));
const schema = '3.0.0-subset.34', previous = '3.0.0-subset.33', registries = builtinV3Registries(schema);
const profile = { compilerVersion: compilerVersionForSchema(schema), registryHash: v3RegistryHash(registries), registries: Object.fromEntries(Object.entries(registries).map(([k, v]) => [k, v.manifest()])) };
data.profiles[schema] = profile;
Object.assign(data, { basedOnCommit: '8b87185', compilerVersion: profile.compilerVersion, registryHash: profile.registryHash, registries: profile.registries });
for (const op of data.operations) if (op.availableIn.includes(previous) && !op.availableIn.includes(schema)) op.availableIn.push(schema);
const schemaFile = 'card-effect-continuous.schema.json';
const op = { name: 'CONTINUOUS_EFFECT', category: 'action', handlerVersion: '1', status: 'implemented_limited', availableIn: [schema], placement: 'CardDefinition.continuousEffects only',
  requiredParameters: ['condition', 'affectedQuery', 'operation'], optionalParameters: ['id', 'sourceSpan'], schemaRef: schemaFile + '#/$defs/continuousEffect',
  parameterSchemas: { condition: { $ref: schemaFile + '#/$defs/predicate' }, affectedQuery: { $ref: schemaFile + '#/$defs/query' },
    operation: { oneOf: [{ type: 'object', required: ['type', 'stat', 'amount'], additionalProperties: false, properties: {
      type: { const: 'ADD_STAT' }, stat: { enum: ['power', 'cost'] }, amount: { type: 'integer', minimum: -100000, maximum: 100000, not: { const: 0 } }
    } }, { type: 'object', required: ['type', 'keyword'], additionalProperties: false, properties: { type: { const: 'GRANT_KEYWORD' }, keyword: { $ref: schemaFile + '#/$defs/keyword' } } }] } },
  description: 'Adds field power/cost or grants a keyword while a public source and its stable conditions are valid.',
  runtimeConstraints: 'Public field only; no current-stat/current-keyword dependencies, base sets, counter changes, private queries or timed grants.',
  example: { type: 'CONTINUOUS_EFFECT', condition: { type: 'TURN_IS', player: 'OPPONENT' }, affectedQuery: {
    type: 'QUERY_CARDS', owner: 'SELF', controller: 'SELF', zone: 'character', visibility: 'PUBLIC', faceUpOnly: true,
    cardTypes: ['character'], filters: { type: 'all', conditions: [] }, excludeSource: false
  }, operation: { type: 'ADD_STAT', stat: 'cost', amount: 1 } } };
const index = data.operations.findIndex(row => row.category === op.category && row.name === op.name && row.handlerVersion === op.handlerVersion);
if (index < 0) data.operations.push(op); else data.operations[index] = op;
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
