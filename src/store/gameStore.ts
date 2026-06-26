import { create } from "zustand";

import type {
  CardData,
  PlayerState,
} from "../types/card";

import { getDonImageUrl } from "../utils/localCardImages";

type DonAreaKey =
  | "donDeck"
  | "activeDon"
  | "restDon";

type SelectedDonStack = {
  playerIndex: number;
  fromArea: DonAreaKey;
  count: number;
} | null;

export type OnlineDeckOrderPayload = {
  player1MainDeckNames: string[];
  player2MainDeckNames: string[];
};

export type MulliganAction = "keep" | "mulligan";

export type CommunicationMode = "voice" | "silent";

export type MulliganResultPayload = {
  playerIndex: 0 | 1;
  action: MulliganAction;
  handOrder: string[];
  deckOrder: string[];
};

export type QuickActionType =
  | "attack"
  | "target"
  | "target1"
  | "target2"
  | "target3"
  | "effect"
  | "characterEffect"
  | "leaderEffect"
  | "stageEffect"
  | "processing"
  | "confirmRequest"
  | "confirmed"
  | "note"
  | "rest"
  | "active"
  | "block"
  | "counter"
  | "event"
  | "trigger"
  | "life"
  | "donPlus"
  | "donMinus"
  | "ok"
  | "wait"
  | "thinking"
  | "takeHit"
  | "endTurn"
  | "clearTarget"
  | "cancel"
  | "custom";

export type ActionLog = {
  id: string;
  playerIndex: 0 | 1;
  actionType: QuickActionType;
  message?: string;
  createdAt: number;
};

export type AttackTarget = {
  playerIndex: 0 | 1;
  cardId: string;
} | null;

export type CardMarkerType =
  | "attackSource"
  | "attackTarget"
  | "target1"
  | "target2"
  | "target3"
  | "effect"
  | "processing"
  | "confirmRequest"
  | "confirmed"
  | "note"
  | "trigger";

export type CardMarker = {
  id: string;
  playerIndex: 0 | 1;
  cardId: string;
  markerType: CardMarkerType;
  createdBy: 0 | 1;
  createdAt: number;
};

export type CardEffectSignal = {
  playerIndex: 0 | 1;
  cardId: string;
  nonce: number;
  label?: string;
  background?: string;
  color?: string;
} | null;

export type CounterPhase = {
  playerIndex: 0 | 1;
  targetCardId: string;
  targetArea: "leader" | "character";
  targetIndex: number;
  power: number;
  counterPlayerConfirmed?: boolean;
} | null;

export type DamagePhase = {
  playerIndex: 0 | 1;
  sourcePlayerIndex: 0 | 1;
  sourceCardId: string;
  targetCardId: string;
  lifeIndex: number;
} | null;

export type PublicAreaHighlight = {
  playerIndex: 0 | 1;
  nonce: number;
} | null;

type PlayersSnapshot = [PlayerState, PlayerState];

const MAX_HISTORY_COUNT = 30;

function clonePlayers(
  players: [PlayerState, PlayerState]
): PlayersSnapshot {
  return JSON.parse(JSON.stringify(players)) as PlayersSnapshot;
}

function isSamePlayers(
  before: PlayersSnapshot,
  after: [PlayerState, PlayerState]
): boolean {
  return JSON.stringify(before) === JSON.stringify(after);
}

function shuffle<T>(array: T[]): T[] {
  const copied = [...array];

  for (let i = copied.length - 1; i > 0; i--) {
    const j = Math.floor(
      Math.random() * (i + 1)
    );

    [copied[i], copied[j]] = [
      copied[j],
      copied[i],
    ];
  }

  return copied;
}

function shuffleCards(cards: CardData[]) {
  const result = [...cards];

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));

    const temp = result[i];
    result[i] = result[j];
    result[j] = temp;
  }

  return result;
}

function createPlayer(
  deck: CardData[]
): PlayerState {
  const leader =
    deck.find((x) => x.type === "leader") ||
    null;

  const mainDeck = shuffle(
    deck.filter((x) => x.type !== "leader" && x.type !== "don")
  );

  const donCards = deck
    .filter((x) => x.type === "don")
    .map((card) => ({
      ...card,
      rotated: false,
      attachedDonCount: 0,
      isFaceUp: true,
    }));

  const lifeCount = leader?.lifeCount ?? 5;

  const life = mainDeck.splice(0, lifeCount);

  const hand = mainDeck.splice(0, 5);

  return {
    hand,

    deck: mainDeck,

    trash: [],

    publicCards: [],
    counterCards: [],

    life,

    leader,

    stage: null,

    characters: [
      null,
      null,
      null,
      null,
      null,
    ],

    donDeck: donCards,

    activeDons: [],

    restDons: [],
  };
}

function getMainDeckCards(deck: CardData[]) {
  return deck.filter(
    (x) => x.type !== "leader" && x.type !== "don"
  );
}

function orderCardsByNames(
  cards: CardData[],
  orderedNames: string[]
) {
  if (cards.length !== orderedNames.length) {
    throw new Error("同期されたカード枚数が一致しません。");
  }

  const cardMap = new Map<string, CardData[]>();

  for (const card of cards) {
    const mappedCards = cardMap.get(card.name) ?? [];
    mappedCards.push(card);
    cardMap.set(card.name, mappedCards);
  }

  return orderedNames.map((name) => {
    const mappedCards = cardMap.get(name);

    if (!mappedCards || mappedCards.length === 0) {
      throw new Error(`同期されたカード ${name} がローカルデッキに存在しません。`);
    }

    return mappedCards.shift()!;
  });
}

function orderMainDeckCards(
  deck: CardData[],
  orderedNames: string[]
) {
  const mainDeck = getMainDeckCards(deck);

  return orderCardsByNames(
    mainDeck,
    orderedNames
  );
}

function createPlayerWithMainDeckOrder(
  deck: CardData[],
  orderedNames: string[]
): PlayerState {
  const leader =
    deck.find((x) => x.type === "leader") ||
    null;

  const mainDeck = orderMainDeckCards(
    deck,
    orderedNames
  );

  const donCards = deck
    .filter((x) => x.type === "don")
    .map((card) => ({
      ...card,
      rotated: false,
      attachedDonCount: 0,
      isFaceUp: true,
    }));

  const lifeCount = leader?.lifeCount ?? 5;

  const life = mainDeck.splice(0, lifeCount);

  const hand = mainDeck.splice(0, 5).map((card) => ({
    ...card,
    isFaceUp: true,
    rotated: false,
  }));

  return {
    hand,

    deck: mainDeck,

    trash: [],

    publicCards: [],
    counterCards: [],

    life,

    leader,

    stage: null,

    characters: [
      null,
      null,
      null,
      null,
      null,
    ],

    donDeck: donCards,

    activeDons: [],

    restDons: [],
  };
}

function createOnlineDeckOrder(
  player1Deck: CardData[],
  player2Deck: CardData[]
): OnlineDeckOrderPayload {
  return {
    player1MainDeckNames: shuffleCards(
      getMainDeckCards(player1Deck)
    ).map((card) => card.name),
    player2MainDeckNames: shuffleCards(
      getMainDeckCards(player2Deck)
    ).map((card) => card.name),
  };
}

interface MoveParams {
  playerIndex: number;

  cardId: string;

  from:
  | "hand"
  | "character"
  | "stage"
  | "public"
  | "counter"
  | "trash"
  | "life"
  | "deck";

  to:
  | "hand"
  | "character"
  | "stage"
  | "public"
  | "counter"
  | "trash"
  | "life"
  | "deck";

  slotIndex?: number;
}

interface GameState {
  players: [PlayerState, PlayerState];

  isStarted: boolean;

  localPlayerIndex: 0 | 1 | null;

  communicationMode: CommunicationMode;

