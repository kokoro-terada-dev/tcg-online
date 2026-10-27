import { randomInt, randomUUID } from "node:crypto";
import type { CardKind, CardView, DeckInput, MatchView, Zone } from "./protocol";

type Card = { id: string; cardId: string; kind: CardKind; rotated: boolean; faceUp: boolean };
type Player = { zones: Record<Zone, (Card | null)[]> };
export type Match = {
  id: string; revision: number; players: [Player, Player];
  processed: Map<string, number>;
};
const zones: Zone[] = ["hand", "deck", "life", "trash", "public", "character", "stage", "leader", "donDeck", "activeDon", "restDon"];
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const isId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 100 && !/[\x00-\x1f]/.test(value);

export function parseDeck(value: unknown): DeckInput | null {
  if (!isObject(value) || typeof value.name !== "string" || !value.name.trim() || value.name.length > 120 ||
    !isId(value.leaderCardId) || !Array.isArray(value.mainDeck) || value.mainDeck.length !== 50 ||
    !value.mainDeck.every(isId) || !Array.isArray(value.donDeck) || value.donDeck.length !== 10 ||
    !value.donDeck.every(isId) || !isObject(value.cardTypes) ||
    typeof value.leaderLifeCount !== "number" || !Number.isInteger(value.leaderLifeCount) || value.leaderLifeCount < 1 || value.leaderLifeCount > 10) return null;
  const cardTypes: Record<string, CardKind> = {};
  for (const id of value.mainDeck) {
    const kind = value.cardTypes[id];
    if (kind !== "character" && kind !== "stage" && kind !== "event") return null;
    Object.defineProperty(cardTypes, id, { value: kind, enumerable: true });
  }
  return { name: value.name.trim(), leaderCardId: value.leaderCardId, mainDeck: [...value.mainDeck], donDeck: [...value.donDeck], cardTypes, leaderLifeCount: value.leaderLifeCount };
}

function createPlayer(deck: DeckInput): Player {
  const create = (cardId: string, kind: CardKind): Card => ({ id: randomUUID(), cardId, kind, rotated: false, faceUp: false });
  const main = deck.mainDeck.map((id) => create(id, deck.cardTypes[id] ?? "character"));
  for (let i = main.length - 1; i > 0; i--) { const j = randomInt(i + 1); [main[i], main[j]] = [main[j]!, main[i]!]; }
  const hand = main.splice(0, 5).map((card) => ({ ...card, faceUp: true }));
  const life = main.splice(0, deck.leaderLifeCount);
  const leader = { ...create(deck.leaderCardId, "leader"), faceUp: true };
  return { zones: { hand, deck: main, life, leader: [leader], character: Array(5).fill(null), stage: [null], trash: [], public: [], donDeck: deck.donDeck.map((id) => ({ ...create(id, "don"), faceUp: true })), activeDon: [], restDon: [] } };
}

export function createMatch(host: DeckInput, guest: DeckInput): Match {
  return { id: randomUUID(), revision: 0, players: [createPlayer(host), createPlayer(guest)], processed: new Map() };
}

export function projectMatch(match: Match, viewer: 0 | 1): MatchView {
  const players = match.players.map((player, owner) => ({ zones: Object.fromEntries(zones.map((zone) => [zone, player.zones[zone].map((card): CardView | null => {
    if (!card) return null;
    const visible = zone === "donDeck" || zone === "activeDon" || zone === "restDon" || zone === "leader" ||
      (zone === "hand" ? owner === viewer : zone !== "deck" && card.faceUp);
    return { id: card.id, cardId: visible ? card.cardId : null, kind: visible ? card.kind : null, rotated: card.rotated, faceUp: visible };
  })])) as MatchView["players"][number]["zones"] }));
  return { matchId: match.id, revision: match.revision, localPlayerIndex: viewer, players: players as MatchView["players"] };
}

export function applyCommand(match: Match, actor: 0 | 1, value: unknown): string | null {
  if (!isObject(value) || value.matchId !== match.id || !isId(value.requestId) || typeof value.expectedRevision !== "number" || !Number.isInteger(value.expectedRevision)) return "操作形式が正しくありません";
  const key = `${actor}:${value.requestId}`;
  if (match.processed.has(key)) return null;
  if (value.expectedRevision !== match.revision) return "盤面が更新されました。もう一度操作してください";
  const player = match.players[actor];
  if (value.kind === "draw") {
    const card = player.zones.deck.shift();
    if (!card) return "山札がありません";
    player.zones.hand.push({ ...card, faceUp: true, rotated: false });
  } else {
    if (typeof value.from !== "string" || !zones.includes(value.from as Zone) || !isId(value.cardInstanceId)) return "移動元が正しくありません";
    const from = value.from as Zone;
    const source = player.zones[from];
    const index = source.findIndex((card) => card?.id === value.cardInstanceId);
    const card = source[index];
    if (!card) return "自分のカードを選択してください";
    if (value.kind === "rotate") {
      if (from !== "leader" && from !== "character" && from !== "stage") return "このカードはレストできません";
      card.rotated = !card.rotated;
    } else if (value.kind === "move") {
      if (typeof value.to !== "string" || !zones.includes(value.to as Zone)) return "移動先が正しくありません";
      const to = value.to as Zone;
      if (from === "leader" || to === "leader" || from === to) return "その場所へは移動できません";
      const donZones: Zone[] = ["donDeck", "activeDon", "restDon"];
      if (donZones.includes(to) !== (card.kind === "don")) return "カードと移動先の種類が合いません";
      if (to === "character" && card.kind !== "character") return "キャラクターだけ登場できます";
      if (to === "stage" && card.kind !== "stage") return "ステージだけ配置できます";
      let slot = -1;
      if (to === "character" || to === "stage") {
        if (value.slotIndex !== undefined && (typeof value.slotIndex !== "number" || !Number.isInteger(value.slotIndex))) return "枠が正しくありません";
        slot = value.slotIndex === undefined ? player.zones[to].findIndex((item) => item === null) : value.slotIndex as number;
        if (slot < 0 || slot >= player.zones[to].length || player.zones[to][slot]) return "空いている枠がありません";
      }
      if (from === "character" || from === "stage") source[index] = null; else source.splice(index, 1);
      const moved = { ...card, rotated: to === "restDon", faceUp: to !== "deck" && to !== "life" };
      if (slot >= 0) player.zones[to][slot] = moved;
      else if (to === "hand") player.zones.hand.push(moved);
      else player.zones[to].unshift(moved);
    } else return "未対応の操作です";
  }
  match.revision++;
  match.processed.set(key, match.revision);
  if (match.processed.size > 256) match.processed.delete(match.processed.keys().next().value!);
  return null;
}
