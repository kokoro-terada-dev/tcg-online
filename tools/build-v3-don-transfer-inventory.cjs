const fs = require('node:fs'), path = require('node:path');
const { builtinV3Registries, compilerVersionForSchema, v3RegistryHash } = require('../server/dist/test/effects/v3/compiler.js');
const file = path.join(__dirname, '../docs/card-effect-supported-operations.json'), data = JSON.parse(fs.readFileSync(file, 'utf8'));
const schema = '3.0.0-subset.29', previous = '3.0.0-subset.28', registries = builtinV3Registries(schema);
const profile = { compilerVersion: compilerVersionForSchema(schema), registryHash: v3RegistryHash(registries), registries: Object.fromEntries(Object.entries(registries).map(([k, v]) => [k, v.manifest()])) };
data.profiles[schema] = profile;
Object.assign(data, { basedOnCommit: 'dc63404', compilerVersion: profile.compilerVersion, registryHash: profile.registryHash, registries: profile.registries });
for (const op of data.operations) if (op.availableIn.includes(previous) && op.name !== 'ON_EVENT' && !op.availableIn.includes(schema)) op.availableIn.push(schema);
const observed = data.operations.find(op => op.name === 'ON_EVENT' && op.availableIn.includes(previous));
const ref = { $ref: 'card-effect-don-transfer.schema.json#/$defs/cardSetRef' };
for (const entry of [
  { name: 'ATTACH_DON', category: 'action', handlerVersion: '1', requiredParameters: ['from', 'assignments'], parameterSchemas: { from: { enum: ['ACTIVE', 'REST'] }, assignments: { type: 'array', minItems: 1, maxItems: 10, items: { type: 'object', required: ['cards', 'target'], additionalProperties: false, properties: { cards: ref, target: ref } } } },
    description: 'Attach selected own active or rested DON to explicit own field targets in one transaction.', runtimeConstraints: 'Distinct DON refs, one target per assignment, no partial application.',
    example: { type: 'ATTACH_DON', from: 'REST', assignments: [{ cards: { ref: 'bindings.don' }, target: { ref: 'bindings.target' } }] } },
  { name: 'RETURN_DON_BY_EFFECT', category: 'action', handlerVersion: '1', requiredParameters: ['cards', 'from'], parameterSchemas: { cards: ref, from: { type: 'array', minItems: 1, maxItems: 3, uniqueItems: true, items: { enum: ['activeDon', 'restDon', 'attachedDon'] } } },
    description: 'Return selected own DON to the bottom of the DON deck as an effect.', runtimeConstraints: 'Distinct DON refs; effect provenance, never DON minus cost.',
    example: { type: 'RETURN_DON_BY_EFFECT', cards: { ref: 'bindings.don' }, from: ['activeDon', 'restDon', 'attachedDon'] } },
  { ...observed, handlerVersion: '2', requiredParameters: ['event', 'owner'], parameterSchemas: {
      ...observed.parameterSchemas, event: { enum: ['CARD_ENTERED', 'CARD_KO', 'CARD_MOVED', 'DON_RETURNED'] },
      cause: { enum: ['EFFECT_MOVE', 'COST_PAYMENT', 'ANY'] }, min: { type: 'integer', minimum: 1, maximum: 10 } },
    description: 'Legacy movement observers plus explicitly scoped DON return-batch observers.',
    runtimeConstraints: 'Legacy event form unchanged. DON_RETURNED requires owner, cause and min. One candidate per matching observer and committed return batch.',
    variants: [{ events: ['CARD_ENTERED', 'CARD_KO', 'CARD_MOVED'], requiredParameters: observed.requiredParameters },
      { events: ['DON_RETURNED'], requiredParameters: ['event', 'owner', 'cause', 'min'], parameterSchemas: { event: { const: 'DON_RETURNED' }, owner: { enum: ['SELF', 'OPPONENT'] }, cause: { enum: ['EFFECT_MOVE', 'COST_PAYMENT', 'ANY'] }, min: { type: 'integer', minimum: 1, maximum: 10 } } }],
    example: { type: 'ON_EVENT', event: 'DON_RETURNED', owner: 'SELF', cause: 'EFFECT_MOVE', min: 1 } }
]) {
  const op = { status: 'implemented_limited', ...entry, availableIn: [schema], optionalParameters: ['id', 'sourceSpan'], schemaRef: `card-effect-don-transfer.schema.json#/$defs/${entry.category}` };
  const i = data.operations.findIndex(x => x.category === op.category && x.name === op.name && x.handlerVersion === op.handlerVersion);
  if (i < 0) data.operations.push(op); else data.operations[i] = op;
}
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
