import { createHash, randomInt, randomUUID } from "node:crypto";
import { MovementStore } from "../../movement/engine";
import { createMovementState, dataArray, emptyZones, ensureMove, freezeMovement } from "../../movement/state";
import type { MovementCard, MovementOperation, MovementState } from "../../movement/types";
import type { DeckInput } from "../../protocol";
import { createProgression, phaseWork } from "../../progression/state";
import { applySystemEvent } from "../../progression/transitions";
import { label } from "./compiler";
import { isReviewedV3Catalog, type ReviewedV3Catalog } from "./reviewedCatalog";
import { validateReviewedV3Deck } from "./reviewedDeck";
import { projectV3Movement } from "./projection";
import { V3SyntheticMatchCoordinator } from "./matchCoordinator";

type Seat = 0 | 1;
const shuffled = <T>(values: readonly T[]): T[] => {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) { const j = randomInt(i + 1); [result[i], result[j]] = [result[j]!, result[i]!]; }
  return result;
};
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export const REVIEWED_SETUP_POLICY = {
  version: "v3-reviewed-setup.1", source: "https://www.onepiece-cardgame.com/pdf/rule_comprehensive.pdf?20260828=",
  reviewedAt: "2026-10-29", clauses: ["5-2-1-2", "5-2-1-4", "5-2-1-5", "5-2-1-6", "5-2-1-7", "5-2-1-8", "6-3", "6-4"],
} as const;

