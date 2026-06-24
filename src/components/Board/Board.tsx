import {
  useEffect,
  useRef,
  useState,
} from "react";

import PlayerBoard from "./PlayerBoard";
import ActionLogBar from "./ActionLogBar";
import AttackArrow from "./AttackArrow";
import ChatControls from "./ChatControls";

import { useGameStore } from "../../store/gameStore";

import {
  clearClientRoomState,
  onBoardAction,
  onMatchExitAccepted,
  onMatchExitRejected,
  onMatchExitRequest,
  onOpponentDisconnected,
  sendBoardAction,
  sendMatchExitAccepted,
  sendMatchExitRejected,
  sendMatchExitRequest,
} from "../../network/roomClient";

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  MouseSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";

import type {
  DragEndEvent,
  DragStartEvent,
} from "@dnd-kit/core";

import type { CardData } from "../../types/card";

import { GAME_LAYOUT } from "../../layout/gameLayout";
import { getDonImageUrl } from "../../utils/localCardImages";

type DragFrom =
  | "hand"
  | "character"
  | "stage"
  | "trash"
  | "life"
  | "deck"
  | "public"
  | "leader"
  | "donDeck"
  | "activeDon"
  | "restDon";

type DragCardInfo = {
  card: CardData;
  playerIndex: number;
  from: DragFrom;
};

type MovableCardArea =
  | "hand"
  | "character"
  | "stage"
  | "trash"
  | "life"
  | "deck"
  | "public";

function isMovableCardArea(
  value: unknown
): value is MovableCardArea {
  return (
    value === "hand" ||
    value === "character" ||
    value === "stage" ||
    value === "trash" ||
    value === "life" ||
    value === "deck" ||
    value === "public"
  );
}

function findCardIndexInArea(
  player: ReturnType<typeof useGameStore.getState>["players"][number],
  area: MovableCardArea,
  cardId: string
) {
  if (area === "hand") {
    return player.hand.findIndex((x) => x.id === cardId);
  }

  if (area === "deck") {
    return player.deck.findIndex((x) => x.id === cardId);
  }

  if (area === "trash") {
    return player.trash.findIndex((x) => x.id === cardId);
  }

  if (area === "public") {
    return player.publicCards.findIndex((x) => x.id === cardId);
  }

  if (area === "life") {
    return player.life.findIndex((x) => x.id === cardId);
  }

  if (area === "character") {
    return player.characters.findIndex(
      (x) => x?.id === cardId
    );
  }

  if (area === "stage") {
    return player.stage?.id === cardId ? 0 : -1;
  }

  return -1;
}

function getCardIdByAreaIndex(
  player: ReturnType<typeof useGameStore.getState>["players"][number],
  area: MovableCardArea,
  index: number
) {
  if (area === "hand") {
    return player.hand[index]?.id;
  }

  if (area === "deck") {
    return player.deck[index]?.id;
  }

  if (area === "trash") {
    return player.trash[index]?.id;
  }

  if (area === "public") {
    return player.publicCards[index]?.id;
  }

  if (area === "life") {
    return player.life[index]?.id;
  }

  if (area === "character") {
    return player.characters[index]?.id;
  }

  if (area === "stage") {
    return index === 0 ? player.stage?.id : undefined;
  }

  return undefined;
}

type DonArea =
  | "donDeck"
  | "activeDon"
  | "restDon";

function findDonIndexInArea(
  player: ReturnType<typeof useGameStore.getState>["players"][number],
  area: DonArea,
  cardId: string
) {
  if (area === "donDeck") {
    return player.donDeck.findIndex((x) => x.id === cardId);
  }

  if (area === "activeDon") {
    return player.activeDons.findIndex((x) => x.id === cardId);
  }

  return player.restDons.findIndex((x) => x.id === cardId);
}

function getDonIdByAreaIndex(
  player: ReturnType<typeof useGameStore.getState>["players"][number],
  area: DonArea,
  index: number
) {
  if (area === "donDeck") {
    return player.donDeck[index]?.id;
  }

  if (area === "activeDon") {
    return player.activeDons[index]?.id;
  }

  return player.restDons[index]?.id;
}

function getTargetInfoByCardId(
  player: ReturnType<typeof useGameStore.getState>["players"][number],
  cardId: string
): {
  targetArea: "leader" | "character";
  targetIndex: number;
} | null {
  if (player.leader?.id === cardId) {
    return {
      targetArea: "leader",
      targetIndex: 0,
    };
  }

  const characterIndex =
    player.characters.findIndex(
      (x) => x?.id === cardId
    );

  if (characterIndex === -1) {
    return null;
  }

  return {
    targetArea: "character",
    targetIndex: characterIndex,
  };
}

