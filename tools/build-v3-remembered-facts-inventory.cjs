const fs = require('node:fs'), path = require('node:path');
const { builtinV3Registries, compilerVersionForSchema, v3RegistryHash } = require('../server/dist/test/effects/v3/compiler.js');
const file = path.join(__dirname, '../docs/card-effect-supported-operations.json'), data = JSON.parse(fs.readFileSync(file, 'utf8'));
const schema = '3.0.0-subset.26', registries = builtinV3Registries(schema);
const profile = { compilerVersion: compilerVersionForSchema(schema), registryHash: v3RegistryHash(registries), registries: Object.fromEntries(Object.entries(registries).map(([key, value]) => [key, value.manifest()])) };
data.profiles[schema] = profile;
Object.assign(data, { basedOnCommit: '6f5baf3', compilerVersion: profile.compilerVersion, registryHash: profile.registryHash, registries: profile.registries });
for (const op of data.operations) if (op.availableIn.includes('3.0.0-subset.25') && !op.availableIn.includes(schema)) op.availableIn.push(schema);
for (const op of [
  { category: 'action', name: 'REMEMBER_FACTS', requiredParameters: ['result', 'cards', 'snapshot', 'basis', 'field', 'bindAs'], parameterSchemas: {
    result: { type: 'string' }, cards: { oneOf: [{ type: 'null' }, { type: 'object', required: ['ref'], additionalProperties: false, properties: { ref: { type: 'string', pattern: '^bindings\\.[A-Za-z][A-Za-z0-9_]{0,63}$' } } }] },
    snapshot: { enum: ['BEFORE', 'AFTER'] }, basis: { enum: ['PRINTED', 'CURRENT'] }, field: { const: 'colors' }, bindAs: { type: 'string' } },
    description: 'Remember public colors from a selected movement snapshot and basis, optionally restricting rows by exact original refs.',
    runtimeConstraints: 'Same signed resolution only. No arbitrary facts, card tracking, private values, index-based row selection or effect play.',
    example: { type: 'REMEMBER_FACTS', result: 'returned', cards: null, snapshot: 'BEFORE', basis: 'CURRENT', field: 'colors', bindAs: 'returnedColors' } },
  { category: 'predicate', name: 'REMEMBERED_COLORS', requiredParameters: ['memory', 'subject', 'basis', 'match'], parameterSchemas: {
    memory: { type: 'string' }, subject: { enum: ['SOURCE', 'CANDIDATE'] }, basis: { enum: ['PRINTED', 'CURRENT'] }, match: { enum: ['OVERLAP', 'DISJOINT'] } },
    description: 'Compare currently authorized candidate/source color facts against the union of remembered colors.',
    runtimeConstraints: 'Missing, empty, private or unknown memory remains UNKNOWN; basis controls the live comparison card only.',
    example: { type: 'REMEMBERED_COLORS', memory: 'returnedColors', subject: 'CANDIDATE', basis: 'CURRENT', match: 'DISJOINT' } }
]) {
  const entry = { ...op, handlerVersion: '1', status: 'implemented_limited', availableIn: [schema], optionalParameters: ['id', 'sourceSpan'], schemaRef: `card-effect-remembered-facts.schema.json#/$defs/${op.category}` };
  const index = data.operations.findIndex(existing => existing.category === op.category && existing.name === op.name);
  if (index < 0) data.operations.push(entry); else data.operations[index] = entry;
}
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