  mulliganWaiting: boolean;

  turnOrderSelectionPending: boolean;

  turnOrderDecider: 0 | 1 | null;

  firstPlayerIndex: 0 | 1 | null;

  actionLogs: ActionLog[];

  currentAttackSource: AttackTarget;

  currentAttackTarget: AttackTarget;

  pendingAttackPlayerIndex: 0 | 1 | null;

  cardMarkers: CardMarker[];

  cardEffectSignal: CardEffectSignal;

  counterPhase: CounterPhase;

  damagePhase: DamagePhase;

  publicAreaHighlight: PublicAreaHighlight;

  addActionLog: (log: ActionLog) => void;

  setAttackTarget: (
    target: AttackTarget,
    log?: ActionLog
  ) => void;

  setAttackSource: (
    source: AttackTarget,
    log?: ActionLog
  ) => void;

  startAttack: (
    playerIndex: 0 | 1,
    cardId: string,
    log: ActionLog
  ) => void;

  clearAttackTarget: () => void;

  clearAttackState: () => void;

  setCardMarker: (
    marker: Omit<CardMarker, "id" | "createdAt">,
    log?: ActionLog
  ) => void;

  clearCardMarkers: () => void;

  showCardEffect: (
    signal: Exclude<CardEffectSignal, null>
  ) => void;

  clearCardEffect: () => void;

  startCounterPhase: (
    phase: Exclude<CounterPhase, null>
  ) => void;

  adjustCounterPower: (
    amount: number
  ) => void;

  cancelCounterPhase: () => void;

  submitCounterPhase: () => void;

  confirmCounterPhase: () => void;

  startDamagePhase: (
    phase: Exclude<DamagePhase, null>
  ) => void;

  moveDamageLifeToHand: () => void;

  triggerDamageLife: () => void;

  clearDamagePhase: () => void;

  highlightPublicArea: (
    playerIndex: 0 | 1
  ) => void;

  clearActionLogs: () => void;

  setLocalPlayerIndex: (
    playerIndex: 0 | 1
  ) => void;

  setCommunicationMode: (
    communicationMode: CommunicationMode
  ) => void;

  finishOnlineMulligan: () => void;

  setTurnOrderDecider: (
    playerIndex: 0 | 1
  ) => void;

  confirmTurnOrder: (
    firstPlayerIndex: 0 | 1
  ) => void;

  startGame: (
    player1Deck: CardData[],
    player2Deck: CardData[]
  ) => void;

  createOnlineDeckOrder: (
    player1Deck: CardData[],
    player2Deck: CardData[]
  ) => OnlineDeckOrderPayload;

  startGameWithDeckOrders: (
    player1Deck: CardData[],
    player2Deck: CardData[],
    deckOrder: OnlineDeckOrderPayload
  ) => void;

  drawCard: (
    playerIndex: number
  ) => void;

  toggleRotate: (
    playerIndex: number,
    cardId: string
  ) => void;

  setCardRotated: (
    playerIndex: number,
    cardId: string,
    rotated: boolean
  ) => void;

  moveCard: (
    params: MoveParams
  ) => void;

  removeDon: (
    playerIndex: number,
    targetCardId: string
  ) => void;

  moveListCardToHand: (
    playerIndex: number,
    from: "deck" | "trash" | "life",
    cardId: string
  ) => void;

  moveListCardToPublic: (
    playerIndex: number,
    from: "deck" | "trash" | "life",
    cardId: string
  ) => void;

  moveListCardToTrash: (
    playerIndex: number,
    from: "deck" | "trash" | "life",
    cardId: string
  ) => void;

  moveListCardToDeckBottom: (
    playerIndex: number,
    from: "deck" | "trash" | "life",
    cardId: string
  ) => void;

  refreshPlayer: (playerIndex: number) => void;

  moveListCardToLifeTop: (
    playerIndex: number,
    from: "deck" | "trash" | "life",
    cardId: string
  ) => void;

  toggleCardFace: (
    playerIndex: number,
    cardId: string
  ) => void;

  openTopDeckCards: (
    playerIndex: number,
    count: number
  ) => void;

  changePower: (
    playerIndex: number,
    cardId: string,
    amount: number
  ) => void;

  changeCountModifier: (
    playerIndex: number,
    cardId: string,
    amount: number
  ) => void;

  setStatusLabel: (
    playerIndex: number,
    cardId: string,
    label: string
  ) => void;

  resetToDeckSelect: () => void;

  mulliganPlayerIndex: 0 | 1 | null;

  mulligan: (playerIndex: 0 | 1) => MulliganResultPayload;

  keepHand: (playerIndex: 0 | 1) => MulliganResultPayload;

  applyOnlineMulliganResult: (
    result: MulliganResultPayload
  ) => void;

  takeDonFromDeckToActive: (
    playerIndex: number
  ) => void;

  takeDonFromDeckToRest: (
    playerIndex: number
  ) => void;

  moveActiveDonToRest: (
    playerIndex: number
  ) => void;

  moveRestDonToActive: (
    playerIndex: number
  ) => void;

  attachDonFromArea: (
    playerIndex: number,
    donCardId: string,
    fromArea: "activeDon" | "restDon",
    targetCardId: string
  ) => void;

  returnAttachedDonToActive: (
    playerIndex: number,
    targetCardId: string
  ) => void;

  returnAttachedDonToRest: (
    playerIndex: number,
    targetCardId: string
  ) => void;

  returnAttachedDonToDeck: (
    playerIndex: number,
    targetCardId: string
  ) => void;

  moveDonBetweenAreas: (
    playerIndex: number,
    cardId: string,
    fromArea: "donDeck" | "activeDon" | "restDon",
    toArea: "donDeck" | "activeDon" | "restDon"
  ) => void;

  reorderZoneCards: (
    playerIndex: number,
    zone: "deck" | "life" | "trash",
    activeId: string,
    overId: string
  ) => void;

  selectedDonStack: SelectedDonStack;

  selectDonStack: (
    playerIndex: number,
    fromArea: DonAreaKey
  ) => void;

  clearSelectedDonStack: () => void;

  moveSelectedDonStack: (
    toArea: DonAreaKey
  ) => void;

  attachSelectedDonStack: (
    targetCardId: string
  ) => void;

  returnAttachedDonsToRest: (
    playerIndex: number,
    cardId: string
  ) => void;

  undoHistory: PlayersSnapshot[];

  turnStartSnapshot: PlayersSnapshot | null;

  undoLastAction: () => void;

  saveTurnStartSnapshot: () => void;

  returnToTurnStart: () => void;

  resetGameToMulligan: () => void;
}

