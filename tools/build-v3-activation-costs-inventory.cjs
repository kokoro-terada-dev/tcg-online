const fs = require('node:fs'), path = require('node:path');
const { builtinV3Registries, compilerVersionForSchema, v3RegistryHash } = require('../server/dist/test/effects/v3/compiler.js');
const file = path.join(__dirname, '../docs/card-effect-supported-operations.json'), data = JSON.parse(fs.readFileSync(file, 'utf8'));
const schema = '3.0.0-subset.30', previous = '3.0.0-subset.29', registries = builtinV3Registries(schema);
const profile = { compilerVersion: compilerVersionForSchema(schema), registryHash: v3RegistryHash(registries), registries: Object.fromEntries(Object.entries(registries).map(([k, v]) => [k, v.manifest()])) };
data.profiles[schema] = profile;
Object.assign(data, { basedOnCommit: '62b3811', compilerVersion: profile.compilerVersion, registryHash: profile.registryHash, registries: profile.registries });
for (const op of data.operations) if (op.availableIn.includes(previous) && !op.availableIn.includes(schema)) op.availableIn.push(schema);
const handSchema = { $ref: 'card-effect-activation-costs.schema.json#/$defs/activationHandCostSelector' };
const hand = { type: 'CARDS', owner: 'SELF', controller: 'SELF', chooser: 'SELF', zone: 'hand', cardTypes: ['event'],
  filters: { type: 'all', conditions: [] }, excludeSource: false, faceUpOnly: false, min: 1, max: 1,
  visibility: 'OWNER_ONLY', selectionMode: 'SELECT', order: 'UNORDERED', onInsufficient: 'fail' };
for (const entry of [
  { name: 'REVEAL_CARDS', requiredParameters: ['selector'], parameterSchemas: { selector: handSchema },
    description: 'Reveal exactly the selected own hand cards to both players for this resolution.', example: { type: 'REVEAL_CARDS', selector: hand } },
  { name: 'MOVE_AS_COST', requiredParameters: ['selector', 'destination'], parameterSchemas: { selector: { oneOf: [{ const: 'SOURCE' }, handSchema] }, destination: { const: 'trash' } },
    description: 'Trash the public own character/stage source or exactly the selected own hand cards as an activation cost.',
    example: { type: 'MOVE_AS_COST', selector: 'SOURCE', destination: 'trash' } }
]) {
  const op = { category: 'cost', handlerVersion: '1', status: 'implemented_limited', ...entry, availableIn: [schema],
    optionalParameters: ['id', 'sourceSpan'], schemaRef: 'card-effect-activation-costs.schema.json#/$defs/cost',
    runtimeConstraints: 'One filtered hand cost per effect; min equals max and is positive. Pay compound costs atomically before resolving actions.' };
  const i = data.operations.findIndex(x => x.category === op.category && x.name === op.name && x.handlerVersion === op.handlerVersion);
  if (i < 0) data.operations.push(op); else data.operations[i] = op;
}
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
