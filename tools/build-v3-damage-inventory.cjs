const fs = require('node:fs'), path = require('node:path');
const { builtinV3Registries, compilerVersionForSchema, v3RegistryHash } = require('../server/dist/test/effects/v3/compiler.js');
const file = path.join(__dirname, '../docs/card-effect-supported-operations.json'), data = JSON.parse(fs.readFileSync(file, 'utf8'));
const schema = '3.0.0-subset.43', previous = '3.0.0-subset.42', registries = builtinV3Registries(schema);
const profile = { compilerVersion: compilerVersionForSchema(schema), registryHash: v3RegistryHash(registries), registries: Object.fromEntries(Object.entries(registries).map(([k, v]) => [k, v.manifest()])) };
data.profiles[schema] = profile;
Object.assign(data, { basedOnCommit: 'a150bde', compilerVersion: profile.compilerVersion, registryHash: profile.registryHash, registries: profile.registries });
for (const op of data.operations) if (op.availableIn.includes(previous) && !op.availableIn.includes(schema)) op.availableIn.push(schema);
const root = 'card-effect-damage.schema.json#/$defs/';
for (const op of [
  { category: 'action', name: 'KO_STAGE', schemaRef: root + 'action', requiredParameters: ['cards'], parameterSchemas: { cards: { $ref: root + 'cardSetRef' } },
    description: 'K.O. selected public stages as stages, with the EFFECT_KO cause.',
    runtimeConstraints: 'A stage in the stage area must still be public and current. Does not generate a character ON_KO.',
    example: { type: 'KO_STAGE', cards: { ref: 'bindings.stage' } } },
  { category: 'action', name: 'MOVE_LIFE', schemaRef: root + 'action', requiredParameters: ['player', 'from', 'to'],
    description: 'Move one card to or from an endpoint of its owner’s Life.',
    runtimeConstraints: 'DECK_TOP or BOUND to LIFE_TOP/LIFE_BOTTOM requires faceUp; BOUND requires a single cards binding. LIFE_TOP/LIFE_BOTTOM can go to HAND/TRASH/DECK_BOTTOM. No life trigger.',
    example: { type: 'MOVE_LIFE', player: 'SELF', from: 'DECK_TOP', to: 'LIFE_TOP', faceUp: false } },
  { category: 'keyword', name: 'DOUBLE_ATTACK', schemaRef: root + 'keyword', requiredParameters: [], parameterSchemas: {},
    description: 'Resolve two sequential points of leader battle damage instead of one.',
    runtimeConstraints: 'Printed or granted. Snapshots damage and Banish at the hit. A battle that starts damage against existing life cannot win from the excess point.',
    example: { type: 'DOUBLE_ATTACK' } }
]) {
  const entry = { ...op, handlerVersion: '1', status: 'implemented', availableIn: [schema],
    optionalParameters: ['id', 'sourceSpan', ...(op.name === 'MOVE_LIFE' ? ['cards', 'faceUp'] : [])] };
  const index = data.operations.findIndex(row => row.category === op.category && row.name === op.name);
  if (index < 0) data.operations.push(entry); else data.operations[index] = entry;
}
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