export const useGameStore =
  create<GameState>((set, get) => {
    const setWithHistory = (
      updater: (state: GameState) => Partial<GameState>
    ) => {
      set((state) => {
        const beforePlayers = clonePlayers(state.players);

        const result = updater(state);

        const afterPlayers = result.players ?? state.players;

        if (isSamePlayers(beforePlayers, afterPlayers)) {
          return result;
        }

        return {
          ...result,
          undoHistory: [
            beforePlayers,
            ...state.undoHistory,
          ].slice(0, MAX_HISTORY_COUNT),
        };
      });
    };

    return ({
      players: [
        createPlayer([]),
        createPlayer([]),
      ],

      isStarted: false,

      localPlayerIndex: null,

      communicationMode: "voice",

      mulliganWaiting: false,

      turnOrderSelectionPending: false,

      turnOrderDecider: null,

      firstPlayerIndex: null,

      actionLogs: [],

      currentAttackSource: null,

      currentAttackTarget: null,

      pendingAttackPlayerIndex: null,

      cardMarkers: [],

      cardEffectSignal: null,

      counterPhase: null,

      damagePhase: null,

      publicAreaHighlight: null,

      addActionLog: (log) =>
        set((state) => ({
          actionLogs: [...state.actionLogs, log],
        })),

      setAttackSource: (source, log) =>
        set((state) => ({
          currentAttackSource: source,
          currentAttackTarget: source
            ? null
            : state.currentAttackTarget,
          cardMarkers: source
            ? [
              ...state.cardMarkers.filter(
                (marker) =>
                  marker.markerType !== "attackSource" &&
                  marker.markerType !== "attackTarget"
              ),
              {
                id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                playerIndex: source.playerIndex,
                cardId: source.cardId,
                markerType: "attackSource",
                createdBy: source.playerIndex,
                createdAt: Date.now(),
              },
            ]
            : state.cardMarkers.filter(
              (marker) =>
                marker.markerType !== "attackSource" &&
                marker.markerType !== "attackTarget"
            ),
          actionLogs: log
            ? [...state.actionLogs, log]
            : state.actionLogs,
        })),

      startAttack: (playerIndex, cardId, log) =>
        setWithHistory((state) => {
          const players = [
            ...state.players,
          ] as [PlayerState, PlayerState];
          const player = players[playerIndex];
          const attackCard = [
            player.leader,
            ...player.characters,
          ].find((item) => item?.id === cardId);

          if (!attackCard) {
            return { players };
          }

          attackCard.rotated = true;

          return {
            players,
            currentAttackSource: {
              playerIndex,
              cardId,
            },
            currentAttackTarget: null,
            cardMarkers: [
              ...state.cardMarkers.filter(
                (marker) =>
                  marker.markerType !== "attackSource" &&
                  marker.markerType !== "attackTarget"
              ),
              {
                id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                playerIndex,
                cardId,
                markerType: "attackSource",
                createdBy: playerIndex,
                createdAt: Date.now(),
              },
            ],
            actionLogs: [...state.actionLogs, log],
          };
        }),

      setAttackTarget: (target, log) =>
        set((state) => ({
          currentAttackTarget: target,
          cardMarkers: target
            ? [
              ...state.cardMarkers.filter(
                (marker) => marker.markerType !== "attackTarget"
              ),
              {
                id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                playerIndex: target.playerIndex,
                cardId: target.cardId,
                markerType: "attackTarget",
                createdBy: target.playerIndex,
                createdAt: Date.now(),
              },
            ]
            : state.cardMarkers.filter(
              (marker) => marker.markerType !== "attackTarget"
            ),
          actionLogs: log
            ? [...state.actionLogs, log]
            : state.actionLogs,
        })),

      clearAttackTarget: () =>
        set(() => ({
          currentAttackTarget: null,
          cardMarkers: get().cardMarkers.filter(
            (marker) => marker.markerType !== "attackTarget"
          ),
        })),

      clearAttackState: () =>
        set(() => ({
          currentAttackSource: null,
          currentAttackTarget: null,
          pendingAttackPlayerIndex: null,
          cardMarkers: get().cardMarkers.filter(
            (marker) =>
              marker.markerType !== "attackSource" &&
              marker.markerType !== "attackTarget"
          ),
        })),

      setCardMarker: (marker, log) =>
        set((state) => {
          const uniqueMarkerTypes: CardMarkerType[] = [
            "attackSource",
            "attackTarget",
            "target1",
            "target2",
            "target3",
          ];
          const nextMarkers = state.cardMarkers.filter(
            (item) => {
              if (
                uniqueMarkerTypes.includes(marker.markerType) &&
                item.markerType === marker.markerType
              ) {
                return false;
              }

              return !(
                item.playerIndex === marker.playerIndex &&
                item.cardId === marker.cardId &&
                item.markerType === marker.markerType
              );
            }
          );

          if (marker.markerType === "confirmed") {
            for (let i = nextMarkers.length - 1; i >= 0; i--) {
              const item = nextMarkers[i];
              if (
                item.playerIndex === marker.playerIndex &&
                item.cardId === marker.cardId &&
                item.markerType === "confirmRequest"
              ) {
                nextMarkers.splice(i, 1);
              }
            }
          }

          return {
            cardMarkers: [
              ...nextMarkers,
              {
                ...marker,
                id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                createdAt: Date.now(),
              },
            ],
            actionLogs: log
              ? [...state.actionLogs, log]
              : state.actionLogs,
          };
        }),

      clearCardMarkers: () =>
        set(() => ({
          cardMarkers: [],
        })),

      showCardEffect: (signal) =>
        set(() => ({
          cardEffectSignal: signal,
        })),

      clearCardEffect: () =>
        set(() => ({
          cardEffectSignal: null,
        })),

      startCounterPhase: (phase) =>
        set(() => ({
          counterPhase: {
            ...phase,
            counterPlayerConfirmed: false,
          },
          damagePhase: null,
        })),

      adjustCounterPower: (amount) =>
        set((state) => ({
          counterPhase: state.counterPhase
            ? {
              ...state.counterPhase,
              power: state.counterPhase.power + amount,
            }
            : null,
        })),

      cancelCounterPhase: () =>
        setWithHistory((state) => {
          const phase = state.counterPhase;

          if (!phase) {
            return {};
          }

          const players = [...state.players] as [
            PlayerState,
            PlayerState
          ];
          const player = players[phase.playerIndex];

          player.hand.push(...player.counterCards);
          player.counterCards = [];

          return {
            players,
            counterPhase: null,
          };
        }),

      submitCounterPhase: () =>
        set((state) => ({
          counterPhase: state.counterPhase
            ? {
              ...state.counterPhase,
              counterPlayerConfirmed: true,
            }
            : null,
        })),

      confirmCounterPhase: () =>
        setWithHistory((state) => {
          const phase = state.counterPhase;

          if (!phase) {
            return {};
          }

          const players = [...state.players] as [
            PlayerState,
            PlayerState
          ];
          const player = players[phase.playerIndex];

          player.trash.unshift(
            ...player.counterCards.map((card) => ({
              ...card,
              isFaceUp: true,
              rotated: false,
            }))
          );
          player.counterCards = [];

          return {
            players,
            counterPhase: null,
          };
        }),

      startDamagePhase: (phase) =>
        set(() => ({
          damagePhase: phase,
          counterPhase: null,
        })),

      moveDamageLifeToHand: () =>
        setWithHistory((state) => {
          const phase = state.damagePhase;

          if (!phase) {
            return {};
          }

          const players = [...state.players] as [
            PlayerState,
            PlayerState
          ];
          const player = players[phase.playerIndex];
          const index = phase.lifeIndex;

          if (index < 0 || index >= player.life.length) {
            return {
              players,
              damagePhase: null,
            };
          }

          const card = player.life.splice(index, 1)[0];
          card.rotated = false;
          card.isFaceUp = true;
          player.hand.push(card);

          return {
            players,
            damagePhase: null,
            currentAttackSource: null,
            currentAttackTarget: null,
            pendingAttackPlayerIndex: null,
            cardMarkers: state.cardMarkers.filter(
              (marker) =>
                marker.markerType !== "attackSource" &&
                marker.markerType !== "attackTarget"
            ),
            cardEffectSignal: null,
          };
        }),

      triggerDamageLife: () =>
        setWithHistory((state) => {
          const phase = state.damagePhase;

          if (!phase) {
            return {};
          }

          const players = [...state.players] as [
            PlayerState,
            PlayerState
          ];
          const player = players[phase.playerIndex];
          const index = phase.lifeIndex;

          if (index < 0 || index >= player.life.length) {
            return {
              players,
              damagePhase: null,
            };
          }

          const card = player.life.splice(index, 1)[0];
          card.rotated = false;
          card.isFaceUp = true;
          player.publicCards.unshift(card);
          const triggerMarker: CardMarker = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            playerIndex: phase.playerIndex,
            cardId: card.id,
            markerType: "trigger",
            createdBy: phase.playerIndex,
            createdAt: Date.now(),
          };

          return {
            players,
            damagePhase: null,
            currentAttackSource: null,
            currentAttackTarget: null,
            pendingAttackPlayerIndex: null,
            cardMarkers: state.cardMarkers.filter(
              (marker) =>
                marker.markerType !== "attackSource" &&
                marker.markerType !== "attackTarget"
            ).concat(triggerMarker),
            publicAreaHighlight: {
              playerIndex: phase.playerIndex,
              nonce: Date.now(),
            },
          };
        }),

      clearDamagePhase: () =>
        set(() => ({
          damagePhase: null,
        })),

      highlightPublicArea: (playerIndex) =>
        set(() => ({
          publicAreaHighlight: {
            playerIndex,
            nonce: Date.now(),
          },
        })),

      clearActionLogs: () =>
        set(() => ({
          actionLogs: [],
          currentAttackSource: null,
          currentAttackTarget: null,
          pendingAttackPlayerIndex: null,
          cardMarkers: [],
          cardEffectSignal: null,
          counterPhase: null,
          damagePhase: null,
        })),

      undoHistory: [],

      turnStartSnapshot: null,

      setLocalPlayerIndex: (
        playerIndex: 0 | 1
      ) =>
        set(() => ({
          localPlayerIndex: playerIndex,
        })),

      setCommunicationMode: (communicationMode) =>
        set(() => ({
          communicationMode,
          actionLogs:
            communicationMode === "voice" ? [] : get().actionLogs,
          currentAttackSource: null,
          currentAttackTarget: null,
          cardMarkers: [],
          cardEffectSignal: null,
          counterPhase: null,
          damagePhase: null,
        })),

      finishOnlineMulligan: () =>
        set(() => ({
          mulliganPlayerIndex: null,
          mulliganWaiting: false,
        })),

      setTurnOrderDecider: (playerIndex) =>
        set(() => ({
          turnOrderSelectionPending: true,
          turnOrderDecider: playerIndex,
          firstPlayerIndex: null,
          mulliganPlayerIndex: null,
          mulliganWaiting: false,
        })),

      confirmTurnOrder: (firstPlayerIndex) =>
        set(() => ({
          turnOrderSelectionPending: false,
          firstPlayerIndex,
          mulliganPlayerIndex: 0,
          mulliganWaiting: false,
        })),

      startGame: (
        player1Deck: CardData[],
        player2Deck: CardData[]
      ) =>
        set(() => ({
          players: [
            createPlayer(player1Deck),
            createPlayer(player2Deck),
          ],

          isStarted: true,

          localPlayerIndex: null,

          actionLogs: [],

          currentAttackSource: null,

          currentAttackTarget: null,

          pendingAttackPlayerIndex: null,

          cardMarkers: [],

          cardEffectSignal: null,

          counterPhase: null,

          damagePhase: null,

          mulliganPlayerIndex: 0,
          mulliganWaiting: false,

          turnOrderSelectionPending: false,
          turnOrderDecider: null,
          firstPlayerIndex: null,

          undoHistory: [],

          turnStartSnapshot: null,
        })),

      createOnlineDeckOrder: (
        player1Deck: CardData[],
        player2Deck: CardData[]
      ) =>
        createOnlineDeckOrder(
          player1Deck,
          player2Deck
        ),

      startGameWithDeckOrders: (
        player1Deck: CardData[],
        player2Deck: CardData[],
        deckOrder: OnlineDeckOrderPayload
      ) =>
        set(() => ({
          players: [
            createPlayerWithMainDeckOrder(
              player1Deck,
              deckOrder.player1MainDeckNames
            ),
            createPlayerWithMainDeckOrder(
              player2Deck,
              deckOrder.player2MainDeckNames
            ),
          ],

          isStarted: true,

          actionLogs: [],

          currentAttackSource: null,

          currentAttackTarget: null,

          pendingAttackPlayerIndex: null,

          cardMarkers: [],

          cardEffectSignal: null,

          counterPhase: null,

          damagePhase: null,

          mulliganPlayerIndex: null,
          mulliganWaiting: false,

          turnOrderSelectionPending: false,
          turnOrderDecider: null,
          firstPlayerIndex: null,

          undoHistory: [],

          turnStartSnapshot: null,
        })),

      drawCard: (
        playerIndex: number
      ) =>
        setWithHistory((state) => {
          const players = [
            ...state.players,
          ] as [
              PlayerState,
              PlayerState
            ];

          const player =
            players[playerIndex];

          const card =
            player.deck.shift();

          if (card) {
            player.hand.push(card);
          }

          return { players };
        }),

      toggleRotate: (
        playerIndex: number,
        cardId: string
      ) =>
        setWithHistory((state) => {
          const players = [
            ...state.players,
          ] as [PlayerState, PlayerState];

          const player = players[playerIndex];

          const allCards: CardData[] = [
            ...player.hand,
            ...player.deck,
            ...player.trash,
            ...player.publicCards,
            ...player.counterCards,
            ...player.life,
            ...player.activeDons,
            ...player.restDons,
            ...player.characters.filter(
              (x): x is CardData => x !== null
            ),
            ...(player.leader ? [player.leader] : []),
            ...(player.stage ? [player.stage] : []),
          ];

          const card = allCards.find(
            (x) => x.id === cardId
          );

          if (card) {
            card.rotated = !card.rotated;
          }

          return { players };
        }),

      setCardRotated: (
        playerIndex: number,
        cardId: string,
        rotated: boolean
      ) =>
        setWithHistory((state) => {
          const players = [
            ...state.players,
          ] as [PlayerState, PlayerState];
          const player = players[playerIndex];
          const allCards: CardData[] = [
            ...player.hand,
            ...player.deck,
            ...player.trash,
            ...player.publicCards,
            ...player.counterCards,
            ...player.life,
            ...player.activeDons,
            ...player.restDons,
            ...player.characters.filter(
              (item): item is CardData => item !== null
            ),
            ...(player.leader ? [player.leader] : []),
            ...(player.stage ? [player.stage] : []),
          ];
          const targetCard = allCards.find(
            (item) => item.id === cardId
          );

          if (targetCard) {
            targetCard.rotated = rotated;
          }

          return { players };
        }),

      moveCard: ({
        playerIndex,
        cardId,
        from,
        to,
        slotIndex,
      }: MoveParams) =>
        setWithHistory((state) => {
          const players = [
            ...state.players,
          ] as [
              PlayerState,
              PlayerState
            ];

          const player =
            players[playerIndex];

          const movableSources = [
            "hand",
            "character",
            "stage",
            "public",
            "counter",
            "trash",
            "life",
            "deck",
          ];

          const movableTargets = [
            "hand",
            "character",
            "stage",
            "public",
            "counter",
            "trash",
            "life",
            "deck",
          ];

          if (
            !movableSources.includes(from) ||
            !movableTargets.includes(to)
          ) {
            return { players };
          }
          // キャラクター枠が埋まっている場合は移動しない
          if (
            to === "character" &&
            slotIndex !== undefined &&
            player.characters[slotIndex]
          ) {
            return { players };
          }

          // ステージが埋まっている場合は移動しない
          if (to === "stage" && player.stage) {
            return { players };
          }

          // キャラクター枠埋まりチェック
          if (
            to === "character" &&
            slotIndex !== undefined &&
            player.characters[
            slotIndex
            ]
          ) {
            return { players };
          }

          let card:
            | CardData
            | undefined;

          if (from === "hand") {
            const index =
              player.hand.findIndex(
                (x) =>
                  x.id === cardId
              );

            if (index !== -1) {
              card =
                player.hand[index];

              player.hand.splice(
                index,
                1
              );
            }
          }

          if (from === "trash") {
            const index =
              player.trash.findIndex(
                (x) =>
                  x.id === cardId
              );

            if (index !== -1) {
              card =
                player.trash[index];

              player.trash.splice(
                index,
                1
              );
            }
          }

          if (from === "public") {
            const index =
              player.publicCards.findIndex(
                (x) =>
                  x.id === cardId
              );

            if (index !== -1) {
              card =
                player.publicCards[index];

              player.publicCards.splice(
                index,
                1
              );
            }
          }

          if (from === "counter") {
            const index =
              player.counterCards.findIndex(
                (x) =>
                  x.id === cardId
              );

            if (index !== -1) {
              card =
                player.counterCards[index];

              player.counterCards.splice(
                index,
                1
              );
            }
          }

          if (from === "life") {
            const index =
              player.life.findIndex(
                (x) =>
                  x.id === cardId
              );

            if (index !== -1) {
              card =
                player.life[index];

              player.life.splice(
                index,
                1
              );
            }
          }

          if (from === "deck") {
            const index =
              player.deck.findIndex(
                (x) =>
                  x.id === cardId
              );

            if (index !== -1) {
              card =
                player.deck[index];

              player.deck.splice(
                index,
                1
              );
            }
          }

          if (
            from === "character"
          ) {
            const index =
              player.characters.findIndex(
                (x) =>
                  x?.id === cardId
              );

            if (index !== -1) {
              card =
                player.characters[
                index
                ] || undefined;

              player.characters[
                index
              ] = null;
            }
          }
          if (from === "stage") {
            card = player.stage || undefined;

            player.stage = null;
          }

          if (!card) {
            return { players };
          }
          // 手札・盤面は表
          if (
            to === "hand" ||
            to === "counter" ||
            to === "character" ||
            to === "stage"
          ) {
            card.isFaceUp = true;
          }

          if (to === "deck") {
            card.isFaceUp = false;
          }

          if (to === "life") {
            card.isFaceUp = false;
          }

          // トラッシュは表
          if (to === "trash") {
            card.isFaceUp = true;
          }

          // 移動先が手札・トラッシュ・ライフ・デッキの場合は縦向きに戻す
          if (
            to === "hand" ||
            to === "trash" ||
            to === "public" ||
            to === "counter" ||
            // to === "life" ||
            to === "deck"
          ) {
            card.rotated = false;
          }

          // キャラクターがトラッシュへ移動する場合、付与DONを横向きでドンエリアに戻す
          if (
            from === "character" &&
            (to === "trash" || to === "hand") &&
            card.attachedDonCount > 0
          ) {
            const donCount = card.attachedDonCount;

            card.attachedDonCount = 0;

            for (let i = 0; i < donCount; i++) {
              player.restDons.unshift({
                id: Math.random().toString(36).slice(2),
                name: "DON",
                image: getDonImageUrl(),
                type: "don",
                rotated: true,
                attachedDonCount: 0,
                isFaceUp: true,
              });
            }
          }
          // キャラクターエリアを離れる時は状態リセット
          if (from === "character") {
            card.powerModifier = 0;
            card.countModifier = 0;

            card.statusLabel = undefined;
          }

          if (to === "stage") {
            player.stage = card;
          }

          if (to === "hand") {
            player.hand.push(card);
          }

          if (to === "trash") {
            player.trash.unshift(card);
          }

          if (to === "public") {
            card.rotated = false;
            card.isFaceUp =
              state.communicationMode === "silent";
            player.publicCards.unshift(card);
          }

          if (to === "counter") {
            card.rotated = false;
            card.isFaceUp = true;
            player.counterCards.push(card);
          }

          if (to === "life") {
            player.life.unshift(card);
          }

          if (to === "deck") {
            player.deck.unshift(card);
          }

          if (
            to === "character" &&
            slotIndex !== undefined
          ) {
            player.characters[
              slotIndex
            ] = card;
          }

          const sourceMovedOffBoard =
            state.currentAttackSource?.playerIndex === playerIndex &&
            state.currentAttackSource.cardId === cardId &&
            (
              (from === "character" && to !== "character") ||
              (from === "public" && to !== "public")
            );
          const targetMovedOffBoard =
            state.currentAttackTarget?.playerIndex === playerIndex &&
            state.currentAttackTarget.cardId === cardId &&
            from === "character" &&
            to !== "character";
          const markerCanRemain =
            (from === "character" && to === "character") ||
            (from === "stage" && to === "stage") ||
            (from === "public" && to === "public");

          return {
            players,
            cardMarkers: markerCanRemain
              ? state.cardMarkers
              : state.cardMarkers.filter(
                (marker) =>
                  !(
                    marker.playerIndex === playerIndex &&
                    marker.cardId === cardId
                  )
              ),
            currentAttackSource: sourceMovedOffBoard
              ? null
              : state.currentAttackSource,
            currentAttackTarget:
              sourceMovedOffBoard || targetMovedOffBoard
                ? null
                : state.currentAttackTarget,
          };
        }),


      removeDon: (
        playerIndex: number,
        targetCardId: string
      ) =>
        setWithHistory((state) => {
          const players = [
            ...state.players,
          ] as [
              PlayerState,
              PlayerState
            ];

          const player =
            players[playerIndex];

          const target = [
            ...player.characters.filter(
              Boolean
            ),

            player.leader,
          ].find(
            (x) =>
              x?.id === targetCardId
          );

          if (!target) {
            return { players };
          }

          if (
            target.attachedDonCount <=
            0
          ) {
            return { players };
          }

          target.attachedDonCount--;

          player.restDons.unshift({
            id: Math.random().toString(36).slice(2),
            name: "DON",
            image: getDonImageUrl(),
            type: "don",
            rotated: false,
            attachedDonCount: 0,
            isFaceUp: true,
          });

          return { players };
        }),

      moveListCardToHand: (
        playerIndex: number,
        from,
        cardId: string
      ) =>
        setWithHistory((state) => {
          const players = [
            ...state.players,
          ] as [
              PlayerState,
              PlayerState
            ];

          const player =
            players[playerIndex];

          const source =
            player[from];

          const index =
            source.findIndex(
              (x) =>
                x.id === cardId
            );

          if (index === -1) {
            return { players };
          }

          const card =
            source.splice(index, 1)[0];

          card.rotated = false;
          card.isFaceUp = true;
          player.hand.push(card);

          return { players };
        }),

      moveListCardToPublic: (
        playerIndex: number,
        from,
        cardId: string
      ) =>
        setWithHistory((state) => {
          const players = [
            ...state.players,
          ] as [
              PlayerState,
              PlayerState
            ];

          const player =
            players[playerIndex];

          const source =
            player[from];

          const index =
            source.findIndex(
              (x) =>
                x.id === cardId
            );

          if (index === -1) {
            return { players };
          }

          const card =
            source.splice(index, 1)[0];

          card.rotated = false;
          card.isFaceUp =
            state.communicationMode === "silent";

          player.publicCards.unshift(card);

          return { players };
        }),

      moveListCardToTrash: (
        playerIndex: number,
        from,
        cardId: string
      ) =>
        setWithHistory((state) => {
          const players = [
            ...state.players,
          ] as [
              PlayerState,
              PlayerState
            ];

          const player =
            players[playerIndex];

          const source =
            player[from];

          const index =
            source.findIndex(
              (x) =>
                x.id === cardId
            );

          if (index === -1) {
            return { players };
          }

          const card =
            source.splice(index, 1)[0];

          player.trash.unshift(card);

          return { players };
        }),

      moveListCardToDeckBottom: (
        playerIndex: number,
        from,
        cardId: string
      ) =>
        setWithHistory((state) => {
          const players = [
            ...state.players,
          ] as [
              PlayerState,
              PlayerState
            ];

          const player =
            players[playerIndex];

          const source =
            player[from];

          const index =
            source.findIndex(
              (x) =>
                x.id === cardId
            );

          if (index === -1) {
            return { players };
          }

          const card =
            source.splice(index, 1)[0];

          player.deck.push(card);

          return { players };
        }),

      refreshPlayer: (playerIndex: number) =>
        setWithHistory((state) => {
          const players = [...state.players] as [
            PlayerState,
            PlayerState
          ];

          const player = players[playerIndex];

          const targetCards = [
            player.leader,
            player.stage,
            ...player.characters.filter(Boolean),
          ].filter(Boolean) as CardData[];

          // REST DON はすべて ACTIVE DON へ
          player.activeDons = [
            ...player.restDons.map((don) => ({
              ...don,
              rotated: false,
            })),
            ...player.activeDons.map((don) => ({
              ...don,
              rotated: false,
            })),
          ];

          player.restDons = [];

          for (const card of targetCards) {
            card.rotated = false;

            // パワー補正リセット
            card.powerModifier = 0;
            card.countModifier = 0;

            // 付与DONはACTIVE DONへ戻す
            if (card.attachedDonCount > 0) {
              const count = card.attachedDonCount;

              card.attachedDonCount = 0;

              for (let i = 0; i < count; i++) {
                player.activeDons.unshift({
                  id: Math.random().toString(36).slice(2),
                  name: "DON",
                  image: getDonImageUrl(),
                  type: "don",
                  rotated: false,
                  attachedDonCount: 0,
                  isFaceUp: true,
                });
              }
            }
          }

          // 山札の上から1枚ドロー
          const drawCard = player.deck.shift();

          if (drawCard) {
            drawCard.isFaceUp = true;
            drawCard.rotated = false;
            player.hand.push(drawCard);
          }

          // DONデッキから2枚ACTIVE DONへ
          for (let i = 0; i < 2; i++) {
            const don = player.donDeck.shift();

            if (don) {
              don.rotated = false;
              player.activeDons.unshift(don);
            }
          }

          return {
            players,
            turnStartSnapshot: clonePlayers(players),
            actionLogs: [],
            currentAttackSource: null,
            currentAttackTarget: null,
            pendingAttackPlayerIndex: null,
            cardEffectSignal: null,
            counterPhase: null,
            damagePhase: null,
            turnOrderSelectionPending: false,
            turnOrderDecider: null,
            firstPlayerIndex: null,
          };
        }),

      moveListCardToLifeTop: (
        playerIndex: number,
        from,
        cardId: string
      ) =>
        setWithHistory((state) => {
          const players = [...state.players] as [
            PlayerState,
            PlayerState
          ];

          const player = players[playerIndex];

          const source = player[from];

          const index = source.findIndex(
            (x) => x.id === cardId
          );

          if (index === -1) {
            return { players };
          }

          const card = source.splice(index, 1)[0];

          card.rotated = false;
          card.isFaceUp = false;

          player.life.unshift(card);

          return { players };
        }),
      toggleCardFace: (
        playerIndex: number,
        cardId: string
      ) =>
        setWithHistory((state) => {
          const players = [...state.players] as [
            PlayerState,
            PlayerState
          ];

          const player = players[playerIndex];

          const allCards: CardData[] = [
            ...player.hand,

            ...player.deck,

            ...player.trash,

            ...player.publicCards,

            ...player.life,

            ...player.activeDons,

            ...player.restDons,

            ...player.characters.filter(
              (x): x is CardData => x !== null
            ),

            ...(player.leader
              ? [player.leader]
              : []),

            ...(player.stage
              ? [player.stage]
              : []),
          ];

          const card = allCards.find((x) => x.id === cardId);

          if (card) {
            card.isFaceUp = !card.isFaceUp;
          }

          return { players };
        }),
      openTopDeckCards: (
        playerIndex: number,
        count: number
      ) =>
        setWithHistory((state) => {
          const players = [...state.players] as [
            PlayerState,
            PlayerState
          ];

          const player = players[playerIndex];

          player.deck
            .slice(0, count)
            .forEach((card) => {
              card.isFaceUp = true;
            });

          return { players };
        }),
      changePower: (
        playerIndex: number,
        cardId: string,
        amount: number
      ) =>
        setWithHistory((state) => {
          const players = [...state.players] as [
            PlayerState,
            PlayerState
          ];

          const player = players[playerIndex];

          const allCards = [
            player.leader,
            player.stage,
            ...player.characters.filter(Boolean),
          ].filter(Boolean) as CardData[];

          const card = allCards.find((x) => x.id === cardId);

          if (card) {
            card.powerModifier = (card.powerModifier ?? 0) + amount;
          }

          return { players };
        }),

      changeCountModifier: (
        playerIndex: number,
        cardId: string,
        amount: number
      ) =>
        setWithHistory((state) => {
          const players = [...state.players] as [
            PlayerState,
            PlayerState
          ];

          const player = players[playerIndex];

          const allCards = [
            player.leader,
            player.stage,
            ...player.characters.filter(Boolean),
          ].filter(Boolean) as CardData[];

          const card = allCards.find((x) => x.id === cardId);

          if (card) {
            card.countModifier =
              (card.countModifier ?? 0) + amount;
          }

          return { players };
        }),

      setStatusLabel: (
        playerIndex: number,
        cardId: string,
        label: string
      ) =>
        setWithHistory((state) => {
          const players = [...state.players] as [
            PlayerState,
            PlayerState
          ];

          const player = players[playerIndex];

          const allCards = [
            player.leader,
            player.stage,
            ...player.characters.filter(Boolean),
          ].filter(Boolean) as CardData[];

          const card = allCards.find((x) => x.id === cardId);

          if (card) {
            const hasVisibleDisabledLabel =
              card.statusLabel !== undefined &&
              !card.statusLabel.includes("アクティブ");

            card.statusLabel =
              label === "×" && hasVisibleDisabledLabel
                ? undefined
                : label;
          }

          return { players };
        }),
      resetToDeckSelect: () =>
        set(() => ({
          isStarted: false,
          undoHistory: [],
          turnStartSnapshot: null,
          actionLogs: [],
          currentAttackSource: null,
          currentAttackTarget: null,
          pendingAttackPlayerIndex: null,
          cardEffectSignal: null,
          counterPhase: null,
          damagePhase: null,
          mulliganWaiting: false,
          turnOrderSelectionPending: false,
          turnOrderDecider: null,
          firstPlayerIndex: null,
        })),
      mulligan: (playerIndex: 0 | 1) => {
        set((state) => {
          const players = [...state.players] as [
            PlayerState,
            PlayerState
          ];

          const player = players[playerIndex];

          const handCards = player.hand.map((card) => ({
            ...card,
            rotated: false,
            attachedDonCount: 0,
            isFaceUp: false,
          }));

          player.deck = shuffle([
            ...player.deck,
            ...handCards,
          ]);

          player.hand = player.deck.splice(0, 5).map((card) => ({
            ...card,
            isFaceUp: true,
            rotated: false,
            attachedDonCount: 0,
          }));

          return {
            players,
            mulliganPlayerIndex:
              state.localPlayerIndex === null ? null : 0,
            mulliganWaiting:
              state.localPlayerIndex !== null,
          };
        });

        const afterPlayer = get().players[playerIndex];

        return {
          playerIndex,
          action: "mulligan",
          handOrder: afterPlayer.hand.map((card) => card.name),
          deckOrder: afterPlayer.deck.map((card) => card.name),
        };
      },

      keepHand: (playerIndex: 0 | 1) => {
        set((state) => ({
          mulliganPlayerIndex:
            state.localPlayerIndex === null ? null : 0,
          mulliganWaiting:
            state.localPlayerIndex !== null,
        }));

        const player = get().players[playerIndex];

        return {
          playerIndex,
          action: "keep",
          handOrder: player.hand.map((card) => card.name),
          deckOrder: player.deck.map((card) => card.name),
        };
      },

      applyOnlineMulliganResult: (
        result: MulliganResultPayload
      ) =>
        set((state) => {
          const players = [...state.players] as [
            PlayerState,
            PlayerState
          ];

          const player = players[result.playerIndex];

          const sourceCards = [
            ...player.hand,
            ...player.deck,
          ];

          const orderedCards = orderCardsByNames(
            sourceCards,
            [
              ...result.handOrder,
              ...result.deckOrder,
            ]
          );

          player.hand = orderedCards
            .slice(0, result.handOrder.length)
            .map((card) => ({
              ...card,
              isFaceUp: true,
              rotated: false,
              attachedDonCount: 0,
            }));

          player.deck = orderedCards
            .slice(result.handOrder.length)
            .map((card) => ({
              ...card,
              isFaceUp: false,
              rotated: false,
              attachedDonCount: 0,
            }));

          return {
            players,
          };
        }),

      mulliganPlayerIndex: null,
      takeDonFromDeckToActive: (playerIndex: number) =>
        setWithHistory((state) => {
          const players = [...state.players] as [
            PlayerState,
            PlayerState
          ];

          const player = players[playerIndex];

          const don = player.donDeck.shift();

          if (!don) {
            return { players };
          }

          don.rotated = false;

          player.activeDons.unshift(don);

          return { players };
        }),

      takeDonFromDeckToRest: (playerIndex: number) =>
        setWithHistory((state) => {
          const players = [...state.players] as [
            PlayerState,
            PlayerState
          ];

          const player = players[playerIndex];

          const don = player.donDeck.shift();

          if (!don) {
            return { players };
          }

          don.rotated = true;

          player.restDons.unshift(don);

          return { players };
        }),

      moveActiveDonToRest: (playerIndex: number) =>
        setWithHistory((state) => {
          const players = [...state.players] as [
            PlayerState,
            PlayerState
          ];

          const player = players[playerIndex];

          const don = player.activeDons.shift();

          if (!don) {
            return { players };
          }

          don.rotated = true;

          player.restDons.unshift(don);

          return { players };
        }),

      moveRestDonToActive: (playerIndex: number) =>
        setWithHistory((state) => {
          const players = [...state.players] as [
            PlayerState,
            PlayerState
          ];

          const player = players[playerIndex];

          const don = player.restDons.shift();

          if (!don) {
            return { players };
          }

          don.rotated = false;

          player.activeDons.unshift(don);

          return { players };
        }),

      attachDonFromArea: (
        playerIndex: number,
        donCardId: string,
        fromArea: "activeDon" | "restDon",
        targetCardId: string
      ) =>
        setWithHistory((state) => {
          const players = [...state.players] as [
            PlayerState,
            PlayerState
          ];

          const player = players[playerIndex];

          const source =
            fromArea === "activeDon"
              ? player.activeDons
              : player.restDons;

          const donIndex = source.findIndex(
            (x) => x.id === donCardId
          );

          if (donIndex === -1) {
            return { players };
          }

          const targetCards = [
            player.leader,
            ...player.characters.filter(Boolean),
          ].filter(Boolean) as CardData[];

          const target = targetCards.find(
            (x) => x.id === targetCardId
          );

          if (!target) {
            return { players };
          }

          source.splice(donIndex, 1);

          target.attachedDonCount++;

          return { players };
        }),

      returnAttachedDonToActive: (
        playerIndex: number,
        targetCardId: string
      ) =>
        setWithHistory((state) => {
          const players = [...state.players] as [
            PlayerState,
            PlayerState
          ];

          const player = players[playerIndex];

          const targetCards = [
            player.leader,
            ...player.characters.filter(Boolean),
          ].filter(Boolean) as CardData[];

          const target = targetCards.find(
            (x) => x.id === targetCardId
          );

          if (!target || target.attachedDonCount <= 0) {
            return { players };
          }

          target.attachedDonCount--;

          player.activeDons.unshift({
            id: Math.random().toString(36).slice(2),
            name: "DON",
            image: getDonImageUrl(),
            type: "don",
            rotated: false,
            attachedDonCount: 0,
            isFaceUp: true,
          });

          return { players };
        }),

      returnAttachedDonToRest: (
        playerIndex: number,
        targetCardId: string
      ) =>
        setWithHistory((state) => {
          const players = [...state.players] as [
            PlayerState,
            PlayerState
          ];

          const player = players[playerIndex];

          const targetCards = [
            player.leader,
            ...player.characters.filter(Boolean),
          ].filter(Boolean) as CardData[];

          const target = targetCards.find(
            (x) => x.id === targetCardId
          );

          if (!target || target.attachedDonCount <= 0) {
            return { players };
          }

          target.attachedDonCount--;

          player.restDons.unshift({
            id: Math.random().toString(36).slice(2),
            name: "DON",
            image: getDonImageUrl(),
            type: "don",
            rotated: true,
            attachedDonCount: 0,
            isFaceUp: true,
          });

          return { players };
        }),
      returnAttachedDonToDeck: (
        playerIndex: number,
        targetCardId: string
      ) =>
        setWithHistory((state) => {
          const players = [...state.players] as [
            PlayerState,
            PlayerState
          ];

          const player = players[playerIndex];

          const targetCards = [
            player.leader,
            ...player.characters.filter(Boolean),
          ].filter(Boolean) as CardData[];

          const target = targetCards.find(
            (x) => x.id === targetCardId
          );

          if (!target || target.attachedDonCount <= 0) {
            return { players };
          }

          target.attachedDonCount--;

          player.donDeck.unshift({
            id: Math.random().toString(36).slice(2),
            name: "DON",
            image: getDonImageUrl(),
            type: "don",
            rotated: false,
            attachedDonCount: 0,
            isFaceUp: true,
          });

          return { players };
        }),
      moveDonBetweenAreas: (
        playerIndex: number,
        cardId: string,
        fromArea: "donDeck" | "activeDon" | "restDon",
        toArea: "donDeck" | "activeDon" | "restDon"
      ) =>
        setWithHistory((state) => {
          const players = [...state.players] as [
            PlayerState,
            PlayerState
          ];

          const player = players[playerIndex];

          if (fromArea === toArea) {
            return { players };
          }

          const getArea = (
            area: "donDeck" | "activeDon" | "restDon"
          ) => {
            if (area === "donDeck") return player.donDeck;
            if (area === "activeDon") return player.activeDons;
            return player.restDons;
          };

          const fromList = getArea(fromArea);
          const toList = getArea(toArea);

          const index = fromList.findIndex(
            (x) => x.id === cardId
          );

          if (index === -1) {
            return { players };
          }

          const don = fromList.splice(index, 1)[0];

          don.rotated = toArea === "restDon";

          toList.unshift(don);

          return { players };
        }),

      reorderZoneCards: (
        playerIndex,
        zone,
        activeId,
        overId
      ) =>
        setWithHistory((state) => {
          const players = [...state.players] as [
            PlayerState,
            PlayerState
          ];

          const player = players[playerIndex];

          const cards = [...player[zone]];

          const oldIndex = cards.findIndex(
            (x) => x.id === activeId
          );

          const newIndex = cards.findIndex(
            (x) => x.id === overId
          );

          if (
            oldIndex === -1 ||
            newIndex === -1
          ) {
            return { players };
          }

          const [moved] = cards.splice(
            oldIndex,
            1
          );

          cards.splice(
            newIndex,
            0,
            moved
          );

          player[zone] = cards;

          return { players };
        }),
      selectedDonStack: null,

      selectDonStack: (
        playerIndex: number,
        fromArea: DonAreaKey
      ) =>
        set((state) => {
          const player = state.players[playerIndex];

          const source =
            fromArea === "donDeck"
              ? player.donDeck
              : fromArea === "activeDon"
                ? player.activeDons
                : player.restDons;

          if (source.length === 0) {
            return {};
          }

          const current = state.selectedDonStack;

          if (
            current &&
            current.playerIndex === playerIndex &&
            current.fromArea === fromArea
          ) {
            return {
              selectedDonStack: {
                ...current,
                count: Math.min(
                  current.count + 1,
                  source.length
                ),
              },
            };
          }

          return {
            selectedDonStack: {
              playerIndex,
              fromArea,
              count: 1,
            },
          };
        }),

      clearSelectedDonStack: () =>
        set(() => ({
          selectedDonStack: null,
        })),

      moveSelectedDonStack: (
        toArea: DonAreaKey
      ) =>
        setWithHistory((state) => {
          const selected = state.selectedDonStack;

          if (!selected) {
            return {};
          }

          const players = [...state.players] as [
            PlayerState,
            PlayerState
          ];

          const player =
            players[selected.playerIndex];

          const getArea = (
            area: DonAreaKey
          ) => {
            if (area === "donDeck") {
              return player.donDeck;
            }

            if (area === "activeDon") {
              return player.activeDons;
            }

            return player.restDons;
          };

          if (selected.fromArea === toArea) {
            return {
              players,
              selectedDonStack: null,
            };
          }

          const fromList =
            getArea(selected.fromArea);

          const toList =
            getArea(toArea);

          const moveCount = Math.min(
            selected.count,
            fromList.length
          );

          const movedCards = fromList.splice(
            0,
            moveCount
          );

          for (const don of movedCards) {
            don.rotated = toArea === "restDon";
          }

          toList.unshift(...movedCards);

          return {
            players,
            selectedDonStack: null,
          };
        }),

      attachSelectedDonStack: (
        targetCardId: string
      ) =>
        setWithHistory((state) => {
          const selected = state.selectedDonStack;

          if (!selected) {
            return {};
          }

          if (selected.fromArea === "donDeck") {
            return {};
          }

          const players = [...state.players] as [
            PlayerState,
            PlayerState
          ];

          const player =
            players[selected.playerIndex];

          const source =
            selected.fromArea === "activeDon"
              ? player.activeDons
              : player.restDons;

          const targetCards = [
            player.leader,
            ...player.characters.filter(
              (x): x is CardData => x !== null
            ),
          ].filter(Boolean) as CardData[];

          const target = targetCards.find(
            (x) => x.id === targetCardId
          );

          if (!target) {
            return {
              players,
            };
          }

          const attachCount = Math.min(
            selected.count,
            source.length
          );

          source.splice(0, attachCount);

          target.attachedDonCount += attachCount;

          return {
            players,
            selectedDonStack: null,
          };
        }),

      returnAttachedDonsToRest: (
        playerIndex,
        cardId
      ) =>
        setWithHistory((state) => {
          const players = [...state.players] as [
            PlayerState,
            PlayerState
          ];

          const player = players[playerIndex];

          const targetCards: CardData[] = [
            ...(player.leader ? [player.leader] : []),
            ...(player.stage ? [player.stage] : []),
            ...player.characters.filter(
              (x): x is CardData => x !== null
            ),
          ];

          const card = targetCards.find(
            (x) => x.id === cardId
          );

          if (!card) {
            return { players };
          }

          const count =
            card.attachedDonCount ?? 0;

          if (count <= 0) {
            return { players };
          }

          card.attachedDonCount = 0;

          for (let i = 0; i < count; i++) {
            player.restDons.unshift({
              id: Math.random()
                .toString(36)
                .slice(2),

              name: "DON",

              image: getDonImageUrl(),

              type: "don",

              rotated: true,

              attachedDonCount: 0,

              isFaceUp: true,
            });
          }

          return { players };
        }),
      undoLastAction: () => {
        const snapshot = get().undoHistory[0];

        if (!snapshot) {
          return;
        }

        set((state) => ({
          players: clonePlayers(snapshot),
          undoHistory: state.undoHistory.slice(1),
          selectedDonStack: null,
        }));
      },

      saveTurnStartSnapshot: () => {
        set((state) => ({
          turnStartSnapshot: clonePlayers(state.players),
        }));
      },

      returnToTurnStart: () => {
        const snapshot = get().turnStartSnapshot;

        if (!snapshot) {
          return;
        }

        set((state) => ({
          players: clonePlayers(snapshot),
          undoHistory: [
            clonePlayers(state.players),
            ...state.undoHistory,
          ].slice(0, MAX_HISTORY_COUNT),
          selectedDonStack: null,
        }));
      },

      resetGameToMulligan: () => {
        set((state) => {
          const resetPlayer = (player: PlayerState): PlayerState => {
            const mainDeckCards = [
              ...player.deck,
              ...player.hand,
              ...player.life,
            ...player.trash,
            ...player.publicCards,
            ...player.counterCards,
            ...player.characters.filter(
                (x): x is CardData => x !== null
              ),
              ...(player.stage ? [player.stage] : []),
            ].map((card) => ({
              ...card,
              rotated: false,
              powerModifier: 0,
              countModifier: 0,
              statusLabel: undefined,
              attachedDonCount: 0,
              isFaceUp: false,
            }));

            const shuffledDeck = shuffleCards(mainDeckCards);

            const lifeCount = player.leader?.lifeCount ?? 5;

            const hand = shuffledDeck.slice(0, 5);

            const life = shuffledDeck
              .slice(5, 5 + lifeCount)
              .map((card) => ({
                ...card,
                isFaceUp: false,
              }));

            const deck = shuffledDeck.slice(5 + lifeCount);

            const visibleDons = [
              ...player.donDeck,
              ...player.activeDons,
              ...player.restDons,
            ];

            const attachedDonCount =
              player.characters.reduce(
                (sum, card) => sum + (card?.attachedDonCount ?? 0),
                0
              ) + (player.leader?.attachedDonCount ?? 0);

            const donSource = visibleDons[0];

            const restoredAttachedDons = Array.from({
              length: attachedDonCount,
            }).map((_, index) => ({
              ...donSource,
              id: `restored-don-${Date.now()}-${index}`,
              name: donSource?.name ?? "DON!!",
              image: donSource?.image ?? "",
              type: "don" as const,
              rotated: false,
              powerModifier: 0,
              countModifier: 0,
              statusLabel: undefined,
              attachedDonCount: 0,
              isFaceUp: true,
            }));

            const allDons = [
              ...visibleDons,
              ...restoredAttachedDons,
            ].map((card) => ({
              ...card,
              rotated: false,
              powerModifier: 0,
              countModifier: 0,
              statusLabel: undefined,
              attachedDonCount: 0,
              isFaceUp: true,
            }));

            return {
              ...player,

              deck,
              hand,
              life,
              trash: [],
              publicCards: [],
              counterCards: [],

              characters: [null, null, null, null, null],
              stage: null,

              leader: player.leader
                ? {
                  ...player.leader,
                  rotated: false,
                  powerModifier: 0,
                  countModifier: 0,
                  statusLabel: undefined,
                  attachedDonCount: 0,
                  isFaceUp: true,
                }
                : null,

              donDeck: allDons,
              activeDons: [],
              restDons: [],
            };
          };

          return {
            players: [
              resetPlayer(state.players[0]),
              resetPlayer(state.players[1]),
            ],
            selectedDonStack: null,
            undoHistory: [],
            turnStartSnapshot: null,
            actionLogs: [],
            currentAttackSource: null,
            currentAttackTarget: null,
            pendingAttackPlayerIndex: null,
            cardEffectSignal: null,
            counterPhase: null,
            damagePhase: null,
          };
        });
      },
    });
  });
