import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { dataArray, dataObject, ensureMove, freezeMovement, reference } from "../../movement/state";
import type { CardObjectRef, DeepReadonly } from "../types";
import type { Action, Node, Predicate } from "./dsl";
import { builtinV3Registries, label, v3RegistryHash } from "./compiler";
import { isApprovedV3Card, type ApprovedV3Card } from "./approval";

type Ref = Readonly<CardObjectRef>;
type Seat = 0 | 1;
type Bindings = Readonly<Record<string, readonly Ref[]>>;
type A = DeepReadonly<Action>;
type Selector = DeepReadonly<Node<"selector">>;
export type ResolutionCandidate = Readonly<{ ref: Ref; cardId: string; owner: Seat; controller: Seat; zone: string; kind: string; faceUp: boolean; visibleTo: readonly Seat[] }>;
// Server-owned, pure reads. This interface is not a socket payload or a game-rule implementation.
export interface ResolutionEnvironment {
  revision(): number;
  now(): number;
  evaluate(predicate: DeepReadonly<Predicate>, bindings: Bindings, candidate?: Ref): boolean | "unknown";
  candidates(selector: Selector, bindings: Bindings): readonly ResolutionCandidate[];
  canPayCosts?(costs: readonly DeepReadonly<Node<"cost">>[], discarded: readonly Ref[] | null): boolean | "unknown";
}
export type ResolutionIdentity = Readonly<{ matchId: string; resolutionId: string; effectId: string; actor: Seat; source: Ref }>;
type Instruction = { type: "CHECK"; predicate: DeepReadonly<Predicate> } | { type: "COSTS" } |
  { type: "SELECT"; action: Extract<A, { type: "SELECT" }> } | { type: "WORK"; action: Extract<A, { type: "DRAW" | "MOVE_CARD" | "KO" | "REST" | "SET_ACTIVE" }> } |
  { type: "BRANCH"; predicate: DeepReadonly<Predicate>; otherwise: number } | { type: "ENTER" } | { type: "EXIT" } | { type: "JUMP"; to: number } | { type: "END" };
type Choice = { kind: "choice"; purpose: "action" | "cost"; selectionId: string; chooser: Seat; min: number; max: number; bindAs: string | null; expiresAt: number; candidates: { token: string; cardId: string; ref: CardObjectRef }[] };
export type WorkRequest = DeepReadonly<{ kind: "work"; workId: string; worldRevision: number } & (
  { type: "PAY_COSTS"; costs: Node<"cost">[]; discarded: CardObjectRef[] } | { type: "DRAW"; player: Seat; count: number } |
  { type: "MOVE_CARD"; cards: CardObjectRef[]; destination: Extract<Action, { type: "MOVE_CARD" }>["destination"]; cause: "EFFECT" } |
  { type: "KO" | "REST" | "SET_ACTIVE"; cards: CardObjectRef[] }
)>;
type State = {
  version: "v3-frame.2"; identity: ResolutionIdentity; definitionHash: string; compilerVersion: string; registryHash: string; rulesetVersion: string;
  revision: number; worldRevision: number; pc: number; status: "ready" | "waitingForChoice" | "waitingForWork" | "completed" | "blocked";
  scopes: Record<string, CardObjectRef[]>[]; pending: Choice | WorkRequest | null;
  costCards: CardObjectRef[] | null; paidCostWorkId: string | null;
  receipts: { requestId: string; fingerprint: string }[];
};
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const relative = (actor: Seat, player: "SELF" | "OPPONENT"): Seat => player === "SELF" ? actor : (1 - actor) as Seat;
function program(card: ApprovedV3Card, effectId: string): Instruction[] {
  const effect = card.definition.effects.find(effect => effect.id === effectId); ensureMove(effect, "v3-effect-not-found");
  const code: Instruction[] = [{ type: "CHECK", predicate: effect.activationConditions }, { type: "COSTS" }, { type: "CHECK", predicate: effect.resolutionConditions }];
  const append = (actions: readonly A[]): void => { for (const action of actions) {
    if (action.type === "SEQUENCE") append(action.actions);
    else if (action.type === "IF") {
      const branch = { type: "BRANCH" as const, predicate: action.condition, otherwise: 0 }; code.push(branch, { type: "ENTER" }); append(action.then); code.push({ type: "EXIT" });
      const jump = { type: "JUMP" as const, to: 0 }; code.push(jump); branch.otherwise = code.length;
      code.push({ type: "ENTER" }); append(action.else); code.push({ type: "EXIT" }); jump.to = code.length;
    } else if (action.type === "SELECT") code.push({ type: "SELECT", action });
    else if (["DRAW", "MOVE_CARD", "KO", "REST", "SET_ACTIVE"].includes(action.type)) code.push({ type: "WORK", action: action as Extract<A, { type: "DRAW" | "MOVE_CARD" | "KO" | "REST" | "SET_ACTIVE" }> });
    else throw new Error("V3_RUNTIME_HANDLER_UNSUPPORTED");
  } };
  append(effect.actions); code.push({ type: "END" }); ensureMove(code.length <= 4096, "v3-program-limit"); return code;
}