function getTargetCardIdByInfo(
  player: ReturnType<typeof useGameStore.getState>["players"][number],
  targetArea: "leader" | "character" | "stage" | "public",
  targetIndex: number
) {
  if (targetArea === "leader") {
    return player.leader?.id;
  }

  if (targetArea === "stage") {
    return player.stage?.id;
  }

  if (targetArea === "public") {
    return player.publicCards[targetIndex]?.id;
  }

  return player.characters[targetIndex]?.id;
}

export default function Board() {
  const players = useGameStore((x) => x.players);
  const resetToDeckSelect = useGameStore(
    (x) => x.resetToDeckSelect
  );

  const localPlayerIndex =
    useGameStore(
      (x) => x.localPlayerIndex
    );

  const ownPlayerIndex =
    localPlayerIndex ?? 1;

  const opponentPlayerIndex =
    ownPlayerIndex === 0 ? 1 : 0;

  function canOperatePlayer(playerIndex: number) {
    return (
      localPlayerIndex === null ||
      playerIndex === localPlayerIndex
    );
  }

  const refreshPlayer = useGameStore(
    (x) => x.refreshPlayer
  );
  const currentAttackSource = useGameStore(
    (x) => x.currentAttackSource
  );
  const currentAttackTarget = useGameStore(
    (x) => x.currentAttackTarget
  );
  const cardEffectSignal = useGameStore(
    (x) => x.cardEffectSignal
  );
  const cardMarkers = useGameStore(
    (x) => x.cardMarkers
  );
  const communicationMode = useGameStore(
    (x) => x.communicationMode
  );
  const isSilentMode = communicationMode === "silent";


  const [activeCard, setActiveCard] =
    useState<DragCardInfo | null>(null);

  const [
    disableAttachedDonDropAnimation,
    setDisableAttachedDonDropAnimation,
  ] = useState(false);

  const [, setPreviewImage] =
    useState<string | null>(null);

  const [exitRequestWaiting, setExitRequestWaiting] =
    useState(false);

  const [incomingExitRequest, setIncomingExitRequest] =
    useState(false);

  const [boardMenuOpen, setBoardMenuOpen] =
    useState(false);

  const [quickChatOpen, setQuickChatOpen] =
    useState(false);

  const [chatHistoryOpen, setChatHistoryOpen] =
    useState(false);

  const [unreadChatCount, setUnreadChatCount] =
    useState(0);

  const chatHistoryOpenRef = useRef(false);

  function toggleChatHistory() {
    setChatHistoryOpen((open) => {
      const next = !open;
      chatHistoryOpenRef.current = next;

      if (next) {
        setUnreadChatCount(0);
      }

      return next;
    });
  }

  function clearCardActions() {
    const state = useGameStore.getState();
    const log = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      playerIndex: ownPlayerIndex as 0 | 1,
      actionType: "clearTarget" as const,
      createdAt: Date.now(),
    };
    state.clearAttackState();
    state.clearCardEffect();
    state.clearCardMarkers();
    state.addActionLog(log);
    setQuickChatOpen(false);

    sendBoardAction({
      actionType: "CLEAR_CARD_ACTIONS",
      payload: { log },
    });
  }

  function requestMatchExit() {
    const result = window.confirm(
      "対戦終了を相手に申請しますか？"
    );

    if (!result) {
      return;
    }

    setBoardMenuOpen(false);
    setExitRequestWaiting(true);
    sendMatchExitRequest();
  }

  function returnToRoomKeepingRoom() {
    resetToDeckSelect();
  }

  function returnToRoomAfterDisconnect() {
    clearClientRoomState();
    resetToDeckSelect();
  }

  useEffect(() => {
    const offOpponentDisconnected = onOpponentDisconnected(() => {
      window.alert(
        "相手が切断しました。ルーム画面に戻ります。"
      );

      returnToRoomAfterDisconnect();
    });

    const offMatchExitRequest = onMatchExitRequest(() => {
      setIncomingExitRequest(true);
    });

    const offMatchExitAccepted = onMatchExitAccepted(() => {
      setIncomingExitRequest(false);
      returnToRoomKeepingRoom();
    });

    const offMatchExitRejected = onMatchExitRejected(() => {
      setExitRequestWaiting(false);
      setIncomingExitRequest(false);

      window.alert(
        "相手が試合終了をキャンセルしました。"
      );
    });

    return () => {
      offOpponentDisconnected();
      offMatchExitRequest();
      offMatchExitAccepted();
      offMatchExitRejected();
    };
  }, [resetToDeckSelect]);

  useEffect(() => {
    const offBoardAction = onBoardAction((action) => {
      if (action.actionType === "MOVE_CARD") {
        const { payload } = action;

        const state = useGameStore.getState();
        const player = state.players[payload.playerIndex];

        const cardIdForThisClient =
          payload.fromIndex === undefined
            ? payload.cardId
            : getCardIdByAreaIndex(
              player,
              payload.from,
              payload.fromIndex
            );

        if (!cardIdForThisClient) {
          return;
        }

        state.moveCard({
          playerIndex: payload.playerIndex,
          cardId: cardIdForThisClient,
          from: payload.from,
          to: payload.to,
          slotIndex: payload.slotIndex,
        });

        return;
      }

      if (action.actionType === "MOVE_DON") {
        const { payload } = action;

        const state = useGameStore.getState();
        const player = state.players[payload.playerIndex];

        const donIdForThisClient =
          getDonIdByAreaIndex(
            player,
            payload.fromArea,
            payload.fromIndex
          );

        if (!donIdForThisClient) {
          return;
        }

        state.moveDonBetweenAreas(
          payload.playerIndex,
          donIdForThisClient,
          payload.fromArea,
          payload.toArea
        );

        return;
      }

      if (action.actionType === "ATTACH_DON") {
        const { payload } = action;

        const state = useGameStore.getState();
        const player = state.players[payload.playerIndex];

        const donIdForThisClient =
          getDonIdByAreaIndex(
            player,
            payload.fromArea,
            payload.fromIndex
          );

        const targetCardIdForThisClient =
          getTargetCardIdByInfo(
            player,
            payload.targetArea,
            payload.targetIndex
          );

        if (
          !donIdForThisClient ||
          !targetCardIdForThisClient
        ) {
          return;
        }

        state.attachDonFromArea(
          payload.playerIndex,
          donIdForThisClient,
          payload.fromArea,
          targetCardIdForThisClient
        );

        return;
      }
      if (action.actionType === "RETURN_ATTACHED_DON") {
        const { payload } = action;

        const state = useGameStore.getState();
        const player = state.players[payload.playerIndex];

        const targetCardIdForThisClient =
          getTargetCardIdByInfo(
            player,
            payload.targetArea,
            payload.targetIndex
          );

        if (!targetCardIdForThisClient) {
          return;
        }

        if (payload.toArea === "activeDon") {
          state.returnAttachedDonToActive(
            payload.playerIndex,
            targetCardIdForThisClient
          );
        } else if (payload.toArea === "restDon") {
          state.returnAttachedDonToRest(
            payload.playerIndex,
            targetCardIdForThisClient
          );
        } else {
          state.returnAttachedDonToDeck(
            payload.playerIndex,
            targetCardIdForThisClient
          );
        }

        return;
      }

      if (action.actionType === "REFRESH_PLAYER") {
        const { payload } = action;

        useGameStore.getState().refreshPlayer(
          payload.playerIndex
        );

        return;
      }
      if (action.actionType === "CARD_MENU_ACTION") {
        const { payload } = action;

        const state = useGameStore.getState();
        const player = state.players[payload.playerIndex];

        const targetCardId =
          payload.targetArea === "leader"
            ? player.leader?.id
            : payload.targetArea === "stage"
              ? player.stage?.id
              : player.characters[payload.targetIndex]?.id;

        if (!targetCardId) {
          return;
        }

        if (payload.menuAction === "TOGGLE_ROTATE") {
          state.toggleRotate(
            payload.playerIndex,
            targetCardId
          );

          return;
        }

        if (payload.menuAction === "CHANGE_POWER") {
          state.changePower(
            payload.playerIndex,
            targetCardId,
            payload.amount ?? 0
          );

          return;
        }

        if (payload.menuAction === "CHANGE_COUNT_MODIFIER") {
          state.changeCountModifier(
            payload.playerIndex,
            targetCardId,
            payload.amount ?? 0
          );

          return;
        }

        if (
          payload.menuAction === "SET_STATUS_LABEL" &&
          payload.label
        ) {
          state.setStatusLabel(
            payload.playerIndex,
            targetCardId,
            payload.label
          );

          return;
        }

        if (payload.menuAction === "RETURN_ATTACHED_DONS_TO_REST") {
          state.returnAttachedDonsToRest(
            payload.playerIndex,
            targetCardId
          );

          return;
        }

      }
      if (action.actionType === "MOVE_SELECTED_DON_STACK") {
        const { payload } = action;

        const state = useGameStore.getState();

        state.clearSelectedDonStack();

        for (let i = 0; i < payload.count; i++) {
          useGameStore.getState().selectDonStack(
            payload.playerIndex,
            payload.fromArea
          );
        }

        useGameStore.getState().moveSelectedDonStack(
          payload.toArea
        );

        return;
      }

      if (action.actionType === "ATTACH_SELECTED_DON_STACK") {
        const { payload } = action;

        const state = useGameStore.getState();
        const player = state.players[payload.playerIndex];

        const targetCardId =
          getTargetCardIdByInfo(
            player,
            payload.targetArea,
            payload.targetIndex
          );

        if (!targetCardId) {
          return;
        }

        state.clearSelectedDonStack();

        for (let i = 0; i < payload.count; i++) {
          useGameStore.getState().selectDonStack(
            payload.playerIndex,
            payload.fromArea
          );
        }

        useGameStore.getState().attachSelectedDonStack(
          targetCardId
        );

        return;
      }

      if (action.actionType === "LIST_CARD_ACTION") {
        const { payload } = action;

        const state = useGameStore.getState();
        const player = state.players[payload.playerIndex];

        const cardId = getCardIdByAreaIndex(
          player,
          payload.from,
          payload.fromIndex
        );

        if (!cardId) {
          return;
        }

        if (payload.listAction === "TO_HAND") {
          state.moveListCardToHand(
            payload.playerIndex,
            payload.from,
            cardId
          );

          return;
        }

        if (payload.listAction === "TO_PUBLIC") {
          state.moveListCardToPublic(
            payload.playerIndex,
            payload.from,
            cardId
          );

          return;
        }

        if (payload.listAction === "TO_TRASH") {
          state.moveListCardToTrash(
            payload.playerIndex,
            payload.from,
            cardId
          );

          return;
        }

        if (payload.listAction === "TO_DECK_BOTTOM") {
          state.moveListCardToDeckBottom(
            payload.playerIndex,
            payload.from,
            cardId
          );

          return;
        }

        if (payload.listAction === "TO_LIFE_TOP") {
          state.moveListCardToLifeTop(
            payload.playerIndex,
            payload.from,
            cardId
          );

          return;
        }

      }

      if (action.actionType === "TOGGLE_LIST_CARD_FACE") {
        const { payload } = action;

        const state = useGameStore.getState();
        const player = state.players[payload.playerIndex];

        const cardId = getCardIdByAreaIndex(
          player,
          payload.zone,
          payload.cardIndex
        );

        if (!cardId) {
          return;
        }

        state.toggleCardFace(
          payload.playerIndex,
          cardId
        );

        return;
      }

      if (action.actionType === "OPEN_TOP_DECK_CARDS") {
        const { payload } = action;

        useGameStore.getState().openTopDeckCards(
          payload.playerIndex,
          payload.count
        );

        return;
      }

      if (action.actionType === "REORDER_ZONE_CARDS") {
        const { payload } = action;

        const state = useGameStore.getState();
        const player = state.players[payload.playerIndex];

        const activeId = getCardIdByAreaIndex(
          player,
          payload.zone,
          payload.activeIndex
        );

        const overId = getCardIdByAreaIndex(
          player,
          payload.zone,
          payload.overIndex
        );

        if (!activeId || !overId) {
          return;
        }

        state.reorderZoneCards(
          payload.playerIndex,
          payload.zone,
          activeId,
          overId
        );

        return;
      }

      if (action.actionType === "TOGGLE_PUBLIC_CARD_FACE") {
        const state = useGameStore.getState();

        if (state.communicationMode === "silent") {
          return;
        }

        const card =
          state.players[action.payload.playerIndex]
            .publicCards[action.payload.cardIndex];

        if (card) {
          state.toggleCardFace(
            action.payload.playerIndex,
            card.id
          );
        }
        return;
      }

      if (action.actionType === "QUICK_ACTION") {
        if (useGameStore.getState().communicationMode !== "silent") {
          return;
        }
        useGameStore.getState().addActionLog(
          action.payload.log
        );
        const currentLocalPlayerIndex =
          useGameStore.getState().localPlayerIndex;

        if (
          currentLocalPlayerIndex !== null &&
          action.payload.log.playerIndex !== currentLocalPlayerIndex &&
          !chatHistoryOpenRef.current
        ) {
          setUnreadChatCount((count) => count + 1);
        }
        return;
      }

      if (action.actionType === "SET_ATTACK_TARGET") {
        const state = useGameStore.getState();
        const targetPlayer =
          state.players[action.payload.targetPlayerIndex];
        const cardId = getTargetCardIdByInfo(
          targetPlayer,
          action.payload.targetArea,
          action.payload.targetIndex
        );

        if (cardId) {
          state.setAttackTarget(
            {
              playerIndex: action.payload.targetPlayerIndex,
              cardId,
            },
            action.payload.log
          );
        }
        return;
      }

      if (action.actionType === "CARD_QUICK_ACTION") {
        const state = useGameStore.getState();
        if (state.communicationMode !== "silent") {
          return;
        }
        const { payload } = action;
        const cardId = getTargetCardIdByInfo(
          state.players[payload.playerIndex],
          payload.targetArea,
          payload.targetIndex
        );

        if (!cardId) {
          return;
        }

        const pointer = {
          playerIndex: payload.playerIndex,
          cardId,
        };

        if (payload.quickAction === "attack") {
          if (!payload.log) {
            return;
          }
          state.startAttack(
            payload.playerIndex,
            cardId,
            payload.log
          );
        } else if (payload.quickAction === "target") {
          state.setAttackTarget(pointer, payload.log);
        } else if (
          payload.quickAction === "target1" ||
          payload.quickAction === "target2" ||
          payload.quickAction === "target3"
        ) {
          state.setCardMarker(
            {
              ...pointer,
              markerType: payload.quickAction,
              createdBy: payload.log?.playerIndex ?? payload.playerIndex,
            },
            payload.log
          );
        } else if (payload.quickAction === "effect") {
          state.showCardEffect({
            ...pointer,
            nonce: Date.now(),
          });
          state.setCardMarker(
            {
              ...pointer,
              markerType: "effect",
              createdBy: payload.log?.playerIndex ?? payload.playerIndex,
            },
            payload.targetArea === "public"
              ? undefined
              : payload.log
          );
          if (
            payload.targetArea === "public" &&
            payload.log
          ) {
            state.setAttackSource(pointer, payload.log);
          }
        } else if (payload.quickAction === "rest") {
          state.toggleRotate(payload.playerIndex, cardId);
          if (payload.log) {
            state.addActionLog(payload.log);
          }
        } else if (
          payload.quickAction === "processing" ||
          payload.quickAction === "confirmRequest" ||
          payload.quickAction === "confirmed" ||
          payload.quickAction === "note"
        ) {
          state.setCardMarker(
            {
              ...pointer,
              markerType: payload.quickAction,
              createdBy: payload.log?.playerIndex ?? payload.playerIndex,
            },
            payload.log
          );
        } else if (payload.quickAction === "cancelSource") {
          state.clearAttackState();
        } else {
          state.clearAttackTarget();
        }

        return;
      }

      if (action.actionType === "CLEAR_CARD_ACTIONS") {
        const state = useGameStore.getState();
        state.clearAttackState();
        state.clearCardEffect();
        state.clearCardMarkers();
        if (action.payload.log) {
          state.addActionLog(action.payload.log);
        }
        return;
      }
    });

    return () => {
      offBoardAction();
    };
  }, []);

  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),

    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 120,
        tolerance: 8,
      },
    }),

    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    })
  );

  function onDragStart(event: DragStartEvent) {
    const data = event.active.data.current as any;

    setDisableAttachedDonDropAnimation(false);

    if (!data) {
      return;
    }

    if (!canOperatePlayer(data.playerIndex)) {
      return;
    }

    const player = players[data.playerIndex];

    if (!player) {
      return;
    }

    if (data.type === "attached-don") {
      setActiveCard({
        card: {
          id: `attached-don-${data.targetCardId}`,
          name: "DON",
          image: getDonImageUrl(),
          type: "don",
          rotated: false,
          attachedDonCount: 0,
          isFaceUp: true,
        },
        playerIndex: data.playerIndex,
        from: "activeDon",
      });
      return;
    }

    const allCards: CardData[] = [
      ...player.hand,
      ...player.deck,
      ...player.trash,
      ...player.publicCards,
      ...player.life,
      ...player.activeDons,
      ...player.restDons,
      ...player.donDeck,
      ...player.characters.filter(
        (x): x is CardData => x !== null
      ),
      ...(player.stage ? [player.stage] : []),
      ...(player.leader ? [player.leader] : []),
    ];

    const card = allCards.find(
      (x) => x.id === data.cardId
    );

    if (!card) {
      return;
    }

    setActiveCard({
      card,
      playerIndex: data.playerIndex,
      from: data.from,
    });
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    const activeData = active.data.current as any;
    const overData = over?.data.current as any;

    const isSuccessfulAttachedDonDrop =
      activeData?.type === "attached-don" &&
      (overData?.to === "activeDon" ||
        overData?.to === "restDon" ||
        overData?.to === "donDeck");

    setDisableAttachedDonDropAnimation(
      isSuccessfulAttachedDonDrop
    );
    setActiveCard(null);

    if (isSuccessfulAttachedDonDrop) {
      window.setTimeout(() => {
        setDisableAttachedDonDropAnimation(false);
      }, 0);
    }

    if (!over) {
      return;
    }

    if (!activeData || !overData) {
      return;
    }

    if (!canOperatePlayer(activeData.playerIndex)) {
      return;
    }

    const store = useGameStore.getState();

    if (
      (activeData.from === "donDeck" ||
        activeData.from === "activeDon" ||
        activeData.from === "restDon") &&
      (overData.to === "donDeck" ||
        overData.to === "activeDon" ||
        overData.to === "restDon")
    ) {
      const selected =
        useGameStore.getState().selectedDonStack;

      if (selected) {
        if (!canOperatePlayer(selected.playerIndex)) {
          return;
        }

        store.moveSelectedDonStack(overData.to);

        sendBoardAction({
          actionType: "MOVE_SELECTED_DON_STACK",
          payload: {
            playerIndex: selected.playerIndex,
            fromArea: selected.fromArea,
            count: selected.count,
            toArea: overData.to,
          },
        });
      } else {
        const player =
          store.players[activeData.playerIndex];

        const fromIndex = findDonIndexInArea(
          player,
          activeData.from,
          activeData.cardId
        );

        if (fromIndex === -1) {
          return;
        }

        store.moveDonBetweenAreas(
          activeData.playerIndex,
          activeData.cardId,
          activeData.from,
          overData.to
        );

        sendBoardAction({
          actionType: "MOVE_DON",
          payload: {
            playerIndex: activeData.playerIndex,
            cardId: activeData.cardId,
            fromIndex,
            fromArea: activeData.from,
            toArea: overData.to,
          },
        });
      }

      return;
    }

    if (
      (activeData.from === "activeDon" ||
        activeData.from === "restDon") &&
      (overData.to === "character" ||
        overData.to === "leader")
    ) {
      if (!overData.cardId) {
        return;
      }

      const selected =
        useGameStore.getState().selectedDonStack;

      if (selected) {
        if (!canOperatePlayer(selected.playerIndex)) {
          return;
        }

        if (
          selected.fromArea === "donDeck"
        ) {
          return;
        }

        const player =
          store.players[selected.playerIndex];

        const targetInfo = getTargetInfoByCardId(
          player,
          overData.cardId
        );

        if (!targetInfo) {
          return;
        }

        store.attachSelectedDonStack(overData.cardId);

        sendBoardAction({
          actionType: "ATTACH_SELECTED_DON_STACK",
          payload: {
            playerIndex: selected.playerIndex,
            fromArea: selected.fromArea,
            count: selected.count,
            targetCardId: overData.cardId,
            targetArea: targetInfo.targetArea,
            targetIndex: targetInfo.targetIndex,
          },
        });
      } else {
        const player =
          store.players[activeData.playerIndex];

        const fromIndex = findDonIndexInArea(
          player,
          activeData.from,
          activeData.cardId
        );

        const targetInfo = getTargetInfoByCardId(
          player,
          overData.cardId
        );

        if (
          fromIndex === -1 ||
          !targetInfo
        ) {
          return;
        }

        store.attachDonFromArea(
          activeData.playerIndex,
          activeData.cardId,
          activeData.from,
          overData.cardId
        );

        sendBoardAction({
          actionType: "ATTACH_DON",
          payload: {
            playerIndex: activeData.playerIndex,
            donCardId: activeData.cardId,
            fromArea: activeData.from,
            fromIndex,
            targetCardId: overData.cardId,
            targetArea: targetInfo.targetArea,
            targetIndex: targetInfo.targetIndex,
          },
        });
      }

      return;
    }

    if (
      activeData.type === "attached-don" &&
      overData.to === "activeDon"
    ) {
      const player =
        store.players[activeData.playerIndex];

      const targetInfo = getTargetInfoByCardId(
        player,
        activeData.targetCardId
      );

      if (!targetInfo) {
        return;
      }

      store.returnAttachedDonToActive(
        activeData.playerIndex,
        activeData.targetCardId
      );

      sendBoardAction({
        actionType: "RETURN_ATTACHED_DON",
        payload: {
          playerIndex: activeData.playerIndex,
          targetCardId: activeData.targetCardId,
          targetArea: targetInfo.targetArea,
          targetIndex: targetInfo.targetIndex,
          toArea: "activeDon",
        },
      });

      return;
    }

    if (
      activeData.type === "attached-don" &&
      (overData.to === "restDon" ||
        overData.to === "donDeck")
    ) {
      const player =
        store.players[activeData.playerIndex];

      const targetInfo = getTargetInfoByCardId(
        player,
        activeData.targetCardId
      );

      if (!targetInfo) {
        return;
      }

      if (overData.to === "restDon") {
        store.returnAttachedDonToRest(
          activeData.playerIndex,
          activeData.targetCardId
        );
      } else {
        store.returnAttachedDonToDeck(
          activeData.playerIndex,
          activeData.targetCardId
        );
      }

      sendBoardAction({
        actionType: "RETURN_ATTACHED_DON",
        payload: {
          playerIndex: activeData.playerIndex,
          targetCardId: activeData.targetCardId,
          targetArea: targetInfo.targetArea,
          targetIndex: targetInfo.targetIndex,
          toArea: overData.to,
        },
      });

      return;
    }

    if (
      !isMovableCardArea(activeData.from) ||
      !isMovableCardArea(overData.to)
    ) {
      return;
    }

    const player =
      store.players[activeData.playerIndex];

    const fromIndex = findCardIndexInArea(
      player,
      activeData.from,
      activeData.cardId
    );

    const movePayload = {
      playerIndex: activeData.playerIndex,
      cardId: activeData.cardId,
      fromIndex,
      from: activeData.from,
      to: overData.to,
      slotIndex: overData.slotIndex,
    };

    store.moveCard(movePayload);

    sendBoardAction({
      actionType: "MOVE_CARD",
      payload: movePayload,
    });
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setDisableAttachedDonDropAnimation(false);
        setActiveCard(null);
      }}
    >
      <div
        className="board-root"
        style={{
          width: "100vw",
          height: "100dvh",
          overflow: "hidden",
          overscrollBehavior: "none",
          touchAction: "none",
        }}
        onContextMenu={(e) => {
          e.preventDefault();
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",

            display: "flex",
            flexDirection: "column",

            gap: "4px",
            padding: "4px",

            overflow: "hidden",
          }}
        >
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
            }}
          >
            <PlayerBoard
              player={players[opponentPlayerIndex]}
              playerIndex={opponentPlayerIndex}
              onPreview={setPreviewImage}
              reversed
              isOwnPlayer={false}
            />
          </div>

          {isSilentMode && (
            <div
            style={{
              flexShrink: 0,

              display: "flex",
              justifyContent: "center",
              alignItems: "center",

              gap: "4px",
              padding: "2px 52px 2px 4px",

              fontSize: "clamp(10px, 2.8vw, 12px)",
              minHeight: "42px",
              marginTop: 0,
            }}
          >
            <ActionLogBar />
            </div>
          )}

          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
            }}
          >
            <PlayerBoard
              player={players[ownPlayerIndex]}
              playerIndex={ownPlayerIndex}
              onPreview={setPreviewImage}
              isOwnPlayer
            />
          </div>
        </div>
      </div>

      {isSilentMode && <AttackArrow />}

      {isSilentMode && (currentAttackSource ||
        currentAttackTarget ||
        cardEffectSignal ||
        cardMarkers.length > 0) && (
        <button
          type="button"
          aria-label="アクションをキャンセル"
          title="アクションをキャンセル"
          onClick={clearCardActions}
          style={{
            position: "fixed",
            top: "max(8px, env(safe-area-inset-top))",
            right: "56px",
            minWidth: "88px",
            height: "40px",
            padding: "0 10px",
            borderRadius: "7px",
            border: "1px solid #fca5a5",
            background: "#b91c1c",
            color: "white",
            fontSize: "12px",
            fontWeight: 900,
            zIndex: 90000,
          }}
        >
          キャンセル
        </button>
      )}

      {isSilentMode && <ChatControls
        senderPlayerIndex={ownPlayerIndex as 0 | 1}
        quickChatOpen={quickChatOpen}
        historyOpen={chatHistoryOpen}
        unreadCount={unreadChatCount}
        onToggleQuickChat={() =>
          setQuickChatOpen((open) => !open)
        }
        onToggleHistory={toggleChatHistory}
        onCloseQuickChat={() => setQuickChatOpen(false)}
      />}

      <button
        type="button"
        aria-label="メニュー"
        title="メニュー"
        onClick={() => setBoardMenuOpen(true)}
        style={{
          position: "fixed",
          top: "max(8px, env(safe-area-inset-top))",
          right: "8px",
          width: "40px",
          height: "40px",
          borderRadius: "8px",
          border: "1px solid #94a3b8",
          background: "rgba(15, 23, 42, 0.94)",
          color: "white",
          fontSize: "24px",
          lineHeight: 1,
          zIndex: 90000,
        }}
      >
        ☰
      </button>

      {boardMenuOpen && (
        <div
          onClick={() => setBoardMenuOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 90001,
            background: "rgba(0, 0, 0, 0.35)",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "absolute",
              top: "max(8px, env(safe-area-inset-top))",
              right: "8px",
              width: "min(240px, calc(100vw - 16px))",
              padding: "12px",
              borderRadius: "8px",
              border: "1px solid #64748b",
              background: "#0f172a",
              boxShadow: "0 12px 30px rgba(0,0,0,0.55)",
            }}
          >
            <button
              type="button"
              aria-label="閉じる"
              title="閉じる"
              onClick={() => setBoardMenuOpen(false)}
              style={{
                display: "block",
                marginLeft: "auto",
                width: "36px",
                height: "36px",
                borderRadius: "8px",
                border: "1px solid #64748b",
                background: "#1e293b",
                color: "white",
                fontSize: "22px",
              }}
            >
              ×
            </button>

            <button
              type="button"
              disabled={exitRequestWaiting}
              onClick={requestMatchExit}
              style={{
                width: "100%",
                minHeight: "44px",
                marginTop: "10px",
                borderRadius: "8px",
                border: "1px solid #ef4444",
                background: "#b91c1c",
                color: "white",
                fontWeight: 900,
              }}
            >
              {exitRequestWaiting ? "確認待ち" : "対戦終了"}
            </button>

            <button
              type="button"
              onClick={() => {
                setBoardMenuOpen(false);
                refreshPlayer(ownPlayerIndex);

                sendBoardAction({
                  actionType: "REFRESH_PLAYER",
                  payload: {
                    playerIndex: ownPlayerIndex,
                  },
                });
              }}
              style={{
                width: "100%",
                minHeight: "44px",
                marginTop: "8px",
                borderRadius: "8px",
                border: "1px solid #38bdf8",
                background: "#0369a1",
                color: "white",
                fontWeight: 900,
              }}
            >
              リフレッシュ
            </button>
          </div>
        </div>
      )}

      {incomingExitRequest && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000000,
            background: "rgba(0, 0, 0, 0.72)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            padding: "16px",
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              width: "min(360px, 92vw)",
              borderRadius: "12px",
              background: "#0f172a",
              color: "white",
              border: "2px solid #94a3b8",
              padding: "16px",
              boxShadow: "0 0 24px rgba(0,0,0,0.7)",
              display: "flex",
              flexDirection: "column",
              gap: "14px",
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontSize: "16px",
                fontWeight: 900,
              }}
            >
              相手が試合終了を希望しています。
            </div>

            <div
              style={{
                fontSize: "13px",
                lineHeight: 1.5,
              }}
            >
              同意すると、両者ともルーム画面へ戻ります。
            </div>

            <div
              style={{
                display: "flex",
                gap: "10px",
                justifyContent: "center",
              }}
            >
              <button
                onClick={() => {
                  setIncomingExitRequest(false);
                  sendMatchExitRejected();
                }}
                style={{
                  minWidth: "96px",
                  height: "36px",
                  borderRadius: "8px",
                  border: "1px solid #64748b",
                  background: "#334155",
                  color: "white",
                  fontWeight: 900,
                }}
              >
                拒否
              </button>

              <button
                onClick={() => {
                  setIncomingExitRequest(false);
                  sendMatchExitAccepted();
                  returnToRoomKeepingRoom();
                }}
                style={{
                  minWidth: "96px",
                  height: "36px",
                  borderRadius: "8px",
                  border: "1px solid #dc2626",
                  background: "#dc2626",
                  color: "white",
                  fontWeight: 900,
                }}
              >
                同意
              </button>
            </div>
          </div>
        </div>
      )}

      <DragOverlay
        zIndex={999999}
        dropAnimation={
          disableAttachedDonDropAnimation
            ? null
            : undefined
        }
      >
        {activeCard ? (
          <img
            src={activeCard.card.image}
            style={{
              width:
                activeCard.from === "donDeck" ||
                  activeCard.from === "activeDon" ||
                  activeCard.from === "restDon"
                  ? GAME_LAYOUT.css.donWidth
                  : GAME_LAYOUT.css.cardWidth,

              height: "auto",
              borderRadius: "8px",
              pointerEvents: "none",
            }}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
