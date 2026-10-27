import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const types = new Set(["leader", "character", "event", "stage", "don", "unknown"]);
const timings = new Set(["onPlay", "onAttack", "onKo", "activateMain", "main", "counter", "trigger", "continuous"]);
const legacyEffects = new Set(["onPlay", "onAttack", "onKo"]);
const object = () => Object.create(null);
const list = (value = "") => value.trim().toLowerCase() === "null" ? [] : [...new Set(value.split("|").map(s => s.trim()).filter(Boolean))];
const text = (value = "") => !value.trim() || value.trim().toLowerCase() === "null" ? null : value.trim();

// Complete CSV records may contain quoted commas, newlines and escaped quotes.
export function parseCsv(raw) {
  const rows = []; let row = [], field = "", quoted = false, closed = false;
  const pushField = () => { row.push(field.trim()); field = ""; closed = false; };
  const pushRow = () => { pushField(); if (row.some(Boolean)) rows.push(row); row = []; };
  raw = raw.replace(/^\uFEFF/, "");
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (quoted) {
      if (ch === '"' && raw[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') { quoted = false; closed = true; }
      else field += ch;
    } else if (ch === ',') pushField();
    else if (ch === '\r' || ch === '\n') { if (ch === '\r' && raw[i + 1] === '\n') i++; pushRow(); }
    else if (ch === '"' && !field && !closed) quoted = true;
    else if (ch === '"' || (closed && ch.trim())) throw new Error("CSV: unexpected text or quote after field");
    else if (!closed) field += ch;
  }
  if (quoted) throw new Error("CSV: unclosed quote");
  if (field || row.length || closed) pushRow();
  return rows;
}

function records(raw, required, label) {
  const [headers, ...rows] = parseCsv(raw);
  if (!headers) throw new Error(`${label}: empty CSV`);
  const keys = headers.map(s => s.toLowerCase());
  const allowed = label === "cards" ? ["id", "type", "cost", "power", "counter", "effects", "name", "colors", "attributes", "traits", "life", "effectids"] : ["effectid", "cardid", "timing", "displaytext", "implementation"];
  for (const key of keys) if (!allowed.includes(key)) throw new Error(`${label}: unknown header ${key}`);
  if (new Set(keys).size !== keys.length || keys.some(k => !k)) throw new Error(`${label}: duplicate or empty header`);
  for (const key of required) if (!keys.includes(key)) throw new Error(`${label}: missing header ${key}`);
  return rows.map((values, index) => {
    if (values.length !== keys.length) throw new Error(`${label} record ${index + 2}: expected ${keys.length} columns, got ${values.length}`);
    const entry = object(); keys.forEach((key, i) => { entry[key] = values[i]; });
    return entry;
  });
}
function number(value, label) {
  value = text(value);
  if (value === null) return null;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error(`${label}: enter a non-negative integer or leave blank`);
  return Number(value);
}
function id(value, label) {
  if (!value || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(value)) throw new Error(`${label}: invalid ID ${value ?? ""}`);
  return value;
}

export function compileMaster(cardCsv, effectCsv = null) {
  const cards = object(), effectDefinitions = object();
  if (effectCsv !== null) for (const row of records(effectCsv, ["effectid", "cardid", "timing", "displaytext", "implementation"], "effects")) {
    const key = id(row.effectid, "effectId");
    if (Object.hasOwn(effectDefinitions, key)) throw new Error(`duplicate effectId: ${key}`);
    if (!timings.has(row.timing)) throw new Error(`${key}: unknown timing`);
    // Executable effects are intentionally unsupported at this foundation stage.
    if (row.implementation !== "unsupported" && row.implementation !== "manual") throw new Error(`${key}: implementation must be unsupported or manual`);
    effectDefinitions[key] = { cardId: id(row.cardid, key), timing: row.timing, displayText: text(row.displaytext), implementation: row.implementation };
  }
  for (const row of records(cardCsv, ["id", "type", "cost", "power", "counter"], "cards")) {
    const key = id(row.id, "cardId");
    if (Object.hasOwn(cards, key)) throw new Error(`duplicate cardId: ${key}`);
    const type = text(row.type)?.toLowerCase() ?? "unknown";
    if (!types.has(type)) throw new Error(`${key}: unknown type ${type}`);
    const effects = list(row.effects);
    if (effects.some(effect => !legacyEffects.has(effect))) throw new Error(`${key}: invalid legacy effects`);
    cards[key] = {
      type, cost: number(row.cost, `${key} cost`), power: number(row.power, `${key} power`), counter: number(row.counter, `${key} counter`), effects,
      name: text(row.name), colors: list(row.colors), attributes: list(row.attributes), traits: list(row.traits), life: number(row.life, `${key} life`), effectIds: list(row.effectids),
    };
  }
  for (const [key, effect] of Object.entries(effectDefinitions)) {
    const card = cards[effect.cardId];
    if (!card) throw new Error(`${key}: cardId does not exist: ${effect.cardId}`);
    if (!card.effectIds.includes(key)) card.effectIds.push(key);
    if (legacyEffects.has(effect.timing) && !card.effects.includes(effect.timing)) card.effects.push(effect.timing);
  }
  for (const [key, card] of Object.entries(cards)) for (const effectId of card.effectIds) {
    if (!effectDefinitions[effectId] || effectDefinitions[effectId].cardId !== key) throw new Error(`${key}: missing or mismatched effectId ${effectId}`);
  }
  if (!Object.keys(cards).length) throw new Error("cards: no cards registered");
  const content = { cards, effectDefinitions };
  const contentHash = createHash("sha256").update(JSON.stringify(content)).digest("hex");
  return { version: 1, schemaVersion: 2, contentHash, ...content };
}

export function buildMaster(rootDir = process.cwd()) {
  const input = path.join(rootDir, "local-data/card-master.csv");
  const effects = path.join(rootDir, "local-data/card-effects.csv");
  const output = path.join(rootDir, "public/card-master.json");
  const master = compileMaster(fs.readFileSync(input, "utf8"), fs.existsSync(effects) ? fs.readFileSync(effects, "utf8") : null);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const temporary = `${output}.tmp`;
  try { fs.writeFileSync(temporary, `${JSON.stringify(master, null, 2)}\n`, "utf8"); fs.renameSync(temporary, output); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  console.log(`OK: ${Object.keys(master.cards).length} cards, ${Object.keys(master.effectDefinitions).length} effects\nGenerated: ${output}\nHash: ${master.contentHash}`);
  return master;
}

export function prepareExpandedInput(rootDir = process.cwd()) {
  const source = path.join(rootDir, "local-data/card-master.csv");
  const output = path.join(rootDir, "local-data/card-master-expanded.csv");
  const rows = parseCsv(fs.readFileSync(source, "utf8"));
  const headers = rows[0];
  if (!headers) throw new Error("Empty input CSV");
  const additional = ["name", "colors", "attributes", "traits", "life", "effectIds"].filter(key => !headers.some(h => h.toLowerCase() === key.toLowerCase()));
  const width = headers.length;
  headers.push(...additional);
  for (const row of rows.slice(1)) {
    if (row.length !== width) throw new Error("Damaged CSV row");
    row.push(...additional.map(() => ""));
  }
  const quote = value => /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  fs.writeFileSync(output, `\uFEFF${rows.map(row => row.map(quote).join(",")).join("\r\n")}\r\n`, { encoding: "utf8", flag: "wx" });
  console.log(`Prepared: ${output}\nOriginal CSV was not modified. Existing expanded input will never be overwritten.`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { if (process.argv.includes("--prepare")) prepareExpandedInput(); else buildMaster(); } catch (error) { console.error(`ERROR: ${error.message}\nExisting JSON was not replaced.`); process.exitCode = 1; }
}
