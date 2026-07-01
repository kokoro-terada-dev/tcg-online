import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const rootDir = process.cwd();
const inputPath = path.join(rootDir, "local-data", "card-master.csv");
const outputPath = path.join(rootDir, "public", "card-master.json");

const VALID_TYPES = new Set([
  "leader",
  "character",
  "event",
  "stage",
  "don",
  "unknown",
]);

const VALID_EFFECTS = new Set([
  "onPlay",
  "onAttack",
  "onKo",
]);

function normalizeEffects(value, lineNumber, warnings) {
  const normalized = value.trim();

  if (!normalized) {
    return [];
  }

  const effects = normalized
    .split("|")
    .map((effect) => effect.trim())
    .filter((effect) => effect.length > 0);

  const validEffects = [];

  for (const effect of effects) {
    if (VALID_EFFECTS.has(effect)) {
      validEffects.push(effect);
      continue;
    }

    warnings.push(
      `WARN line ${lineNumber}: invalid effect "${effect}", ignored`
    );
  }

  return validEffects;
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      current += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current);

  return values.map((value) => value.trim());
}

function normalizeType(value, lineNumber, warnings) {
  const normalized = value.trim().toLowerCase();

  if (!normalized) {
    return "unknown";
  }

  if (VALID_TYPES.has(normalized)) {
    return normalized;
  }

  warnings.push(
    `WARN line ${lineNumber}: invalid type "${value}", fallback to unknown`
  );

  return "unknown";
}

function normalizeNumber(value, fieldName, lineNumber, warnings) {
  const normalized = value.trim();

  if (!normalized) {
    return null;
  }

  const numberValue = Number(normalized);

  if (!Number.isFinite(numberValue)) {
    warnings.push(
      `WARN line ${lineNumber}: ${fieldName} is not a number, fallback to null`
    );
    return null;
  }

  return numberValue;
}

function main() {
  if (!fs.existsSync(inputPath)) {
    console.error(`ERROR: CSV not found: ${inputPath}`);
    console.error("Put your spreadsheet CSV at local-data/card-master.csv");
    process.exit(1);
  }

  const rawCsv = fs.readFileSync(inputPath, "utf8").replace(/^\uFEFF/, "");
  const lines = rawCsv
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    console.error("ERROR: CSV is empty.");
    process.exit(1);
  }

  const headers = parseCsvLine(lines[0]).map((header) =>
    header.trim().toLowerCase()
  );
  const requiredHeaders = ["id", "type", "cost", "power", "counter", "effects"];
  const missingHeaders = requiredHeaders.filter(
    (header) => !headers.includes(header)
  );

  if (missingHeaders.length > 0) {
    console.error(
      `ERROR: missing required header(s): ${missingHeaders.join(", ")}`
    );
    console.error("Required header: id,type,cost,power,counter");
    process.exit(1);
  }

  const indexByHeader = Object.fromEntries(
    headers.map((header, index) => [header, index])
  );
  const cards = {};
  const errors = [];
  const warnings = [];

  for (let i = 1; i < lines.length; i += 1) {
    const lineNumber = i + 1;
    const values = parseCsvLine(lines[i]);
    const id = (values[indexByHeader.id] ?? "").trim();

    if (!id) {
      errors.push(`ERROR line ${lineNumber}: id is required`);
      continue;
    }

    if (cards[id]) {
      errors.push(`ERROR line ${lineNumber}: duplicate id "${id}"`);
      continue;
    }
    const rawEffects = values[indexByHeader.effects] ?? "";
    const rawType = values[indexByHeader.type] ?? "";
    const rawCost = values[indexByHeader.cost] ?? "";
    const rawPower = values[indexByHeader.power] ?? "";
    const rawCounter = values[indexByHeader.counter] ?? "";

    cards[id] = {
      type: normalizeType(rawType, lineNumber, warnings),
      cost: normalizeNumber(rawCost, "cost", lineNumber, warnings),
      power: normalizeNumber(rawPower, "power", lineNumber, warnings),
      counter: normalizeNumber(rawCounter, "counter", lineNumber, warnings),
      effects: normalizeEffects(rawEffects, lineNumber, warnings),
    };
  }

  if (errors.length > 0) {
    console.error("card-master.csv has errors.");
    for (const error of errors) {
      console.error(error);
    }
    process.exit(1);
  }

  const output = {
    version: 1,
    cards,
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(
    outputPath,
    `${JSON.stringify(output, null, 2)}\n`,
    "utf8"
  );

  console.log("card-master.csv loaded");
  console.log(`OK: ${Object.keys(cards).length} cards`);

  for (const warning of warnings) {
    console.log(warning);
  }

  console.log(`Generated: ${path.relative(rootDir, outputPath)}`);
}

main();
