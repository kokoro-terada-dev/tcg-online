const fs = require('node:fs'), path = require('node:path');
const { builtinV3Registries, compilerVersionForSchema, v3RegistryHash } = require('../server/dist/test/effects/v3/compiler.js');
const file = path.join(__dirname, '../docs/card-effect-supported-operations.json'), data = JSON.parse(fs.readFileSync(file, 'utf8'));
const schema = '3.0.0-subset.37', previous = '3.0.0-subset.36', registries = builtinV3Registries(schema);
const profile = { compilerVersion: compilerVersionForSchema(schema), registryHash: v3RegistryHash(registries), registries: Object.fromEntries(Object.entries(registries).map(([k, v]) => [k, v.manifest()])) };
data.profiles[schema] = profile;
Object.assign(data, { basedOnCommit: '8347256', compilerVersion: profile.compilerVersion, registryHash: profile.registryHash, registries: profile.registries });
for (const op of data.operations) if (op.availableIn.includes(previous) && !op.availableIn.includes(schema)) op.availableIn.push(schema);
const schemaFile = 'card-effect-replacement.schema.json';
const op = { category: 'replacement', name: 'REPLACE_EVENT', handlerVersion: '1', status: 'implemented', availableIn: [schema],
  schemaRef: schemaFile + '#/$defs/replacementEffect',
  requiredParameters: ['id', 'match', 'condition', 'substitute'], optionalParameters: ['sourceSpan'],
  parameterSchemas: Object.fromEntries(['match', 'condition', 'substitute'].map(key => [key, { $ref: schemaFile + '#/$defs/replacementEffect/properties/' + key }])),
  description: 'Offers a character controller an optional replacement for a single precommit effect KO or effect move of that character.',
  runtimeConstraints: 'Root replacementEffects only; face-up public character, owned and controlled by its chooser; stable conditions only. No payment, battle/rule KO, simultaneous batch, chaining, or competing replacement resolution.',
  example: { type: 'REPLACE_EVENT', id: 'replace-ko', match: { cause: 'EFFECT_KO', by: 'OPPONENT', from: 'character', to: 'trash' },
    condition: { type: 'all', conditions: [] }, substitute: { to: 'hand' } } };
const index = data.operations.findIndex(row => row.category === op.category && row.name === op.name);
if (index < 0) data.operations.push(op); else data.operations[index] = op;
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
