import { randomInt, randomUUID } from "node:crypto";
import { known, unknown } from "./facts";
import { createPredicateRuntimeRegistry } from "./predicates";
import type { PredicateRuntimeRegistry } from "./predicates";
import { createSelectorRuntimeRegistry, ensureSelection, prepareSelector, seat, selectionId, SelectionError, validateSnapshot } from "./selectors";
import type { SelectorRuntimeRegistry } from "./selectors";
import type { CardObjectRef, DeepReadonly, Evaluation, Selector } from "./types";
import type { Disclosure, PreparedSelection, Seat, SelectionCard, SelectionIdentity, SelectionInput, SelectionReply, SelectionResult, SelectionSnapshot, SelectionView } from "./selectionTypes";

type CapturedCard = Readonly<Omit<SelectionCard, "facts">>;
function freezeData<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freezeData); Object.freeze(value); }
  return value;
}
function copyCard(card: SelectionCard): CapturedCard {
  return Object.freeze({ instanceId: card.instanceId, generation: card.generation, owner: card.owner, controller: card.controller, zone: card.zone, cardId: card.cardId, faceUp: card.faceUp });
}
function visible(card: CapturedCard, viewer: Seat): boolean {
  if (card.zone === "hand") return card.owner === viewer;
  return card.zone !== "deck" && card.faceUp;
}
function disclosureReferences(disclosure: Disclosure | undefined, cards: ReadonlyMap<string, SelectionCard>): ReadonlySet<string> {
  const result = new Set<string>();
  if (disclosure?.allowFilteredBlindSelection !== undefined) ensureSelection(typeof disclosure.allowFilteredBlindSelection === "boolean", "invalid-disclosure");
  const references = disclosure?.revealToChooser ?? [];
  ensureSelection(Array.isArray(references) && references.length <= 128, "invalid-disclosure");
  for (const ref of references) {
    ensureSelection(ref && typeof ref === "object", "invalid-disclosure-reference");
    const card = cards.get(ref.instanceId);
    ensureSelection(card && card.generation === ref.generation && !result.has(card.instanceId), "invalid-disclosure-reference");
    result.add(card.instanceId);
  }
  return result;
}
// Check built-in hidden-card authority before evaluating even the candidate count.
function preflightDisclosure(input: SelectionInput): void {
  const cards = validateSnapshot(input.snapshot), selector = input.selector;
  if (selector.kind !== "cards" || selector.mode === "ALL" || selector.mode === "RANDOM") return;
  const reveals = disclosureReferences(input.disclosure, cards);
  const relative = (owner: "SELF" | "OPPONENT") => owner === "SELF" ? input.actor : 1 - input.actor;
  const chooser = relative(selector.chooser) as Seat;
  const hidden = input.snapshot.cards.some(card => selector.zones.includes(card.zone) &&
    (selector.owner === "ANY" || card.owner === relative(selector.owner)) &&
    (selector.controller === undefined || selector.controller === "ANY" || card.controller === relative(selector.controller)) &&
    !visible(card, chooser) && !reveals.has(card.instanceId));
  if (!hidden) return;
  if (selector.condition || selector.exclude) ensureSelection(selector.mode === "BLIND_SELECT" && input.disclosure?.allowFilteredBlindSelection === true, "filtered-hidden-selection-needs-authority");
  if (selector.mode !== "BLIND_SELECT") throw new SelectionError("hidden-card-needs-reveal-authority-or-blind-mode");
}
function shuffle<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) { const j = randomInt(i + 1); [result[i], result[j]] = [result[j]!, result[i]!]; }
  return result;
}
function parseReply(value: unknown): SelectionReply {
  ensureSelection(value && typeof value === "object" && !Array.isArray(value), "invalid-reply");
  const prototype = Object.getPrototypeOf(value);
  ensureSelection(prototype === Object.prototype || prototype === null, "invalid-reply");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const expected = ["matchId", "resolutionId", "selectionId", "revision", "tokens"];
  ensureSelection(Reflect.ownKeys(descriptors).length === expected.length, "invalid-reply-fields");
  for (const key of expected) ensureSelection(descriptors[key] && Object.hasOwn(descriptors[key], "value"), "invalid-reply-fields");
  const raw = Object.fromEntries(expected.map(key => [key, descriptors[key]!.value]));
  selectionId(raw.matchId); selectionId(raw.resolutionId); selectionId(raw.selectionId);
  ensureSelection(Number.isSafeInteger(raw.revision) && raw.revision >= 0 && Array.isArray(raw.tokens) && raw.tokens.length <= 128, "invalid-reply");
  const tokens: string[] = [];
  for (let i = 0; i < raw.tokens.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(raw.tokens, String(i));
    ensureSelection(descriptor && Object.hasOwn(descriptor, "value"), "invalid-reply-token");
    const token: unknown = descriptor.value; selectionId(token); tokens.push(token);
  }
  ensureSelection(new Set(tokens).size === tokens.length, "duplicate-reply-token");
  return { matchId: raw.matchId, resolutionId: raw.resolutionId, selectionId: raw.selectionId, revision: raw.revision, tokens };
}

