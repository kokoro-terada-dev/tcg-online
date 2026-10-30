const fs = require('node:fs'), path = require('node:path');
const { builtinV3Registries, compilerVersionForSchema, v3RegistryHash } = require('../server/dist/test/effects/v3/compiler.js');
const file = path.join(__dirname, '../docs/card-effect-supported-operations.json'), data = JSON.parse(fs.readFileSync(file, 'utf8'));
const schema = '3.0.0-subset.25', r = builtinV3Registries(schema);
const profile = { compilerVersion: compilerVersionForSchema(schema), registryHash: v3RegistryHash(r), registries: Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.manifest()])) };
data.profiles[schema] = profile;
Object.assign(data, { basedOnCommit: '37e17ae', compilerVersion: profile.compilerVersion, registryHash: profile.registryHash, registries: profile.registries });
for (const op of data.operations) if (op.availableIn.includes('3.0.0-subset.24') && !op.availableIn.includes(schema)) op.availableIn.push(schema);
const schemaRef = 'card-effect-move-result.schema.json#/$defs/';
for (const op of [
  { category: 'action', name: 'MOVE_RESULT', requiredParameters: ['bindAs'], parameterSchemas: { bindAs: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_]{0,63}$' } },
    description: 'Bind the immediately preceding successful MOVE_CARD result in this resolution scope. No movement of its own.',
    runtimeConstraints: 'Memory remains server-only and signed. Empty results cannot satisfy MOVED_COLORS. No live following of old refs.', example: { type: 'MOVE_RESULT', bindAs: 'returned' } },
  { category: 'predicate', name: 'MOVED_COLORS', requiredParameters: ['result', 'subject', 'basis', 'match'], parameterSchemas: {
    result: { type: 'string' }, subject: { enum: ['SOURCE', 'CANDIDATE'] }, basis: { enum: ['PRINTED', 'CURRENT'] }, match: { enum: ['OVERLAP', 'DISJOINT'] } },
    description: 'Compare candidate/source colors with the union of remembered pre-move CURRENT colors visible to both players at that time.',
    runtimeConstraints: 'Missing/private/unknown/empty results remain UNKNOWN. Basis selects candidate facts, not the remembered snapshot. Case/width are literal.',
    example: { type: 'MOVED_COLORS', result: 'returned', subject: 'CANDIDATE', basis: 'CURRENT', match: 'DISJOINT' } }
]) {
  const entry = { ...op, handlerVersion: '1', status: 'implemented_limited', availableIn: [schema], schemaRef: schemaRef + op.category, optionalParameters: ['id', 'sourceSpan'] };
  const i = data.operations.findIndex(x => x.category === op.category && x.name === op.name);
  if (i < 0) data.operations.push(entry); else data.operations[i] = entry;
}
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
