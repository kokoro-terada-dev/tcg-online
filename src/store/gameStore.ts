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

    donDeck:
      donCards.length > 0
        ? donCards
        : Array.from({
          length: leader?.donCount ?? 10,
        }).map((_) => ({
          id: Math.random().toString(36).slice(2),
          name: "DON",
          image: getDonImageUrl(),
          type: "don" as const,
          rotated: false,
          attachedDonCount: 0,
          isFaceUp: true,
        })),

    activeDons: [],

    restDons: [],
  };
}

interface MoveParams {
  playerIndex: number;

  cardId: string;

  from:
  | "hand"
  | "character"
  | "stage"
  | "trash"
  | "life"
  | "deck";

  to:
  | "hand"
  | "character"
  | "stage"
  | "trash"
  | "life"
  | "deck";

  slotIndex?: number;
}

interface GameState {
  players: [PlayerState, PlayerState];

  isStarted: boolean;

  startGame: (
    player1Deck: CardData[],
    player2Deck: CardData[]
  ) => void;

  drawCard: (
    playerIndex: number
  ) => void;

  toggleRotate: (
    playerIndex: number,
    cardId: string
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

  setStatusLabel: (
    playerIndex: number,
    cardId: string,
    label: "アタック×" | "アクティブ×"
  ) => void;

  resetToDeckSelect: () => void;

  mulliganPlayerIndex: 0 | 1 | null;

  mulligan: (playerIndex: 0 | 1) => void;

  keepHand: (playerIndex: 0 | 1) => void;

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

  resetGameToMulligan: () => void;
}

export const useGameStore =
  create<GameState>((set) => ({
    players: [
      createPlayer([]),
      createPlayer([]),
    ],

    isStarted: false,

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

        mulliganPlayerIndex: 0,
      })),

    drawCard: (
      playerIndex: number
    ) =>
      set((state) => {
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
      set((state) => {
        const players = [
          ...state.players,
        ] as [PlayerState, PlayerState];

        const player = players[playerIndex];

        const allCards: CardData[] = [
          ...player.hand,
          ...player.deck,
          ...player.trash,
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

    moveCard: ({
      playerIndex,
      cardId,
      from,
      to,
      slotIndex,
    }: MoveParams) =>
      set((state) => {
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
          "trash",
          "life",
          "deck",
        ];

        const movableTargets = [
          "hand",
          "character",
          "stage",
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
          to === "character" ||
          to === "stage"
        ) {
          card.isFaceUp = true;
        }

        if (to === "deck") {
          card.isFaceUp = false;
        }

        if (to === "life") {
          card.isFaceUp = true;
        }

        // トラッシュは表
        if (to === "trash") {
          card.isFaceUp = true;
        }

        // 移動先が手札・トラッシュ・ライフ・デッキの場合は縦向きに戻す
        if (
          to === "hand" ||
          to === "trash" ||
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

        return { players };
      }),


    removeDon: (
      playerIndex: number,
      targetCardId: string
    ) =>
      set((state) => {
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
      set((state) => {
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

        player.hand.push(card);

        return { players };
      }),

    moveListCardToTrash: (
      playerIndex: number,
      from,
      cardId: string
    ) =>
      set((state) => {
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
      set((state) => {
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
      set((state) => {
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

        return { players };
      }),

    moveListCardToLifeTop: (
      playerIndex: number,
      from,
      cardId: string
    ) =>
      set((state) => {
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
        card.isFaceUp = true;

        player.life.unshift(card);

        return { players };
      }),
    toggleCardFace: (
      playerIndex: number,
      cardId: string
    ) =>
      set((state) => {
        const players = [...state.players] as [
          PlayerState,
          PlayerState
        ];

        const player = players[playerIndex];

        const allCards: CardData[] = [
          ...player.hand,

          ...player.deck,

          ...player.trash,

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
      set((state) => {
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
      set((state) => {
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

    setStatusLabel: (
      playerIndex: number,
      cardId: string,
      label: "アタック×" | "アクティブ×"
    ) =>
      set((state) => {
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
          card.statusLabel =
            card.statusLabel === label
              ? undefined
              : label;
        }

        return { players };
      }),
    resetToDeckSelect: () =>
      set(() => ({
        isStarted: false,
      })),
    mulligan: (playerIndex: 0 | 1) =>
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
        }));

        return {
          players,
          mulliganPlayerIndex:
            playerIndex === 0 ? 1 : null,
        };
      }),

    keepHand: (playerIndex: 0 | 1) =>
      set(() => ({
        mulliganPlayerIndex:
          playerIndex === 0 ? 1 : null,
      })),

    mulliganPlayerIndex: null,
    takeDonFromDeckToActive: (playerIndex: number) =>
      set((state) => {
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
      set((state) => {
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
      set((state) => {
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
      set((state) => {
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
      set((state) => {
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
      set((state) => {
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
      set((state) => {
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
    moveDonBetweenAreas: (
      playerIndex: number,
      cardId: string,
      fromArea: "donDeck" | "activeDon" | "restDon",
      toArea: "donDeck" | "activeDon" | "restDon"
    ) =>
      set((state) => {
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
      set((state) => {
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
      set((state) => {
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
      set((state) => {
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
      set((state) => {
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
      resetGameToMulligan: () => {
  set((state) => {
    const resetPlayer = (player: PlayerState): PlayerState => {
  const mainDeckCards = [
    ...player.deck,
    ...player.hand,
    ...player.life,
    ...player.trash,
    ...player.characters.filter(
      (x): x is CardData => x !== null
    ),
    ...(player.stage ? [player.stage] : []),
  ].map((card) => ({
    ...card,
    rotated: false,
    powerModifier: 0,
    statusLabel: undefined,
    attachedDonCount: 0,
    isFaceUp: false,
  }));

  const shuffledDeck = shuffleCards(mainDeckCards);

  const hand = shuffledDeck.slice(0, 5);

  const life = shuffledDeck.slice(5, 10).map((card) => ({
    ...card,
    isFaceUp: false,
  }));

  const deck = shuffledDeck.slice(10);

  const allDons = [
    ...player.donDeck,
    ...player.activeDons,
    ...player.restDons,
  ].map((card) => ({
    ...card,
    rotated: false,
    powerModifier: 0,
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

    characters: [null, null, null, null, null],
    stage: null,

    leader: player.leader
      ? {
          ...player.leader,
          rotated: false,
          powerModifier: 0,
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
};
  });
},
  }));