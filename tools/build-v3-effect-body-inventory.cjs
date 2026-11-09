const fs = require('node:fs'), path = require('node:path');
const { builtinV3Registries, compilerVersionForSchema, v3RegistryHash } = require('../server/dist/test/effects/v3/compiler.js');
const file = path.join(__dirname, '../docs/card-effect-supported-operations.json'), data = JSON.parse(fs.readFileSync(file, 'utf8'));
const schema = '3.0.0-subset.40', previous = '3.0.0-subset.39', registries = builtinV3Registries(schema);
const profile = { compilerVersion: compilerVersionForSchema(schema), registryHash: v3RegistryHash(registries), registries: Object.fromEntries(Object.entries(registries).map(([k, v]) => [k, v.manifest()])) };
data.profiles[schema] = profile;
Object.assign(data, { basedOnCommit: 'e6b9b21', compilerVersion: profile.compilerVersion, registryHash: profile.registryHash, registries: profile.registries });
for (const op of data.operations) if (op.availableIn.includes(previous) && !op.availableIn.includes(schema)) op.availableIn.push(schema);
const schemaRef = 'card-effect-body.schema.json#/$defs/effectBodyCall';
const op = { category: 'action', name: 'CALL_EFFECT_BODY', handlerVersion: '1', status: 'implemented', availableIn: [schema], schemaRef,
  requiredParameters: ['effectId'], optionalParameters: ['id', 'sourceSpan'],
  parameterSchemas: { effectId: { $ref: schemaRef + '/properties/effectId' } },
  description: 'Runs the same approved Event card’s MAIN action body inside its life TRIGGER, without playing the Event or paying its printed cost.',
  runtimeConstraints: 'Sole top-level TRIGGER action; references a MAIN id in the same signed definition. Existing supported MAIN bodies only; no shared usage, recursive, cross-card, or activation-cost calls.',
  example: { type: 'CALL_EFFECT_BODY', effectId: 'main' } };
const index = data.operations.findIndex(row => row.category === op.category && row.name === op.name);
if (index < 0) data.operations.push(op); else data.operations[index] = op;
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
