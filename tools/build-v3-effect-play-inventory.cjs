const fs = require('node:fs'), path = require('node:path');
const { builtinV3Registries, compilerVersionForSchema, v3RegistryHash } = require('../server/dist/test/effects/v3/compiler.js');
const file = path.join(__dirname, '../docs/card-effect-supported-operations.json'), data = JSON.parse(fs.readFileSync(file, 'utf8'));
const schema = '3.0.0-subset.27', registries = builtinV3Registries(schema);
const profile = { compilerVersion: compilerVersionForSchema(schema), registryHash: v3RegistryHash(registries), registries: Object.fromEntries(Object.entries(registries).map(([k, v]) => [k, v.manifest()])) };
data.profiles[schema] = profile;
Object.assign(data, { basedOnCommit: 'e1ebf0c', compilerVersion: profile.compilerVersion, registryHash: profile.registryHash, registries: profile.registries });
for (const op of data.operations) if (op.availableIn.includes('3.0.0-subset.26') && !op.availableIn.includes(schema)) op.availableIn.push(schema);
const op = { category: 'action', name: 'PLAY_BY_EFFECT', handlerVersion: '1', status: 'implemented_limited', availableIn: [schema], schemaRef: 'card-effect-effect-play.schema.json#/$defs/action',
  requiredParameters: ['cards', 'from', 'destination', 'enterState', 'provenance', 'condition'], optionalParameters: ['id', 'sourceSpan'], parameterSchemas: {
    cards: { type: 'object', required: ['ref'], additionalProperties: false, properties: { ref: { type: 'string', pattern: '^bindings\\.[A-Za-z][A-Za-z0-9_]{0,63}$' } } },
    from: { const: 'hand' }, destination: { type: 'object', additionalProperties: false, required: ['owner', 'zone', 'slotPolicy'], properties: { owner: { const: 'SELF' }, zone: { const: 'character' }, slotPolicy: { const: 'FIRST_EMPTY' } } },
    enterState: { enum: ['ACTIVE', 'REST'] }, provenance: { const: 'EFFECT' }, condition: { $ref: 'card-effect-effect-play.schema.json#/$defs/predicate' } },
  description: 'Play up to five selected characters from own hand by effect through the existing movement transaction and trigger queue.',
  runtimeConstraints: 'Known approved character definitions; exact current refs and authorized owner/controller. Explicit empty-slot policy only, all-or-nothing. No printed DON payment. Condition checked before work at its pinned revision. No deck/life play or replacement.',
  example: { type: 'PLAY_BY_EFFECT', cards: { ref: 'bindings.chosen' }, from: 'hand', destination: { owner: 'SELF', zone: 'character', slotPolicy: 'FIRST_EMPTY' }, enterState: 'ACTIVE', provenance: 'EFFECT', condition: { type: 'all', conditions: [] } } };
const index = data.operations.findIndex(x => x.category === op.category && x.name === op.name);
if (index < 0) data.operations.push(op); else data.operations[index] = op;
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
