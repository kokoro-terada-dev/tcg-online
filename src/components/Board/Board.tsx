import { useState } from "react";

import PlayerBoard from "./PlayerBoard";

import { useGameStore } from "../../store/gameStore";

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

type Props = {
  resetToDeckSelect: () => void;
};

type DragFrom =
  | "hand"
  | "character"
  | "stage"
  | "trash"
  | "life"
  | "deck"
  | "leader"
  | "donDeck"
  | "activeDon"
  | "restDon";

type DragCardInfo = {
  card: CardData;
  playerIndex: number;
  from: DragFrom;
};

export default function Board({
  resetToDeckSelect,
}: Props) {
  const players = useGameStore((x) => x.players);

  const localPlayerIndex =
    useGameStore(
      (x) => x.localPlayerIndex
    );

  const ownPlayerIndex =
    localPlayerIndex ?? 1;

  const opponentPlayerIndex =
    ownPlayerIndex === 0 ? 1 : 0;

  const refreshPlayer = useGameStore(
    (x) => x.refreshPlayer
  );

  const resetGameToMulligan =
    useGameStore(
      (s) => s.resetGameToMulligan
    );

  const undoLastAction = useGameStore(
    (s) => s.undoLastAction
  );

  const returnToTurnStart = useGameStore(
    (s) => s.returnToTurnStart
  );

  const canUndo = useGameStore(
    (s) => s.undoHistory.length > 0
  );

  const canReturnToTurnStart = useGameStore(
    (s) => s.turnStartSnapshot !== null
  );

  const [activeCard, setActiveCard] =
    useState<DragCardInfo | null>(null);

  const [, setPreviewImage] =
    useState<string | null>(null);

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

    if (!data) {
      return;
    }

    const player = players[data.playerIndex];

    if (!player) {
      return;
    }

    const allCards: CardData[] = [
      ...player.hand,
      ...player.deck,
      ...player.trash,
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

    setActiveCard(null);

    if (!over) {
      return;
    }

    const activeData = active.data.current as any;
    const overData = over.data.current as any;

    if (!activeData || !overData) {
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
        store.moveSelectedDonStack(overData.to);
      } else {
        store.moveDonBetweenAreas(
          activeData.playerIndex,
          activeData.cardId,
          activeData.from,
          overData.to
        );
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
        store.attachSelectedDonStack(overData.cardId);
      } else {
        store.attachDonFromArea(
          activeData.playerIndex,
          activeData.cardId,
          activeData.from,
          overData.cardId
        );
      }

      return;
    }

    if (
      activeData.type === "attached-don" &&
      overData.to === "activeDon"
    ) {
      store.returnAttachedDonToActive(
        activeData.playerIndex,
        activeData.targetCardId
      );

      return;
    }

    if (
      activeData.type === "attached-don" &&
      overData.to === "restDon"
    ) {
      store.returnAttachedDonToRest(
        activeData.playerIndex,
        activeData.targetCardId
      );

      return;
    }

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
      !movableSources.includes(activeData.from) ||
      !movableTargets.includes(overData.to)
    ) {
      return;
    }

    store.moveCard({
      playerIndex: activeData.playerIndex,
      cardId: activeData.cardId,
      from: activeData.from,
      to: overData.to,
      slotIndex: overData.slotIndex,
    });
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveCard(null)}
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

          <div
            style={{
              flexShrink: 0,

              display: "flex",
              justifyContent: "center",
              alignItems: "center",

              gap: "4px",
              padding: "2px 4px",

              fontSize: "clamp(10px, 2.8vw, 12px)",
              minHeight: "28px",
              marginTop: 0,
            }}
          >
            <button
              title="上プレイヤーリフレッシュ"
              aria-label="上プレイヤーリフレッシュ"
              onClick={() => {
                refreshPlayer(opponentPlayerIndex);
              }}
            >
              ⬆️
            </button>

            <button
              title="下プレイヤーリフレッシュ"
              aria-label="下プレイヤーリフレッシュ"
              onClick={() => {
                refreshPlayer(ownPlayerIndex);
              }}
            >
              ⬇️
            </button>

            <button
              title="一手戻し"
              aria-label="一手戻し"
              onClick={undoLastAction}
              disabled={!canUndo}
            >
              ◀
            </button>

            <button
              title="ターン開始時に戻す"
              aria-label="ターン開始時に戻す"
              onClick={returnToTurnStart}
              disabled={!canReturnToTurnStart}
            >
              ⏮
            </button>

            <button
              onClick={() => {
                const ok = window.confirm(
                  "リセットしますか？"
                );

                if (ok) {
                  resetGameToMulligan();
                }
              }}
            >
              リセット
            </button>

            <button
              onClick={() => {
                const result = window.confirm(
                  "試合を終了し、戻ります"
                );

                if (result) {
                  resetToDeckSelect();
                }
              }}
            >
              ×
            </button>
          </div>

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

      <DragOverlay zIndex={999999}>
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