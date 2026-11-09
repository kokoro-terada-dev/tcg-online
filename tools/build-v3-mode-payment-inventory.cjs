const fs = require('node:fs'), path = require('node:path');
const { builtinV3Registries, compilerVersionForSchema, v3RegistryHash } = require('../server/dist/test/effects/v3/compiler.js');
const file = path.join(__dirname, '../docs/card-effect-supported-operations.json'), data = JSON.parse(fs.readFileSync(file, 'utf8'));
const schema = '3.0.0-subset.31', previous = '3.0.0-subset.30', registries = builtinV3Registries(schema);
const profile = { compilerVersion: compilerVersionForSchema(schema), registryHash: v3RegistryHash(registries), registries: Object.fromEntries(Object.entries(registries).map(([k, v]) => [k, v.manifest()])) };
data.profiles[schema] = profile;
Object.assign(data, { basedOnCommit: 'b293873', compilerVersion: profile.compilerVersion, registryHash: profile.registryHash, registries: profile.registries });
for (const op of data.operations) if (op.availableIn.includes(previous) && !op.availableIn.includes(schema)) op.availableIn.push(schema);
const draw = count => ({ type: 'DRAW', player: 'SELF', count });
const schemaFile = 'card-effect-mode-payment.schema.json', actionList = { type: 'array', items: { $ref: schemaFile + '#/$defs/action' } };
const name = { type: 'string', maxLength: 64, pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]*$' };
for (const entry of [
  { name: 'CHOOSE_MODE', requiredParameters: ['modes'], parameterSchemas: { modes: { type: 'array', minItems: 2, maxItems: 8, items: { $ref: schemaFile + '#/$defs/effectMode' } } },
    description: 'The effect controller selects exactly one mode and resolves only its scoped action list.',
    runtimeConstraints: 'Unique nonblank mode labels; no skip or automatic selection.',
    example: { type: 'CHOOSE_MODE', modes: [{ label: '1枚引く', actions: [draw(1)] }, { label: '2枚引く', actions: [draw(2)] }] } },
  { name: 'OFFER_PAYMENT', requiredParameters: ['costs', 'bindAs'], parameterSchemas: { costs: { type: 'array', minItems: 1, items: { $ref: schemaFile + '#/$defs/cost' } }, bindAs: name },
    description: 'Offer the effect controller an atomic optional payment at this step; record whether it committed.',
    runtimeConstraints: 'Uses the shared payment planner. Decline or proven shortage records false; UNKNOWN is not false.',
    example: { type: 'OFFER_PAYMENT', costs: [{ type: 'REST_DON', count: 1 }], bindAs: 'extra' } },
  { name: 'IF_PAYMENT_SUCCEEDED', requiredParameters: ['payment', 'then', 'else'], parameterSchemas: { payment: name, then: actionList, else: actionList },
    description: 'Branch on an earlier in-scope optional payment result, without refunding it.',
    runtimeConstraints: 'Requires an earlier OFFER_PAYMENT in scope. Both branch action arrays may be empty.',
    example: { type: 'IF_PAYMENT_SUCCEEDED', payment: 'extra', then: [draw(1)], else: [] } }
]) {
  const op = { category: 'action', handlerVersion: '1', status: 'implemented_limited', ...entry, availableIn: [schema],
    optionalParameters: ['id', 'sourceSpan'], schemaRef: schemaFile + '#/$defs/action' };
  const i = data.operations.findIndex(x => x.category === op.category && x.name === op.name && x.handlerVersion === op.handlerVersion);
  if (i < 0) data.operations.push(op); else data.operations[i] = op;
}
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
