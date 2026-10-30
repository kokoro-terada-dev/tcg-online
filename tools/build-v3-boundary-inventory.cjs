const fs = require('node:fs'), path = require('node:path');
const { builtinV3Registries, compilerVersionForSchema, v3RegistryHash } = require('../server/dist/test/effects/v3/compiler.js');
const file = path.join(__dirname, '../docs/card-effect-supported-operations.json'), data = JSON.parse(fs.readFileSync(file, 'utf8'));
const schema = '3.0.0-subset.23', r = builtinV3Registries(schema);
const profile = { compilerVersion: compilerVersionForSchema(schema), registryHash: v3RegistryHash(r), registries: Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.manifest()])) };
data.profiles[schema] = profile;
Object.assign(data, { basedOnCommit: '7cae9b7', compilerVersion: profile.compilerVersion, registryHash: profile.registryHash, registries: profile.registries });
for (const op of data.operations) if (op.availableIn.includes('3.0.0-subset.22') && !op.availableIn.includes(schema)) op.availableIn.push(schema);
for (const name of ['ON_BLOCK', 'MAIN_START', 'TURN_END']) {
  const entry = { category: 'timing', name, handlerVersion: '1', status: 'implemented_limited', availableIn: [schema],
    schemaRef: 'card-effect-boundary.schema.json#/$defs/timing', requiredParameters: name === 'ON_BLOCK' ? [] : ['player'], optionalParameters: ['id', 'sourceSpan'],
    parameterSchemas: name === 'ON_BLOCK' ? {} : { player: { enum: ['SELF', 'OPPONENT'] } },
    description: name === 'ON_BLOCK' ? 'Only an acknowledged block, before entering counter step.' : name === 'MAIN_START' ? 'Main phase entry, before manual MAIN actions.' : 'End-phase entry, before existing cleanup.',
    runtimeConstraints: 'Server occurrence proof and common queue/frame; UNKNOWN/stale refs remain held. No new duration nodes.', example: { type: name, ...(name === 'ON_BLOCK' ? {} : { player: 'SELF' }) } };
  const i = data.operations.findIndex(op => op.category === 'timing' && op.name === name);
  if (i < 0) data.operations.push(entry); else data.operations[i] = entry;
}
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
