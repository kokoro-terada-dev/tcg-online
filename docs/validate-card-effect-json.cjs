// Documentation-side checker only. Never creates trusted approvals or changes the engine.
const fs = require('node:fs');
const path = require('node:path');
const { compileV3CardJson, COMPILER_VERSION, builtinV3Registries, v3RegistryHash } = require('../server/dist/test/effects/v3/compiler.js');

function main() {
  const args = process.argv.slice(2), files = [], definitions = [], unsupported = [], results = [];
  let schema = false, sourceReview = null, examples = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--schema') schema = true;
    else if (args[i] === '--examples') examples = true;
    else if (args[i] === '--source-review') {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw Error('--source-review requires a review bundle path');
      sourceReview = args[++i];
    } else if (args[i].startsWith('--')) throw Error(`Unknown option: ${args[i]}`);
    else files.push(args[i]);
  }
  if (!files.length) throw Error('Usage: node docs/validate-card-effect-json.cjs [--schema] [--examples] [--source-review review.json] <files/directories...>');
  let validate = null;
  if (schema) {
    let Ajv;
    try { Ajv = require('ajv/dist/2020'); }
    catch { throw Error('Schema validation requires Ajv 8 (ajv/dist/2020). Install in a separate temporary directory and set NODE_PATH; see guide. No fallback to Draft 7.'); }
    const ajv = new Ajv({ allErrors: true, strict: false });
    validate = ajv.compile(JSON.parse(fs.readFileSync(path.join(__dirname, 'card-effect-json-schema.json'), 'utf8')));
  }
  const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
  let sourceCards = null;
  if (sourceReview) {
    const review = readJson(sourceReview);
    const { validateReviewBundle } = require('../server/dist/test/effects/v3/cardData.js');
    sourceCards = new Map(validateReviewBundle(review).cards.map(card => [card.cardId, card]));
  }
  function collect(input) {
    const file = path.resolve(input), stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) throw Error(`Symlink input rejected: ${file}`);
    if (stat.isDirectory()) {
      for (const item of fs.readdirSync(file, { withFileTypes: true })) {
        if (item.isSymbolicLink()) throw Error(`Symlink input rejected: ${path.join(file, item.name)}`);
        if (item.isDirectory() || item.name.endsWith('.json')) collect(path.join(file, item.name));
      }
      return;
    }
    try {
      if (!stat.isFile() || stat.size > (examples ? 4 * 1024 * 1024 : 262144)) throw Error('Input file is not regular or exceeds size limit');
      const data = readJson(file);
      if (!examples) definitions.push({ file, card: data });
      else {
        if (!Array.isArray(data.examples)) throw Error('--examples expects the documentation example index');
        for (const entry of [...data.examples, ...(data.additionalExamples || [])]) {
          if (entry.status === 'unsupported') { unsupported.push({ file, requestNumber: entry.requestNumber, title: entry.title, reason: entry.reason }); continue; }
          if (!entry.card) throw Error('Non-unsupported example has no card');
          definitions.push({ file: `${file}#${entry.requestNumber ?? entry.title}`, card: entry.card });
        }
      }
    } catch (error) { results.push({ file, status: 'invalid_json_or_input', error: error.message }); }
  }
  files.forEach(collect);
  const ids = new Set();
  for (const { file, card } of definitions) {
    try {
      const structuralErrors = validate && !validate(card) ? structuredClone(validate.errors) : null;
      const plan = compileV3CardJson(JSON.stringify(card));
      if (structuralErrors) { results.push({ file, status: 'schema_error', errors: structuralErrors }); continue; }
      if (ids.has(plan.definition.cardId)) throw Error(`Duplicate cardId in batch: ${plan.definition.cardId}`);
      ids.add(plan.definition.cardId);
      if (sourceCards && !sourceCards.has(plan.definition.cardId)) throw Error(`cardId missing from source review: ${plan.definition.cardId}`);
      results.push({ file, cardId: plan.definition.cardId, status: plan.status, executable: false, requiredHandlers: plan.requiredHandlers });
    } catch (error) { results.push({ file, status: 'compiler_or_catalog_error', error: error.message }); }
  }
  const failures = results.filter(result => result.status !== 'compiled_not_executable');
  console.log(JSON.stringify({ compilerVersion: COMPILER_VERSION, registryHash: v3RegistryHash(builtinV3Registries()),
    schemaValidation: validate ? 'performed' : 'not_performed', sourceCardExistenceCheck: sourceCards ? 'performed' : 'not_performed',
    semanticRulesAndRuntimeApproval: 'not_performed', count: results.length, failures: failures.length, unsupported, results }, null, 2));
  if (failures.length || !definitions.length) process.exitCode = 1;
}
try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
