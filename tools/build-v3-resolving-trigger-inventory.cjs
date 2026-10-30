const fs = require('node:fs'), path = require('node:path');
const { builtinV3Registries, compilerVersionForSchema, v3RegistryHash } = require('../server/dist/test/effects/v3/compiler.js');
const file = path.join(__dirname, '../docs/card-effect-supported-operations.json'), data = JSON.parse(fs.readFileSync(file, 'utf8'));
const schema = '3.0.0-subset.22', r = builtinV3Registries(schema);
const profile = { compilerVersion: compilerVersionForSchema(schema), registryHash: v3RegistryHash(r), registries: Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.manifest()])) };
data.profiles[schema] = profile;
Object.assign(data, { basedOnCommit: 'faa66c6', compilerVersion: profile.compilerVersion, registryHash: profile.registryHash, registries: profile.registries });
for (const op of data.operations) if (op.availableIn.includes('3.0.0-subset.21') && op.name !== 'ON_EVENT' && !op.availableIn.includes(schema)) op.availableIn.push(schema);
const old = data.operations.find(op => op.name === 'ON_EVENT' && op.handlerVersion === 'candidate.1');
const entry = { ...structuredClone(old), handlerVersion: '1', status: 'implemented_limited', availableIn: [schema],
  schemaRef: 'card-effect-resolving-trigger.schema.json#/$defs/timing', description: 'Resolve reviewed, known occurrence candidates through the shared ordered trigger queue and Runtime.',
  runtimeConstraints: 'Occurrence proof is server-owned. Unknown facts, stale sources, ambiguous multi-moves, private queries and non-MAIN phase boundaries remain held.' };
const index = data.operations.findIndex(op => op.name === 'ON_EVENT' && op.handlerVersion === '1');
if (index < 0) data.operations.push(entry); else data.operations[index] = entry;
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
