const fs = require('node:fs'), path = require('node:path');
const { builtinV3Registries, compilerVersionForSchema, v3RegistryHash } = require('../server/dist/test/effects/v3/compiler.js');
const file = path.join(__dirname, '../docs/card-effect-supported-operations.json'), data = JSON.parse(fs.readFileSync(file, 'utf8'));
const schema = '3.0.0-subset.41', previous = '3.0.0-subset.40', registries = builtinV3Registries(schema);
const profile = { compilerVersion: compilerVersionForSchema(schema), registryHash: v3RegistryHash(registries), registries: Object.fromEntries(Object.entries(registries).map(([k, v]) => [k, v.manifest()])) };
data.profiles[schema] = profile;
Object.assign(data, { basedOnCommit: 'e9b567e', compilerVersion: profile.compilerVersion, registryHash: profile.registryHash, registries: profile.registries });
for (const op of data.operations) if (op.name !== 'CALL_EFFECT_BODY' && op.availableIn.includes(previous) && !op.availableIn.includes(schema)) op.availableIn.push(schema);
const fileName = 'card-effect-external-body.schema.json';
const schemaRef = fileName + '#/$defs/externalBodyCall';
const op = { category: 'action', name: 'CALL_EFFECT_BODY', handlerVersion: '2', status: 'implemented', availableIn: [schema],
  schemaRef, schemaRefs: [fileName + '#/$defs/effectBodyCall', schemaRef], requiredParameters: [],
  optionalParameters: ['id', 'sourceSpan'],
  parameterSchemas: { effectId: { $ref: fileName + '#/$defs/effectBodyCall/properties/effectId' },
    from: { $ref: schemaRef + '/properties/from' }, maxPrintedCost: { $ref: schemaRef + '/properties/maxPrintedCost' } },
  description: 'Inherits same-card TRIGGER calls and adds MAIN body calls from an approved Event in the controller’s own trash.',
  runtimeConstraints: 'Requires effectId for same-card calls or from/maxPrintedCost for trash calls. Sole action of a supported field MAIN/On Play or self-entry observer for trash calls. Body only, no printed payment or move. One declared per-object MAIN use shares the normal MAIN ledger.',
  example: { type: 'CALL_EFFECT_BODY', from: 'OWN_TRASH', maxPrintedCost: 7 } };
const index = data.operations.findIndex(row => row.name === op.name && row.handlerVersion === op.handlerVersion);
if (index < 0) data.operations.push(op); else data.operations[index] = op;
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