// A persisted control machine only. It never mutates a board, pays costs, or applies game rulings.
export class V3ResolutionMachine {
  #state: State;
  #code: Instruction[];
  #card: ApprovedV3Card;
  #key: Buffer;
  #environment: ResolutionEnvironment;
  constructor(card: ApprovedV3Card, identity: ResolutionIdentity, signingKey: Uint8Array, environment: ResolutionEnvironment) {
    ensureMove(isApprovedV3Card(card), "v3-approved-server-plan-required");
    dataObject(identity, ["matchId", "resolutionId", "effectId", "actor", "source"]);
    label(identity.matchId); label(identity.resolutionId); label(identity.effectId); reference(identity.source);
    ensureMove(identity.actor === 0 || identity.actor === 1, "v3-invalid-actor");
    ensureMove(signingKey instanceof Uint8Array && signingKey.length >= 32 && signingKey.length <= 128, "v3-signing-key-required");
    ensureMove(v3RegistryHash(builtinV3Registries()) === card.registryHash, "v3-runtime-registry-mismatch");
    this.#key = Buffer.from(signingKey); this.#environment = environment; this.#card = card; this.#code = program(card, identity.effectId);
    const worldRevision = environment.revision(); ensureMove(Number.isSafeInteger(worldRevision) && worldRevision >= 0, "v3-invalid-world-revision");
    this.#state = { version: "v3-frame.2", identity: structuredClone(identity), definitionHash: card.definitionHash, compilerVersion: card.compilerVersion, registryHash: card.registryHash, rulesetVersion: card.rulesetVersion,
      revision: 0, worldRevision, pc: 0, status: "ready", scopes: [{}], pending: null, costCards: null, paidCostWorkId: null, receipts: [] };
  }
  #bindings(state: State): Bindings { return freezeMovement(structuredClone(Object.assign({}, ...state.scopes))); }
  #evaluate(predicate: DeepReadonly<Predicate>, state: State, candidate?: Ref): boolean {
    const result = this.#environment.evaluate(predicate, this.#bindings(state), candidate);
    ensureMove(result === true || result === false, "v3-unknown-predicate"); return result;
  }
  #command(requestId: string, expectedRevision: number, body: object, apply: (state: State) => void): { replayed: boolean } {
    label(requestId); const fingerprint = hash(JSON.stringify([expectedRevision, body]));
    const receipt = this.#state.receipts.find(receipt => receipt.requestId === requestId);
    if (receipt) { ensureMove(receipt.fingerprint === fingerprint, "v3-request-conflict"); return { replayed: true }; }
    ensureMove(Number.isSafeInteger(expectedRevision) && expectedRevision === this.#state.revision && this.#state.revision < Number.MAX_SAFE_INTEGER && this.#state.receipts.length < 512, "v3-stale-or-limited-frame");
    const next = structuredClone(this.#state); apply(next); next.revision++;
    next.receipts.push({ requestId, fingerprint }); ensureMove(Buffer.byteLength(JSON.stringify(next)) <= 262144, "v3-frame-size-limit");
    this.#state = next; return { replayed: false };
  }
  advance(requestId: string, expectedRevision: number): { replayed: boolean } {
    return this.#command(requestId, expectedRevision, { kind: "advance" }, state => {
      ensureMove(state.status === "ready" && this.#environment.revision() === state.worldRevision, "v3-not-ready-or-world-changed");
      for (let steps = 0; steps < 256 && state.status === "ready"; steps++) {
        const instruction = this.#code[state.pc]; ensureMove(instruction, "v3-invalid-program-counter");
        const workId = `${state.identity.resolutionId}:${state.pc}`;
        if (instruction.type === "CHECK") {
          if (!this.#evaluate(instruction.predicate, state)) { state.status = "completed"; return; } state.pc++;
        } else if (instruction.type === "COSTS") {
          const effect = this.#card.definition.effects.find(effect => effect.id === state.identity.effectId)!;
          if (!effect.costs.length) { state.pc++; continue; }
          const discardCount = effect.costs.reduce((sum, cost) => sum + (cost.type === "DISCARD_HAND" ? cost.count : 0), 0);
          if (discardCount > 0) {
            const payable = this.#environment.canPayCosts?.(effect.costs, state.costCards) ?? "unknown";
            ensureMove(payable !== "unknown", "v3-cost-feasibility-unknown");
            if (!payable) { state.status = "blocked"; return; }
            if (state.costCards === null) {
              this.#select(state, { type: "CARDS", owner: "SELF", controller: "SELF", chooser: "SELF", zone: "hand", cardTypes: ["character", "stage", "event"],
                filters: { type: "all", conditions: [] }, excludeSource: false, faceUpOnly: false, min: discardCount, max: discardCount, visibility: "OWNER_ONLY", selectionMode: "SELECT", order: "UNORDERED", onInsufficient: "fail" }, null);
              continue;
            }
          }
          state.pending = freezeMovement({ kind: "work", workId, worldRevision: state.worldRevision, type: "PAY_COSTS", costs: structuredClone(effect.costs), discarded: structuredClone(state.costCards ?? []) }); state.status = "waitingForWork";
        } else if (instruction.type === "BRANCH") state.pc = this.#evaluate(instruction.predicate, state) ? state.pc + 1 : instruction.otherwise;
        else if (instruction.type === "ENTER") { state.scopes.push({}); state.pc++; }
        else if (instruction.type === "EXIT") { ensureMove(state.scopes.length > 1, "v3-invalid-scope-pop"); state.scopes.pop(); state.pc++; }
        else if (instruction.type === "JUMP") state.pc = instruction.to;
        else if (instruction.type === "END") state.status = "completed";
        else if (instruction.type === "WORK") {
          const action = instruction.action;
          if (action.type === "DRAW") state.pending = { kind: "work", type: "DRAW", workId, worldRevision: state.worldRevision, player: relative(state.identity.actor, action.player), count: action.count };
          else {
            const cards = this.#bindings(state)[action.cards.ref.slice("bindings.".length)]; ensureMove(cards, "v3-missing-runtime-binding");
            if (!cards.length) { state.pc++; continue; }
            state.pending = action.type === "MOVE_CARD" ? { kind: "work", type: "MOVE_CARD", workId, worldRevision: state.worldRevision, cards: structuredClone(cards), destination: { ...action.destination }, cause: "EFFECT" } :
              { kind: "work", type: action.type, workId, worldRevision: state.worldRevision, cards: structuredClone(cards) };
          }
          state.status = "waitingForWork";
        } else if (instruction.type === "SELECT") this.#select(state, instruction.action.selector, instruction.action.bindAs);
      }
    });
  }
  #select(state: State, selector: Selector, bindAs: string | null): void {
    const rows = this.#environment.candidates(selector, this.#bindings(state)); dataArray(rows, 256);
    const seen = new Set<string>(), candidates: Choice["candidates"] = [];
    for (const row of rows) {
      reference(row.ref); label(row.cardId); ensureMove(!seen.has(row.ref.instanceId), "v3-duplicate-candidate"); seen.add(row.ref.instanceId);
      const visible = selector.visibility === "PUBLIC" ? row.faceUp === true && row.visibleTo.includes(0) && row.visibleTo.includes(1) :
        row.zone === "hand" && row.owner === state.identity.actor && row.controller === state.identity.actor && row.visibleTo.includes(state.identity.actor) && !row.visibleTo.includes((1 - state.identity.actor) as Seat);
      ensureMove(visible && row.owner === relative(state.identity.actor, selector.owner) &&
        row.controller === relative(state.identity.actor, selector.controller) && row.zone === selector.zone && selector.cardTypes.some(type => type === row.kind), "v3-nonpublic-or-ineligible-candidate");
      if (selector.excludeSource && row.ref.instanceId === state.identity.source.instanceId && row.ref.generation === state.identity.source.generation) continue;
      if (!this.#evaluate(selector.filters, state, row.ref)) continue;
      candidates.push({ token: randomUUID(), cardId: row.cardId, ref: { ...row.ref } });
    }
    ensureMove(candidates.length >= selector.min, "v3-insufficient-candidates");
    if (!candidates.length) { ensureMove(bindAs !== null, "v3-empty-required-cost-selection"); state.scopes.at(-1)![bindAs] = []; state.pc++; return; }
    const now = this.#environment.now(); ensureMove(Number.isSafeInteger(now) && now >= 0 && now <= Number.MAX_SAFE_INTEGER - 120000, "v3-invalid-clock");
    state.pending = { kind: "choice", purpose: bindAs === null ? "cost" : "action", selectionId: randomUUID(), chooser: relative(state.identity.actor, selector.chooser), min: selector.min, max: selector.max, bindAs, expiresAt: now + 120000, candidates };
    state.status = "waitingForChoice";
  }
  answer(actor: Seat, requestId: string, expectedRevision: number, selectionId: string, tokens: readonly string[]): { replayed: boolean } {
    label(selectionId); dataArray(tokens, 50); tokens.forEach(token => label(token));
    return this.#command(requestId, expectedRevision, { kind: "answer", actor, selectionId, tokens }, state => {
      const choice = state.pending;
      ensureMove(state.status === "waitingForChoice" && choice?.kind === "choice" && actor === choice.chooser && selectionId === choice.selectionId && this.#environment.revision() === state.worldRevision, "v3-not-current-chooser");
      const now = this.#environment.now(); ensureMove(Number.isSafeInteger(now) && now >= 0 && now < choice.expiresAt, "v3-choice-expired");
      ensureMove(new Set(tokens).size === tokens.length && tokens.length >= choice.min && tokens.length <= choice.max, "v3-choice-count");
      const selected = new Set(tokens); ensureMove(tokens.every(token => choice.candidates.some(candidate => candidate.token === token)), "v3-choice-token");
      // UNORDERED input is canonicalized to server candidate order, not client token order.
      const cards = choice.candidates.filter(candidate => selected.has(candidate.token)).map(candidate => ({ ...candidate.ref }));
      if (choice.purpose === "cost") state.costCards = cards;
      else { ensureMove(choice.bindAs !== null, "v3-action-binding-required"); state.scopes.at(-1)![choice.bindAs] = cards; state.pc++; }
      state.pending = null; state.status = "ready";
    });
  }
  settleWork(requestId: string, expectedRevision: number, workId: string, outcome: "applied" | "rejected", worldRevision: number): { replayed: boolean } {
    return this.#command(requestId, expectedRevision, { kind: "settleWork", workId, outcome, worldRevision }, state => {
      const work = state.pending; ensureMove(state.status === "waitingForWork" && work?.kind === "work" && work.workId === workId, "v3-work-not-pending");
      ensureMove((outcome === "applied" || outcome === "rejected") && Number.isSafeInteger(worldRevision) && this.#environment.revision() === worldRevision &&
        worldRevision === state.worldRevision + (outcome === "applied" ? 1 : 0), "v3-work-version-or-outcome");
      state.worldRevision = worldRevision; state.pending = null; state.status = outcome === "applied" ? "ready" : "blocked";
      if (outcome === "applied") { if (work.type === "PAY_COSTS") { state.paidCostWorkId = work.workId; state.costCards = null; } state.pc++; }
    });
  }
  workForCoordinator(): WorkRequest | null { return this.#state.pending?.kind === "work" ? freezeMovement(structuredClone(this.#state.pending)) : null; }
  viewFor(viewer: Seat) {
    ensureMove(viewer === 0 || viewer === 1, "v3-invalid-viewer"); const choice = this.#state.pending?.kind === "choice" ? this.#state.pending : null;
    return freezeMovement({ mode: "work_requests_only" as const, resolutionId: this.#state.identity.resolutionId, revision: this.#state.revision, worldRevision: this.#state.worldRevision, status: this.#state.status,
      choice: choice ? { purpose: choice.purpose, selectionId: choice.selectionId, chooser: choice.chooser, min: choice.min, max: choice.max, expiresAt: choice.expiresAt,
        options: viewer === choice.chooser ? choice.candidates.map(candidate => ({ token: candidate.token, cardId: candidate.cardId })) : [] } : null });
  }
  exportForStorage(): string {
    const payload = JSON.stringify(this.#state); return JSON.stringify({ payload, signature: createHmac("sha256", this.#key).update(payload).digest("hex") });
  }
  static restore(card: ApprovedV3Card, identity: ResolutionIdentity, signingKey: Uint8Array, environment: ResolutionEnvironment, saved: string, expectedFrameRevision: number): V3ResolutionMachine {
    ensureMove(typeof saved === "string" && Buffer.byteLength(saved) <= 1048576, "v3-saved-frame-too-large");
    const machine = new V3ResolutionMachine(card, identity, signingKey, environment), envelope: unknown = JSON.parse(saved);
    dataObject(envelope, ["payload", "signature"]); ensureMove(typeof envelope.payload === "string" && typeof envelope.signature === "string" && /^[a-f0-9]{64}$/.test(envelope.signature), "v3-invalid-saved-envelope");
    const expected = createHmac("sha256", machine.#key).update(envelope.payload).digest();
    ensureMove(timingSafeEqual(expected, Buffer.from(envelope.signature, "hex")), "v3-saved-signature-mismatch");
    const state = JSON.parse(envelope.payload) as State;
    ensureMove(Number.isSafeInteger(expectedFrameRevision) && expectedFrameRevision >= 0 && state.revision === expectedFrameRevision && state.version === "v3-frame.2" && state.definitionHash === card.definitionHash && state.compilerVersion === card.compilerVersion && state.registryHash === card.registryHash && state.rulesetVersion === card.rulesetVersion &&
      state.identity.matchId === identity.matchId && state.identity.resolutionId === identity.resolutionId && state.identity.effectId === identity.effectId && state.identity.actor === identity.actor && state.identity.source.instanceId === identity.source.instanceId && state.identity.source.generation === identity.source.generation && state.worldRevision === environment.revision(), "v3-saved-context-mismatch");
    machine.#state = state; return machine;
  }
}
