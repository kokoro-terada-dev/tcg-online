import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const { compileV3CardJson } = createRequire(import.meta.url)("../server/dist/test/effects/v3/compiler.js");
try {
  if (process.argv.length !== 3) throw new Error("Usage: npm run check:effect-v3 -- <card-definition.json>");
  const file = path.resolve(process.argv[2]);
  if (fs.statSync(file).size > 262144) throw new Error("V3 document exceeds 256 KiB");
  const plan = compileV3CardJson(new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(file)));
  console.log(JSON.stringify({ status: plan.status, cardId: plan.definition.cardId, cardVersion: plan.definition.cardVersion,
    compilerVersion: plan.compilerVersion, registryHash: plan.registryHash, sourceHash: plan.sourceHash, definitionHash: plan.definitionHash,
    requiredHandlers: plan.requiredHandlers, executable: false }, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