// Contains private mappings. Only viewFor() output is safe for transport.
export class SelectionSession {
  readonly identity: SelectionIdentity;
  readonly #actor: Seat;
  readonly #selector: DeepReadonly<Selector>;
  readonly #registry: SelectorRuntimeRegistry;
  readonly #predicates: PredicateRuntimeRegistry;
  readonly #plan: PreparedSelection;
  readonly #cards = new Map<string, CapturedCard>();
  readonly #tokens = new Map<string, string>();
  readonly #view: SelectionView | null;
  #closed = false;

  private constructor(input: SelectionInput, plan: PreparedSelection, registry: SelectorRuntimeRegistry, predicates: PredicateRuntimeRegistry) {
    this.identity = Object.freeze({ matchId: input.matchId, resolutionId: input.resolutionId, selectionId: randomUUID(), revision: input.snapshot.revision });
    this.#actor = input.actor; this.#selector = freezeData(structuredClone(input.selector)); this.#registry = registry; this.#predicates = predicates;
    this.#plan = freezeData(structuredClone(plan));
    if (plan.kind === "choice") {
      const options = plan.options.map(option => { const token = randomUUID(); this.#tokens.set(token, option.id); return Object.freeze({ token, label: option.label }); });
      this.#view = Object.freeze({ ...this.identity, kind: "choice", chooser: plan.chooser, options: Object.freeze(options) });
      return;
    }
    const current = validateSnapshot(input.snapshot);
    for (const reference of plan.examined) this.#cards.set(reference.instanceId, copyCard(current.get(reference.instanceId)!));
    const reveals = disclosureReferences(input.disclosure, current);
    if (plan.mode === "ALL" || plan.mode === "RANDOM") { this.#view = null; return; }
    const hidden = plan.examined.some(reference => {
      const card = this.#cards.get(reference.instanceId)!;
      return !visible(card, plan.chooser) && !reveals.has(card.instanceId);
    });
    if (plan.filtered && hidden) ensureSelection(plan.mode === "BLIND_SELECT" && input.disclosure?.allowFilteredBlindSelection === true, "filtered-hidden-selection-needs-authority");
    const references = plan.mode === "BLIND_SELECT" ? shuffle(plan.candidates) : [...plan.candidates];
    const candidates = references.map(reference => {
      const card = this.#cards.get(reference.instanceId)!;
      const canReveal = visible(card, plan.chooser) || reveals.has(card.instanceId);
      if (plan.mode !== "BLIND_SELECT") ensureSelection(canReveal, "hidden-card-needs-reveal-authority-or-blind-mode");
      const token = randomUUID(); this.#tokens.set(token, card.instanceId);
      return Object.freeze({ token, cardId: plan.mode === "BLIND_SELECT" ? null : card.cardId });
    });
    this.#view = Object.freeze({ ...this.identity, kind: "cards", chooser: plan.chooser, mode: plan.mode, min: plan.min, max: Math.min(plan.max, candidates.length), candidates: Object.freeze(candidates) });
  }
  static prepare(input: SelectionInput, registry = createSelectorRuntimeRegistry(), predicates = createPredicateRuntimeRegistry()): Evaluation<SelectionSession> {
    selectionId(input.matchId); selectionId(input.resolutionId); seat(input.actor);
    ensureSelection(input.snapshot.matchId === input.matchId, "wrong-snapshot-match");
    preflightDisclosure(input);
    const result = prepareSelector(input.selector, input.actor, input.snapshot, registry, predicates);
    return result.state === "unknown" ? unknown(result.reason) : known(new SelectionSession(input, result.value, registry, predicates));
  }
  get closed(): boolean { return this.#closed; }
  viewFor(viewer: Seat): SelectionView | null { seat(viewer); return !this.#closed && this.#view?.chooser === viewer ? this.#view : null; }
  toJSON(): never { throw new SelectionError("server-only-selection-session"); }
  cancel(): void { this.#closed = true; }

  private refresh(snapshot: SelectionSnapshot): PreparedSelection {
    ensureSelection(!this.#closed, "selection-already-closed");
    ensureSelection(snapshot.matchId === this.identity.matchId && snapshot.revision === this.identity.revision, "stale-selection-revision-or-match");
    const result = prepareSelector(this.#selector, this.#actor, snapshot, this.#registry, this.#predicates);
    ensureSelection(result.state === "known", "selection-data-unavailable");
    const plan = result.value;
    ensureSelection(plan.kind === this.#plan.kind && plan.chooser === this.#plan.chooser, "selection-plan-changed");
    if (plan.kind === "cards" && this.#plan.kind === "cards") ensureSelection(plan.mode === this.#plan.mode && plan.min === this.#plan.min && plan.max === this.#plan.max, "selection-plan-changed");
    if (plan.kind === "choice" && this.#plan.kind === "choice") ensureSelection(JSON.stringify(plan.options) === JSON.stringify(this.#plan.options), "choice-options-changed");
    return plan;
  }
  private cardResults(ids: readonly string[], plan: PreparedSelection, snapshot: SelectionSnapshot): SelectionResult {
    ensureSelection(plan.kind === "cards", "not-a-card-selection");
    const current = validateSnapshot(snapshot), candidates = new Set(plan.candidates.map(ref => ref.instanceId));
    const cards = ids.map(id => {
      const before = this.#cards.get(id), now = current.get(id);
      ensureSelection(before && now && candidates.has(id) && before.generation === now.generation && before.owner === now.owner && before.controller === now.controller && before.zone === now.zone && before.cardId === now.cardId && before.faceUp === now.faceUp, "stale-or-illegal-selected-card");
      return Object.freeze({ instanceId: id, generation: now.generation });
    });
    return Object.freeze({ kind: "cards", cards: Object.freeze(cards) });
  }
  answer(actor: Seat, value: unknown, snapshot: SelectionSnapshot): SelectionResult {
    seat(actor); ensureSelection(!this.#closed && actor === this.#plan.chooser && this.#view, "not-an-answerable-selection");
    const reply = parseReply(value);
    for (const key of ["matchId", "resolutionId", "selectionId", "revision"] as const) ensureSelection(reply[key] === this.identity[key], "wrong-selection-identity");
    const keys = reply.tokens.map(token => { const key = this.#tokens.get(token); ensureSelection(key, "unknown-selection-token"); return key; });
    const plan = this.refresh(snapshot);
    let result: SelectionResult;
    if (plan.kind === "choice") {
      ensureSelection(keys.length === 1 && plan.options.some(option => option.id === keys[0]), "invalid-choice-answer");
      result = Object.freeze({ kind: "choice", optionId: keys[0]! });
    } else {
      ensureSelection(keys.length >= plan.min && keys.length <= plan.max, "wrong-selection-count");
      const selected = new Set(keys);
      const ids = plan.mode === "ORDER" ? keys : this.#plan.kind === "cards" ? this.#plan.candidates.map(ref => ref.instanceId).filter(id => selected.has(id)) : [];
      result = this.cardResults(ids, plan, snapshot);
    }
    this.#closed = true;
    return result;
  }
  resolveAutomatic(snapshot: SelectionSnapshot): SelectionResult {
    const plan = this.refresh(snapshot);
    ensureSelection(plan.kind === "cards" && this.#plan.kind === "cards" && (plan.mode === "ALL" || plan.mode === "RANDOM"), "not-an-automatic-selection");
    const before = this.#plan.candidates.map(ref => `${ref.instanceId}:${ref.generation}`).sort();
    const after = plan.candidates.map(ref => `${ref.instanceId}:${ref.generation}`).sort();
    ensureSelection(JSON.stringify(before) === JSON.stringify(after), "automatic-candidates-changed");
    const chosen = plan.mode === "ALL" ? plan.candidates : shuffle(plan.candidates).slice(0, plan.min);
    const result = this.cardResults(chosen.map(ref => ref.instanceId), plan, snapshot);
    this.#closed = true;
    return result;
  }
}
