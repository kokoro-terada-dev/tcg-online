import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function modePaymentSchema(base) {
  const s = structuredClone(base);
  s.$id = "urn:tcg:effect-v3-subset:31";
  s.title = "V3 subset 31: mode selection and optional in-effect payments";
  s.properties.schemaVersion.const = "3.0.0-subset.31";
  const actions = { type: "array", maxItems: 128, items: { $ref: "#/$defs/action" } };
  const paymentName = { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_.:-]*$", maxLength: 64, not: { enum: ["constructor", "prototype"] } };
  s.$defs.effectMode = { type: "object", additionalProperties: false, required: ["label", "actions"], properties: {
    label: { type: "string", minLength: 1, maxLength: 80, pattern: "^(?!\\s)(?!.*[\\x00-\\x1f\\x7f]).*\\S$" },
    actions: { ...actions, minItems: 1 }
  } };
  for (const [type, properties] of [
    ["CHOOSE_MODE", { modes: { type: "array", minItems: 2, maxItems: 8, items: { $ref: "#/$defs/effectMode" } } }],
    ["OFFER_PAYMENT", { costs: { type: "array", minItems: 1, maxItems: 128, items: { $ref: "#/$defs/cost" } }, bindAs: paymentName }],
    ["IF_PAYMENT_SUCCEEDED", { payment: paymentName, then: actions, else: actions }]
  ]) s.$defs.action.oneOf.push({
    allOf: [{ $ref: "#/$defs/meta" }], unevaluatedProperties: false,
    required: Object.keys(properties), properties: { type: { const: type }, ...properties },
    $comment: "Mode labels, scoped payment names and cost combinations are also validated by the Compiler."
  });
  return s;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some(arg => arg !== "--check")) throw Error("Only --check is supported");
  const root = new URL("../", import.meta.url);
  const base = JSON.parse(fs.readFileSync(new URL("schemas/effect-v3-subset30.schema.json", root), "utf8"));
  const output = JSON.stringify(modePaymentSchema(base), null, 2) + "\n";
  for (const file of ["schemas/effect-v3-subset31.schema.json", "docs/card-effect-mode-payment.schema.json"]) {
    const target = new URL(file, root);
    if (process.argv.includes("--check")) {
      if (fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n") !== output) throw Error(`Outdated generated schema: ${file}`);
    } else fs.writeFileSync(target, output);
  }
}
