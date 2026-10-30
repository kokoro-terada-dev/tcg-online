// Documentation inventory only; never reads or rewrites approval manifests.
const fs = require('node:fs');
const { builtinV3Registries, compilerVersionForSchema, v3RegistryHash } = require('../server/dist/test/effects/v3/compiler.js');
const schema = '3.0.0-subset.21', file = require('node:path').join(__dirname, '../docs/card-effect-supported-operations.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8')), registries = builtinV3Registries(schema);
const profile = { compilerVersion: compilerVersionForSchema(schema), registryHash: v3RegistryHash(registries),
  registries: Object.fromEntries(Object.entries(registries).map(([category, registry]) => [category, registry.manifest()])) };
Object.assign(data, { basedOnCommit: 'fe6e037', compilerVersion: profile.compilerVersion, registryHash: profile.registryHash, registries: profile.registries });
data.profiles[schema] = profile;
for (const op of data.operations) if (op.availableIn.includes('3.0.0-subset.20') && !op.availableIn.includes(schema)) op.availableIn.push(schema);
const example = JSON.parse(fs.readFileSync(require('node:path').join(__dirname, '../docs/card-effect-conditional-trigger-examples.json'), 'utf8')).examples[0].card.effects[0];
const definitions = JSON.parse(fs.readFileSync(require('node:path').join(__dirname, '../schemas/effect-v3-subset21.schema.json'), 'utf8')).$defs;
for (const [category, name, node, description] of [
  ['predicate', 'TURN_IS', example.activationConditions, 'Turn player relative to effect controller; shared three-valued predicate evaluator.'],
  ['timing', 'ON_EVENT', example.timing, 'Candidate detection only. TRUE/UNKNOWN are HELD; not executable until PR06b.']
]) {
  const shape = category === 'timing' ? definitions.timing.oneOf[1] : definitions.predicate.oneOf.find(row => row.properties?.type?.const === name);
  const op = { category, name, handlerVersion: category === 'timing' ? 'candidate.1' : '1',
    status: category === 'timing' ? 'candidate_detection_only' : 'implemented_limited', schemaRef: `card-effect-conditional-trigger.schema.json#/$defs/${category}`,
    requiredParameters: shape.required, optionalParameters: ['id', 'sourceSpan'], parameterSchemas: Object.fromEntries(Object.entries(shape.properties).filter(([key]) => key !== 'type')),
    description, runtimeConstraints: 'Server-only occurrence evidence; no hidden candidate DTO. Transaction boundary snapshots; multi-move timing remains UNKNOWN.', example: node, availableIn: [schema] };
  const at = data.operations.findIndex(item => item.category === category && item.name === name);
  if (at < 0) data.operations.push(op); else data.operations[at] = op;
}
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
