import { readFileSync, lstatSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { dataArray, dataObject, ensureMove } from "../../movement/state";
import { ApprovedV3Catalog, type ApprovedV3Card, type TrustedV3Approval } from "./approval";
import { compileV3CardJson } from "./compiler";
import { verifyReviewedCoverage } from "./reviewedCoverage";

const defaultRoot = resolve(__dirname, "../../../../data/effects-v3-reviewed");
const INDEX = "catalog-root.json", LEGACY = "manifest.json";
const ROOT_VERSION = "v3-reviewed-root.1", SHARD_VERSION = "v3-reviewed-shard.1", SOURCE_VERSION = "v3-reviewed-source.2";
const MAX_LEAF = 128, MAX_SHARDS = 128, MAX_CARDS = 8192;
const shardPath = /^shards\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\.json$/;
const hashPattern = /^[a-f0-9]{64}$/;
const hashJson = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const compareFile = (a: Leaf, b: Leaf) => a.file < b.file ? -1 : a.file > b.file ? 1 : 0;
type Leaf = Readonly<{ file: string; sha256: string; cardCount: number }>;
type RootIndex = Readonly<{ version: typeof ROOT_VERSION; rulesetVersion: string; legacy: Leaf; shards: readonly Leaf[]; rootHash: string }>;
type Source = { records: Map<string, Record<string, unknown>>; sourceCsvSha256?: string };
type SourceEvidence = Readonly<{ status: "legacy" | "verified"; snapshotSha256: string; csvSha256: string | null }>;
export type ReviewedV3Catalog = Readonly<{ rulesetVersion: string; catalog: ApprovedV3Catalog; cards: readonly ApprovedV3Card[];
  sourceEvidenceFor(cardId: string): SourceEvidence | null }>;
const reviewedCatalogs = new WeakSet<object>();
let deployed: ReviewedV3Catalog | undefined;
export function isReviewedV3Catalog(value: unknown): value is ReviewedV3Catalog {
  return value !== null && typeof value === "object" && reviewedCatalogs.has(value);
}

function reader(root: string) {
  const dirs = new Set<string>();
  let bytes = 0;
  return (file: string): string => {
    ensureMove(file === INDEX || file === LEGACY || shardPath.test(file) ||
      /^(cards|sources)\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\.json$/.test(file), "v3-reviewed-file-name");
    for (const dir of [root, resolve(root, file, "..")]) if (!dirs.has(dir)) {
      const stat = lstatSync(dir);
      ensureMove(stat.isDirectory() && !stat.isSymbolicLink(), "v3-reviewed-directory-type"); dirs.add(dir);
    }
    const path = resolve(root, file), stat = lstatSync(path);
    ensureMove(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 262144, "v3-reviewed-file-size-or-type");
    bytes += stat.size;
    ensureMove(bytes <= 128 * 1024 * 1024, "v3-reviewed-byte-limit");
    return readFileSync(path, "utf8");
  };
}
function leaf(value: unknown, legacy: boolean): Leaf {
  dataObject(value, ["file", "sha256", "cardCount"]);
  const { file, sha256, cardCount } = value;
  ensureMove(typeof file === "string" && (legacy ? file === LEGACY : shardPath.test(file)) &&
    typeof sha256 === "string" && hashPattern.test(sha256) && typeof cardCount === "number" &&
    Number.isSafeInteger(cardCount) && cardCount > 0 && cardCount <= MAX_LEAF, "v3-reviewed-root-leaf");
  return { file, sha256, cardCount };
}
function makeIndex(rulesetVersion: string, legacy: Leaf, leaves: readonly Leaf[]): RootIndex {
  const shards = [...leaves].sort(compareFile);
  ensureMove(shards.length <= MAX_SHARDS && new Set(shards.map(entry => entry.file.toLowerCase())).size === shards.length, "v3-reviewed-duplicate-shard-or-limit");
  ensureMove(shards.reduce((n, entry) => n + entry.cardCount, legacy.cardCount) <= MAX_CARDS, "v3-reviewed-card-limit");
  const data = { version: ROOT_VERSION, rulesetVersion, legacy, shards } as const;
  return { ...data, rootHash: hashJson(data) };
}
function readIndex(read: ReturnType<typeof reader>): RootIndex {
  const input: unknown = JSON.parse(read(INDEX));
  dataObject(input, ["version", "rulesetVersion", "legacy", "shards", "rootHash"]);
  ensureMove(input.version === ROOT_VERSION && typeof input.rulesetVersion === "string", "v3-reviewed-root-version");
  dataArray(input.shards, MAX_SHARDS);
  const index = makeIndex(input.rulesetVersion, leaf(input.legacy, true), input.shards.map(entry => leaf(entry, false)));
  ensureMove(input.rootHash === index.rootHash, "v3-reviewed-root-hash");
  return index;
}
function manifest(input: unknown, legacy: boolean) {
  dataObject(input, ["version", "rulesetVersion", "sources", "cards"]);
  ensureMove(input.version === (legacy ? "v3-reviewed-catalog.1" : SHARD_VERSION) && typeof input.rulesetVersion === "string", "v3-reviewed-manifest-version");
  dataArray(input.sources, MAX_LEAF); dataArray(input.cards, MAX_LEAF);
  ensureMove(input.cards.length > 0, "v3-reviewed-empty-catalog");
  return { rulesetVersion: input.rulesetVersion, sources: input.sources, cards: input.cards, legacy };
}
function verifyVariants(variants: unknown, definition: ApprovedV3Card["definition"], source: Source, records: Set<string>): void {
  ensureMove(source.sourceCsvSha256, "v3-reviewed-csv-source-required");
  dataArray(variants, MAX_LEAF);
  const displays = new Set<string>(), absence = (text: string) => text === "-" ? "" : text;
  for (const row of variants) {
    dataObject(row, ["displayId", "recordNumber", "text", "triggerText"]);
    const { displayId, recordNumber, text, triggerText } = row;
    ensureMove(typeof displayId === "string" && !displays.has(displayId) &&
      typeof recordNumber === "number" && Number.isSafeInteger(recordNumber) && recordNumber >= 2 &&
      typeof text === "string" && typeof triggerText === "string" && absence(text) === definition.source.text &&
      absence(triggerText) === definition.source.triggerText, "v3-reviewed-source-variant");
    const key = `${source.sourceCsvSha256}:${recordNumber}`;
    ensureMove(!records.has(key), "v3-reviewed-duplicate-source-record");
    records.add(key); displays.add(displayId);
  }
  ensureMove(displays.size === definition.source.displayIds.length && definition.source.displayIds.every(id => displays.has(id)), "v3-reviewed-source-display-ids");
}

function load(read: ReturnType<typeof reader>, index?: RootIndex) {
  const entries = index ? [index.legacy, ...index.shards] : null;
  const manifests = (entries ?? [{ file: LEGACY }]).map((entry, i) => {
    const raw: unknown = JSON.parse(read(entry.file));
    if ("sha256" in entry) ensureMove(hashJson(raw) === entry.sha256, "v3-reviewed-shard-hash");
    const result = manifest(raw, i === 0);
    if ("cardCount" in entry) ensureMove(result.cards.length === entry.cardCount && result.rulesetVersion === index!.rulesetVersion, "v3-reviewed-shard-count-or-ruleset");
    return result;
  });
  const sources = new Map<string, Source>(), sourceFiles = new Set<string>(), sourceEntries = manifests.flatMap(row => row.sources);
  ensureMove(sourceEntries.length <= MAX_CARDS, "v3-reviewed-source-limit");
  for (const entry of sourceEntries) {
    dataObject(entry, ["file", "sha256"]);
    const { file, sha256 } = entry;
    ensureMove(typeof file === "string" && file.startsWith("sources/") && !sourceFiles.has(file.toLowerCase()) &&
      typeof sha256 === "string" && !sources.has(sha256), "v3-reviewed-source-entry");
    const snapshot: unknown = JSON.parse(read(file));
    ensureMove(snapshot && typeof snapshot === "object" && hashJson(snapshot) === sha256 && "cards" in snapshot, "v3-reviewed-source-hash");
    dataArray(snapshot.cards, MAX_LEAF);
    const source: Source = { records: new Map() };
    if ("version" in snapshot && snapshot.version === SOURCE_VERSION) {
      const pinned: unknown = snapshot;
      dataObject(pinned, ["version", "sourceCsvSha256", "cards"]);
      ensureMove(typeof pinned.sourceCsvSha256 === "string" && hashPattern.test(pinned.sourceCsvSha256), "v3-reviewed-source-csv-hash");
      source.sourceCsvSha256 = pinned.sourceCsvSha256;
    }
    for (const row of snapshot.cards) {
      ensureMove(row && typeof row === "object" && !Array.isArray(row) && "cardId" in row && typeof row.cardId === "string" &&
        !source.records.has(row.cardId), "v3-reviewed-duplicate-or-invalid-source-card");
      source.records.set(row.cardId, row as Record<string, unknown>);
    }
    sourceFiles.add(file.toLowerCase()); sources.set(sha256, source);
  }
  const files = new Set<string>(), displays = new Set<string>(), records = new Set<string>(), approvals: TrustedV3Approval[] = [];
  const evidence = new Map<string, SourceEvidence>();
  const plans = manifests.flatMap(group => group.cards.map(entry => {
    dataObject(entry, group.legacy ? ["file", "approval"] : ["file", "approval", "review"]);
    ensureMove(typeof entry.file === "string" && entry.file.startsWith("cards/") && !files.has(entry.file.toLowerCase()), "v3-reviewed-card-entry");
    files.add(entry.file.toLowerCase());
    const plan = compileV3CardJson(read(entry.file)), d = plan.definition;
    ensureMove(!evidence.has(d.cardId), "v3-reviewed-duplicate-card-id");
    const source = sources.get(d.source.datasetSha256), row = source?.records.get(d.cardId);
    const facts = { cardId: d.cardId, name: d.name, cardType: d.cardType, ...d.baseStats, colors: d.colors,
      attributes: d.attributes, traits: d.traits, text: d.source.text, triggerText: d.source.triggerText };
    ensureMove(source && row, "v3-reviewed-source-facts-mismatch");
    if (group.legacy) ensureMove(isDeepStrictEqual(row, facts), "v3-reviewed-source-facts-mismatch");
    else {
      const { variants, ...printed } = row;
      ensureMove(isDeepStrictEqual(printed, facts), "v3-reviewed-source-facts-mismatch");
      verifyVariants(variants, d, source, records);
      verifyReviewedCoverage(entry.review, d);
    }
    for (const id of d.source.displayIds) {
      ensureMove(!displays.has(id), "v3-reviewed-duplicate-display-id"); displays.add(id);
    }
    evidence.set(d.cardId, Object.freeze({ status: group.legacy ? "legacy" : "verified", snapshotSha256: d.source.datasetSha256,
      csvSha256: source.sourceCsvSha256 ?? null }));
    approvals.push(entry.approval as TrustedV3Approval);
    return plan;
  }));
  const rulesetVersion = manifests[0]!.rulesetVersion;
  const catalog = new ApprovedV3Catalog(plans, approvals, rulesetVersion);
  return Object.freeze({ rulesetVersion, catalog, cards: Object.freeze(plans.map(plan => catalog.get(plan.definition.cardId)!)),
    sourceEvidenceFor: (cardId: string) => evidence.get(cardId) ?? null });
}

// Only the deployment-pinned index is trusted. Never accept catalog files over a socket.
export function loadReviewedV3Catalog(root?: string, format: "indexed" | "legacy" = "indexed") {
  const useCache = root === undefined && format === "indexed";
  if (useCache && deployed) return deployed;
  const read = reader(resolve(root ?? defaultRoot));
  const result = load(read, format === "legacy" ? undefined : readIndex(read));
  if (format === "indexed") reviewedCatalogs.add(result);
  if (useCache) deployed = result;
  return result;
}

// Offline proposal only. Existing leaf files must remain readable until the replacement is reviewed.
export function proposeReviewedV3Index(root: string, additions: readonly string[], replacements: readonly { oldFile: string; newFile: string }[] = []) {
  ensureMove(additions.length + replacements.length <= MAX_SHARDS, "v3-reviewed-shard-proposal-limit");
  const read = reader(root), current = readIndex(read), previous = load(reader(root), current);
  const removed = new Set(replacements.map(entry => entry.oldFile));
  ensureMove(removed.size === replacements.length && [...removed].every(file => current.shards.some(shard => shard.file === file)), "v3-reviewed-unknown-replacement-shard");
  const changed = [...additions, ...replacements.map(entry => entry.newFile)].map(file => {
    ensureMove(shardPath.test(file), "v3-reviewed-file-name");
    const raw: unknown = JSON.parse(read(file));
    return leaf({ file, sha256: hashJson(raw), cardCount: manifest(raw, false).cards.length }, false);
  });
  const proposed = makeIndex(current.rulesetVersion, current.legacy, [...current.shards.filter(shard => !removed.has(shard.file)), ...changed]);
  const next = load(reader(root), proposed);
  ensureMove(previous.cards.every(card => next.catalog.get(card.definition.cardId)), "v3-reviewed-card-removed");
  const changes = next.cards.flatMap(card => {
    const before = previous.catalog.get(card.definition.cardId);
    ensureMove(!before || before.definitionHash === card.definitionHash || before.definition.cardVersion !== card.definition.cardVersion, "v3-reviewed-card-version-required");
    return before && isDeepStrictEqual(before.approval, card.approval) ? [] : [{
      cardId: card.definition.cardId, before: before?.approval.definitionHash ?? null, after: card.approval.definitionHash
    }];
  }).sort((a, b) => a.cardId < b.cardId ? -1 : a.cardId > b.cardId ? 1 : 0);
  return { index: proposed, changes };
}
