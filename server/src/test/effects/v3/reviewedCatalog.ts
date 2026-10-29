import { readFileSync, lstatSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { dataArray, dataObject, ensureMove } from "../../movement/state";
import { ApprovedV3Catalog, type ApprovedV3Card, type TrustedV3Approval } from "./approval";
import { compileV3CardJson } from "./compiler";

const defaultRoot = resolve(__dirname, "../../../../data/effects-v3-reviewed");
export type ReviewedV3Catalog = Readonly<{ rulesetVersion: string; catalog: ApprovedV3Catalog; cards: readonly ApprovedV3Card[] }>;
const reviewedCatalogs = new WeakSet<object>();
export function isReviewedV3Catalog(value: unknown): value is ReviewedV3Catalog {
  return value !== null && typeof value === "object" && reviewedCatalogs.has(value);
}
function read(root: string, file: string): string {
  ensureMove(file === "manifest.json" || /^(cards|sources)\/[A-Za-z0-9_.-]+\.json$/.test(file), "v3-reviewed-file-name");
  const path = resolve(root, file), stat = lstatSync(path);
  ensureMove(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 262144, "v3-reviewed-file-size-or-type");
  return readFileSync(path, "utf8");
}
// Only the deployment-pinned manifest is trusted. Never accept this directory or approvals over a socket.
export function loadReviewedV3Catalog(root = defaultRoot) {
  const manifest: unknown = JSON.parse(read(root, "manifest.json"));
  dataObject(manifest, ["version", "rulesetVersion", "sources", "cards"]);
  ensureMove(manifest.version === "v3-reviewed-catalog.1" && typeof manifest.rulesetVersion === "string", "v3-reviewed-manifest-version");
  dataArray(manifest.sources, 128); dataArray(manifest.cards, 128);
  const sources = new Map<string, { cards: unknown[] }>();
  for (const source of manifest.sources) {
    dataObject(source, ["file", "sha256"]);
    ensureMove(typeof source.file === "string" && source.file.startsWith("sources/") && typeof source.sha256 === "string" && !sources.has(source.sha256), "v3-reviewed-source-entry");
    const snapshot = JSON.parse(read(root, source.file));
    const hash = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
    ensureMove(hash === source.sha256 && Array.isArray(snapshot.cards), "v3-reviewed-source-hash");
    sources.set(hash, snapshot);
  }
  const files = new Set<string>(), approvals: TrustedV3Approval[] = [];
  const plans = manifest.cards.map(entry => {
    dataObject(entry, ["file", "approval"]);
    ensureMove(typeof entry.file === "string" && entry.file.startsWith("cards/") && !files.has(entry.file), "v3-reviewed-card-entry"); files.add(entry.file);
    const plan = compileV3CardJson(read(root, entry.file)), definition = plan.definition;
    const rows = sources.get(definition.source.datasetSha256)?.cards;
    const row = rows?.find(row => row && typeof row === "object" && (row as Record<string, unknown>).cardId === definition.cardId);
    const facts = { cardId: definition.cardId, name: definition.name, cardType: definition.cardType, ...definition.baseStats, colors: definition.colors,
      attributes: definition.attributes, traits: definition.traits, text: definition.source.text, triggerText: definition.source.triggerText };
    ensureMove(row && rows!.filter(value => value && typeof value === "object" && (value as Record<string, unknown>).cardId === definition.cardId).length === 1 && isDeepStrictEqual(row, facts), "v3-reviewed-source-facts-mismatch");
    approvals.push(entry.approval as TrustedV3Approval); return plan;
  });
  ensureMove(plans.length > 0, "v3-reviewed-empty-catalog");
  const catalog = new ApprovedV3Catalog(plans, approvals, manifest.rulesetVersion);
  const result = Object.freeze({ rulesetVersion: manifest.rulesetVersion, catalog, cards: Object.freeze(plans.map(plan => catalog.get(plan.definition.cardId)!)) });
  reviewedCatalogs.add(result); return result;
}
