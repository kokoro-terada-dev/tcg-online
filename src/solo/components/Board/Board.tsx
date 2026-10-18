import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

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

  const turnRecords = useGameStore((s) => s.turnRecords);
  const currentTurnNumber = useGameStore((s) => s.currentTurnNumber);
  const restoreTurn = useGameStore((s) => s.restoreTurn);
  const beginDuel = useGameStore((s) => s.beginDuel);
  const [historyOpen, setHistoryOpen] = useState(false);
  useEffect(() => { beginDuel(); }, [beginDuel]);

  const canUndo = useGameStore(
    (s) => s.undoHistory.length > 0
  );


  const [activeCard, setActiveCard] =
    useState<DragCardInfo | null>(null);

  const [isDraggingAttachedDon, setIsDraggingAttachedDon] =
    useState(false);

  const [isDraggingLife, setIsDraggingLife] = useState(false);

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

    setIsDraggingAttachedDon(data.type === "attached-don");
    setIsDraggingLife(data.from === "life");

    if (data.from === "life") {
      const topCard = players[data.playerIndex]?.life[0];
      if (!topCard) return;
      data.cardId = topCard.id;
      data.card = topCard;
    }

    let card = data.card as CardData | undefined;

    if (!card) {
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

      card = allCards.find(
        (x) => x.id === data.cardId
      );
    }

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
      activeData.type !== "attached-don" &&
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
      overData.to === "donDeck"
    ) {
      store.returnAttachedDonToDeck(
        activeData.playerIndex,
        activeData.targetCardId
      );

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
              player={players[0]}
              playerIndex={0}
              onPreview={setPreviewImage}
              reversed
            />
          </div>

          <div
            className="solo-board-controls"
            style={{
              flexShrink: 0,

              display: "flex",
              justifyContent: "center",
              alignItems: "center",

              gap: "6px",
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
                refreshPlayer(0);
              }}
            >
              ⬆️
            </button>

            <button
              title="下プレイヤーリフレッシュ"
              aria-label="下プレイヤーリフレッシュ"
              onClick={() => {
                refreshPlayer(1);
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
              ◀️
            </button>

            <button
              title="ターン履歴"
              aria-label={`${currentTurnNumber}ターン目：ターン履歴を開く`}
              onClick={() => setHistoryOpen(true)}
            >
              {currentTurnNumber}
            </button>

            <button
              title="リセット"
              aria-label="リセット"
              onClick={() => {
                const ok = window.confirm(
                  "リセットしますか？"
                );

                if (ok) {
                  resetGameToMulligan();
                }
              }}
            >
              🔄
            </button>

            <button
              title="デッキ選択へ戻る"
              aria-label="デッキ選択へ戻る"
              onClick={() => {
                const result = window.confirm(
                  "試合を終了し、戻ります"
                );

                if (result) {
                  resetToDeckSelect();
                }
              }}
            >
              ❌
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
              player={players[1]}
              playerIndex={1}
              onPreview={setPreviewImage}
            />
          </div>
        </div>
      </div>

      {historyOpen && createPortal(
        <div onClick={() => setHistoryOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 1000000, background: "rgba(0,0,0,0.75)", padding: "16px", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <section role="dialog" aria-modal="true" aria-label="ターン履歴" onClick={(event) => event.stopPropagation()} style={{ width: "100%", maxWidth: "420px", maxHeight: "85dvh", display: "flex", flexDirection: "column", borderRadius: "8px", background: "#111827", color: "white", padding: "16px" }}>
            <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
              <h2 style={{ margin: 0, fontSize: "18px" }}>ターン履歴</h2>
              <button aria-label="閉じる" onClick={() => setHistoryOpen(false)} style={{ width: "36px", height: "36px" }}>×</button>
            </header>
            <div style={{ overflowY: "auto", touchAction: "pan-y", display: "flex", flexDirection: "column", gap: "8px", minHeight: 0 }}>
              {turnRecords.map((record, index) => <button key={index} onClick={() => {
                if (window.confirm(`${record.turnNumber}ターン目（${record.playerIndex === 0 ? "上側" : "下側"}）の開始時に盤面全体を戻しますか？`)) {
                  restoreTurn(index);
                  setHistoryOpen(false);
                  setActiveCard(null);
                }
              }} style={{ flexShrink: 0, minHeight: "48px", padding: "12px", borderRadius: "6px", textAlign: "left", border: currentTurnNumber === record.turnNumber ? "2px solid #38bdf8" : "1px solid #64748b", color: "white", background: "#1e293b" }}>
                {record.turnNumber}ターン目：{record.playerIndex === 0 ? "上側" : "下側"}
              </button>)}
            </div>
          </section>
        </div>, document.body
      )}

      <DragOverlay
        zIndex={999999}
        dropAnimation={isDraggingAttachedDon || isDraggingLife ? null : undefined}
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
