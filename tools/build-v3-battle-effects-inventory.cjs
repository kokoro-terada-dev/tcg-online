const fs = require('node:fs'), path = require('node:path');
const { builtinV3Registries, compilerVersionForSchema, v3RegistryHash } = require('../server/dist/test/effects/v3/compiler.js');
const file = path.join(__dirname, '../docs/card-effect-supported-operations.json'), data = JSON.parse(fs.readFileSync(file, 'utf8'));
const schema = '3.0.0-subset.42', previous = '3.0.0-subset.41', registries = builtinV3Registries(schema);
const profile = { compilerVersion: compilerVersionForSchema(schema), registryHash: v3RegistryHash(registries), registries: Object.fromEntries(Object.entries(registries).map(([k, v]) => [k, v.manifest()])) };
data.profiles[schema] = profile;
Object.assign(data, { basedOnCommit: '0aea54f', compilerVersion: profile.compilerVersion, registryHash: profile.registryHash, registries: profile.registries });
for (const op of data.operations) if (op.availableIn.includes(previous) && !op.availableIn.includes(schema)) op.availableIn.push(schema);
const root = 'card-effect-battle-effects.schema.json#/$defs/';
for (const op of [
  { category: 'action', name: 'RETARGET_BATTLE', schemaRef: root + 'action',
    requiredParameters: ['cards'], parameterSchemas: { cards: { $ref: root + 'cardSetRef' } },
    description: 'Changes only the attack target to a selected public defender leader or character, without declaring a new attack or block.',
    runtimeConstraints: 'Defender only, during ON_OPPONENT_ATTACK or COUNTER. Requires a zero-or-one/one card binding. Prior participants and new target must still be present.',
    example: { type: 'RETARGET_BATTLE', cards: { ref: 'bindings.target' } } },
  { category: 'keyword', name: 'BANISH', schemaRef: root + 'keyword',
    requiredParameters: [], parameterSchemas: {},
    description: 'When the current attacker hits a leader, trash the top life without opening a life TRIGGER choice.',
    runtimeConstraints: 'Printed or granted. Battle damage only, never a KO or a separate multi-damage policy.',
    example: { type: 'BANISH' } }
]) {
  const entry = { ...op, handlerVersion: '1', status: 'implemented', availableIn: [schema], optionalParameters: ['id', 'sourceSpan'] };
  const index = data.operations.findIndex(row => row.category === op.category && row.name === op.name);
  if (index < 0) data.operations.push(entry); else data.operations[index] = entry;
}
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