export class ReviewedV3Setup {
  #board: MovementState; #reviewed: ReviewedV3Catalog; #key: Uint8Array;
  #chooser = randomInt(2) as Seat; #first: Seat | null = null; #revision = 0;
  #decisions: [boolean | null, boolean | null] = [null, null];
  #game: V3SyntheticMatchCoordinator | null = null;
  #receipts = new Map<string, string>();
  constructor(decks: readonly [DeckInput, DeckInput], reviewed: ReviewedV3Catalog, signingKey: Uint8Array) {
    ensureMove(process.env.NODE_ENV !== "production" && isReviewedV3Catalog(reviewed), "v3-reviewed-setup-disabled");
    dataArray(decks, 2); ensureMove(decks.length === 2, "v3-setup-two-decks-required");
    ensureMove(signingKey instanceof Uint8Array && signingKey.length >= 32 && signingKey.length <= 128, "v3-signing-key-required");
    const validated = decks.map(deck => validateReviewedV3Deck(deck, reviewed.catalog));
    const players = [emptyZones(), emptyZones()] as const, cards: Record<string, MovementCard> = Object.create(null);
    for (const actor of [0, 1] as const) {
      const deck = validated[actor]!, zones = players[actor];
      const make = (cardId: string, kind: MovementCard["kind"], faceUp: boolean) => {
        const instanceId = randomUUID(); cards[instanceId] = { instanceId, generation: 0, cardId, kind, owner: actor, controller: actor, faceUp, rotated: false,
          attachedTo: null, modifierIds: [], grantIds: [], enteredTurn: null }; return instanceId;
      };
      zones.leader[0] = make(deck.leaderCardId, "leader", true);
      zones.deck = shuffled(deck.mainDeck.map(id => make(id, deck.cardTypes[id]!, false)));
      zones.donDeck = deck.donDeck.map(id => make(id, "don", false));
    }
    this.#board = createMovementState({ matchId: randomUUID(), turnNumber: 1, players, cards });
    this.#reviewed = reviewed; this.#key = Uint8Array.from(signingKey);
  }
  #commit(board: MovementState, actor: Seat, requestId: string, tag: string, operations: MovementOperation[]): MovementState {
    return new MovementStore(board).commit({ transactionId: hash(`${board.matchId}:${requestId}:${tag}`), matchId: board.matchId, expectedRevision: board.revision,
      turnNumber: 1, actor, effectController: null, source: null, mode: "rule", resolutionId: null, operations }, { status: "certifiedNone" }).state;
  }
  #move(board: MovementState, actor: Seat, id: string, from: "deck" | "hand" | "donDeck", to: "deck" | "hand" | "life" | "activeDon"): MovementOperation {
    return { kind: "move", card: { instanceId: id, generation: board.cards[id]!.generation }, from: { player: actor, zone: from },
      to: { player: actor, zone: to, position: "append", faceUp: to === "hand" || to === "activeDon", rotated: false }, cause: "RULE_PROCESSING" };
  }
  #run(actor: Seat, requestId: string, expectedRevision: number, body: object, apply: () => void) {
    ensureMove(process.env.NODE_ENV !== "production" && (actor === 0 || actor === 1), "v3-reviewed-setup-disabled-or-actor"); label(requestId);
    const fingerprint = hash(JSON.stringify([actor, expectedRevision, body])), receipt = this.#receipts.get(requestId);
    if (receipt) { ensureMove(receipt === fingerprint, "v3-setup-request-conflict"); return { replayed: true }; }
    ensureMove(expectedRevision === this.#revision && Number.isSafeInteger(expectedRevision) && this.#receipts.size < 16 && !this.#game, "v3-setup-stale-or-finished");
    apply(); this.#revision++; this.#receipts.set(requestId, fingerprint); return { replayed: false };
  }
  chooseFirst(actor: Seat, requestId: string, expectedRevision: number, choice: "first" | "second") {
    return this.#run(actor, requestId, expectedRevision, { kind: "first", choice }, () => {
      ensureMove(this.#first === null && actor === this.#chooser && (choice === "first" || choice === "second"), "v3-first-choice-unavailable");
      const first = choice === "first" ? actor : (1 - actor) as Seat;
      const operations = ([0, 1] as const).flatMap(player => this.#board.players[player].deck.slice(0, 5).map(id => this.#move(this.#board, player, id!, "deck", "hand")));
      const board = this.#commit(this.#board, actor, requestId, "initial-hand", operations);
      this.#board = board; this.#first = first;
    });
  }
  mulligan(actor: Seat, requestId: string, expectedRevision: number, redraw: boolean) {
    return this.#run(actor, requestId, expectedRevision, { kind: "mulligan", redraw }, () => {
      ensureMove(this.#first !== null && typeof redraw === "boolean" && this.#decisions[actor] === null &&
        (actor === this.#first || this.#decisions[this.#first] !== null), "v3-mulligan-unavailable");
      let board = this.#board;
      if (redraw) {
        board = this.#commit(board, actor, requestId, "return-hand", board.players[actor].hand.map(id => this.#move(board, actor, id!, "hand", "deck")));
        board = this.#commit(board, actor, requestId, "shuffle", [{ kind: "reorder", location: { player: actor, zone: "deck" }, conceal: true,
          cards: shuffled(board.players[actor].deck).map(id => ({ instanceId: id!, generation: board.cards[id!]!.generation })) }]);
        board = this.#commit(board, actor, requestId, "redraw", board.players[actor].deck.slice(0, 5).map(id => this.#move(board, actor, id!, "deck", "hand")));
      }
      const decisions: [boolean | null, boolean | null] = [...this.#decisions]; decisions[actor] = redraw;
      let game: V3SyntheticMatchCoordinator | null = null;
      if (decisions.every(value => value !== null)) {
        const operations = ([0, 1] as const).flatMap(player => {
          const leaderId = board.cards[board.players[player].leader[0]!]!.cardId, life = this.#reviewed.catalog.get(leaderId)!.definition.baseStats.life!;
          // The original top card becomes the bottom card of Life (CR 5-2-1-7).
          return board.players[player].deck.slice(0, life).reverse().map(id => this.#move(board, player, id!, "deck", "life"));
        });
        board = this.#commit(board, actor, requestId, "life", operations);
        let progression = createProgression(this.#first);
        for (let steps = 0; steps < 4; steps++) {
          const work = phaseWork(progression); ensureMove(work, "v3-setup-phase-required");
          if (work.kind === "donCheckpoint") board = this.#commit(board, this.#first, requestId, "first-don", [this.#move(board, this.#first, board.players[this.#first].donDeck[0]!, "donDeck", "activeDon")]);
          ensureMove(work.kind !== "drawCheckpoint" || work.normalCount === 0, "v3-setup-initial-draw-policy");
          progression = applySystemEvent(progression, progression.revision, { kind: "settlePhase", phaseToken: work.token });
          if (progression.phase === "main") break;
          progression = applySystemEvent(progression, progression.revision, { kind: "advancePhase", phaseToken: work.token });
        }
        game = new V3SyntheticMatchCoordinator({ mode: "reviewedLimited", reviewed: this.#reviewed, cards: this.#reviewed.cards,
          movement: board, progression, signingKey: this.#key, master: null });
      }
      this.#board = board; this.#decisions = decisions; this.#game = game;
    });
  }
  viewFor(actor: Seat) {
    ensureMove(actor === 0 || actor === 1, "v3-setup-viewer");
    return freezeMovement({ mode: "v3-reviewed-setup" as const, matchId: this.#board.matchId, revision: this.#revision, policy: REVIEWED_SETUP_POLICY.version,
      status: this.#game ? "ready" as const : this.#first === null ? "firstChoice" as const : "mulligan" as const,
      choicePlayer: this.#chooser, firstPlayer: this.#first, mulliganPlayer: this.#first === null || this.#game ? null : this.#decisions[this.#first] === null ? this.#first : (1 - this.#first) as Seat,
      mulligans: [...this.#decisions], movement: projectV3Movement(this.#board, actor) });
  }
  gameForServer(): V3SyntheticMatchCoordinator { ensureMove(this.#game, "v3-setup-not-ready"); return this.#game; }
  toJSON(): never { throw new Error("v3-setup-private-state"); }
}
