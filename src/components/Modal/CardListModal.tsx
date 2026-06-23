import { useRef, useState } from "react";

import type { CardData } from "../../types/card";

import { getCardBackImageUrl } from "../../utils/localCardImages";

import {
  DndContext,
  closestCenter,
} from "@dnd-kit/core";

import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";

type Props = {
  title: string;
  cards: CardData[];
  open: boolean;
  onClose: () => void;
  onHand: (cardId: string) => void;
  onPublic: (cardId: string) => void;
  primaryActionLabel?: string;
  onTrash: (cardId: string) => void;
  onBottom: (cardId: string) => void;
  onLifeTop: (cardId: string) => void;
  onToggleFace: (cardId: string) => void;
  onOpenTopCards: (count: number) => void;
  zone:
  | "deck"
  | "life"
  | "trash";

  playerIndex: number;
  canOperate: boolean;
  canToggleFace: boolean;
  useSilentDeckLayout?: boolean;

  onReorder: (
    activeId: string,
    overId: string
  ) => void;
};

const actionButtonStyle = {
  fontSize: "11px",

  padding: "4px 4px",

  width: "100%",

  minWidth: 0,

  height: "32px",

  borderRadius: "6px",

  fontWeight: 700,

  whiteSpace: "nowrap",

  overflow: "hidden",

  textOverflow: "ellipsis",

  transition: "transform 0.08s ease, filter 0.08s ease",
};

export default function CardListModal({
  title,
  cards,
  open,
  onClose,
  onHand,
  onPublic,
  primaryActionLabel = "手札へ",
  onTrash,
  onBottom,
  onLifeTop,
  onToggleFace,
  onOpenTopCards,
  onReorder,
  canOperate,
  canToggleFace,
  useSilentDeckLayout = false,
  zone,
}: Props) {
  if (!open) {
    return null;
  }

  const isDeck = title === "Deck";
  const [previewImage, setPreviewImage] =
    useState<string | null>(null);
  const isHiddenList = title === "Deck" || title === "Life";

  const actionButtonStyle = {
    fontSize: "10px",

    padding: "2px 4px",

    minWidth: "48px",

    height: "24px",

    borderRadius: "6px",
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,

        width: "100vw",
        height: "100dvh",

        background: "rgba(0,0,0,0.85)",

        zIndex: 99999,

        display: "flex",
        justifyContent: "center",
        alignItems: "center",

        padding: "8px",

        boxSizing: "border-box",

        overflow: "hidden",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          height: "100%",

          maxWidth: "100vw",
          maxHeight: "100dvh",

          background: "#0f172a",

          borderRadius: "12px",

          display: "flex",
          flexDirection: "column",

          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 10,
            background: "#1e293b",
            padding: "8px",
            borderBottom: "1px solid #475569",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "8px",
              marginBottom: "8px",
            }}
          >
            <h2
              style={{
                fontSize: "18px",
                fontWeight: 900,
                color: "#f8fafc",
                letterSpacing: "0.5px",
                textShadow: "0 0 6px rgba(255,255,255,0.25)",
                margin: 0,
              }}
            >
              {title}
            </h2>

            <button
              style={{
                ...actionButtonStyle,
                background: "#dc2626",
                color: "white",
                border: "1px solid #991b1b",
                fontWeight: 900,
                minWidth: "64px",
                height: "30px",
              }}
              onClick={onClose}
            >
              閉じる
            </button>
          </div>

          {isDeck && canOperate && (
            <div
              style={{
                display: "flex",
                gap: "8px",
                flexWrap: "wrap",
              }}
            >
              <button
                style={{
                  ...actionButtonStyle,
                  fontSize: "13px",
                  minWidth: "72px",
                  height: "34px",
                  fontWeight: 800,
                }}
                onClick={() => onOpenTopCards(3)}
              >
                3枚見る
              </button>

              <button
                style={{
                  ...actionButtonStyle,
                  fontSize: "13px",
                  minWidth: "72px",
                  height: "34px",
                  fontWeight: 800,
                }}
                onClick={() => onOpenTopCards(4)}
              >
                4枚見る
              </button>

              <button
                style={{
                  ...actionButtonStyle,
                  fontSize: "13px",
                  minWidth: "72px",
                  height: "34px",
                  fontWeight: 800,
                }}
                onClick={() => onOpenTopCards(5)}
              >
                5枚見る
              </button>
            </div>
          )}
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,

            overflowY: "auto",
            overflowX: "hidden",

            padding: "8px",
          }}
        >
          {<DndContext
            collisionDetection={
              closestCenter
            }
            onDragEnd={(event) => {
              if (!canOperate) {
                return;
              }

              const { active, over } =
                event;

              if (
                !over ||
                active.id === over.id
              ) {
                return;
              }

              onReorder(
                String(active.id),
                String(over.id)
              );
            }}
          >
            <SortableContext
              items={cards.map(
                (x) => x.id
              )}
              strategy={
                verticalListSortingStrategy
              }
            >
              {cards.map((card) => {
                const isOpen =
                  !isHiddenList || card.isFaceUp;

                return (
                  <SortableCardRow
                    key={card.id}
                    card={card}
                    isOpen={isOpen}
                    isHiddenList={isHiddenList}
                    onToggleFace={onToggleFace}
                    primaryActionLabel={primaryActionLabel}
                    onHand={onHand}
                    onPublic={onPublic}
                    onTrash={onTrash}
                    onBottom={onBottom}
                    onLifeTop={onLifeTop}
                    onPreview={setPreviewImage}
                    canOperate={canOperate}
                    canToggleFace={canToggleFace}
                    canPreviewHiddenCard={zone === "deck"}
                    isDeck={isDeck && useSilentDeckLayout}
                  />
                );
              })}
            </SortableContext>
          </DndContext>}
        </div>

        {previewImage && (
          <div
            onClick={(e) => {
              e.stopPropagation();
              setPreviewImage(null);
            }}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 999999,
              background: "rgba(0,0,0,0.85)",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              padding: "12px",
              boxSizing: "border-box",
            }}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setPreviewImage(null);
              }}
              style={{
                position: "fixed",
                top: "12px",
                right: "12px",

                width: "42px",
                height: "42px",

                borderRadius: "999px",

                border: "2px solid white",

                background: "#dc2626",

                color: "white",

                fontSize: "24px",
                fontWeight: 900,

                display: "flex",
                justifyContent: "center",
                alignItems: "center",

                lineHeight: 1,

                padding: 0,

                zIndex: 1000000,
              }}
            >
              ×
            </button>

            <img
              src={previewImage}
              draggable={false}
              style={{
                maxWidth: "92vw",
                maxHeight: "92dvh",
                objectFit: "contain",
                borderRadius: "12px",
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function SortableCardRow({
  card,
  isOpen,
  isHiddenList,
  onToggleFace,
  primaryActionLabel,
  onHand,
  onPublic,
  onTrash,
  onBottom,
  onLifeTop,
  onPreview,
  canOperate,
  canToggleFace,
  canPreviewHiddenCard,
  isDeck,
}: {
  card: CardData;
  isOpen: boolean;
  isHiddenList: boolean;
  onToggleFace: (cardId: string) => void;
  primaryActionLabel: string;
  onHand: (cardId: string) => void;
  onPublic: (cardId: string) => void;
  onTrash: (cardId: string) => void;
  onBottom: (cardId: string) => void;
  onLifeTop: (cardId: string) => void;
  onPreview: (image: string) => void;
  canOperate: boolean;
  canToggleFace: boolean;
  canPreviewHiddenCard: boolean;
  isDeck: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({
    id: card.id,
    disabled: !canOperate,
  });

  const previewTimer = useRef<number | null>(null);

  function clearPreviewTimer() {
    if (previewTimer.current !== null) {
      clearTimeout(previewTimer.current);
      previewTimer.current = null;
    }
  }

  function pressButton(e: React.PointerEvent<HTMLButtonElement>) {
    e.currentTarget.style.transform = "scale(0.97)";
    e.currentTarget.style.filter = "brightness(1.2)";
  }

  function releaseButton(e: React.PointerEvent<HTMLButtonElement>) {
    e.currentTarget.style.transform = "scale(1)";
    e.currentTarget.style.filter = "brightness(1)";
  }

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: transform
          ? `translateY(${transform.y}px)`
          : undefined,
        transition,
        display: "flex",
        gap: "8px",
        alignItems: "center",

        minWidth: 0,
        background: "#334155",
        padding: "8px",
        borderRadius: "8px",
      }}
    >
      <img
        src={isOpen ? card.image : getCardBackImageUrl()}
        draggable={false}
        onTouchStart={(e) => {
          e.stopPropagation();

          clearPreviewTimer();

          previewTimer.current = window.setTimeout(() => {
            onPreview(
              isOpen || canPreviewHiddenCard
                ? card.image
                : getCardBackImageUrl()
            );
          }, 550);
        }}
        onTouchMove={() => {
          clearPreviewTimer();
        }}
        onTouchEnd={() => {
          clearPreviewTimer();
        }}
        onTouchCancel={() => {
          clearPreviewTimer();
        }}
        onMouseDown={(e) => {
          if (e.button !== 0) {
            return;
          }

          clearPreviewTimer();

          previewTimer.current = window.setTimeout(() => {
            onPreview(
              isOpen || canPreviewHiddenCard
                ? card.image
                : getCardBackImageUrl()
            );
          }, 550);
        }}
        onMouseUp={clearPreviewTimer}
        onMouseLeave={clearPreviewTimer}
        onClick={(e) => {
          e.stopPropagation();

          if (isHiddenList && canToggleFace) {
            onToggleFace(card.id);
          }
        }}
        style={{
          width: "80px",
          cursor:
            isHiddenList && canToggleFace
              ? "pointer"
              : "default",
          borderRadius: "6px",
          WebkitTouchCallout: "none",
          userSelect: "none",
        }}
      />

      {isHiddenList && canToggleFace && !canOperate && (
        <button
          type="button"
          style={actionButtonStyle}
          onClick={() => onToggleFace(card.id)}
        >
          表裏切替
        </button>
      )}

      {canOperate && <div
        style={{
          display: "grid",

          gridTemplateColumns:
            isDeck
              ? "repeat(3, minmax(0, 1fr))"
              : "repeat(2, minmax(0, 1fr))",

          gap: "6px",

          flex: 1,
          minWidth: 0,
        }}
      >
        <button
          style={{
            ...actionButtonStyle,
            ...(isDeck
              ? { gridColumn: "1", gridRow: "1" }
              : {}),
          }}
          onPointerDown={pressButton}
          onPointerUp={releaseButton}
          onPointerCancel={releaseButton}
          onPointerLeave={releaseButton}
          onClick={() => onHand(card.id)}
        >
          {isDeck ? "手札へ" : primaryActionLabel}
        </button>

        <button
          style={{
            ...actionButtonStyle,
            ...(isDeck
              ? { gridColumn: "2", gridRow: "1" }
              : {}),
          }}
          onPointerDown={pressButton}
          onPointerUp={releaseButton}
          onPointerCancel={releaseButton}
          onPointerLeave={releaseButton} onClick={() => onTrash(card.id)}>
          トラッシュへ
        </button>

        <button
          style={{
            ...actionButtonStyle,
            ...(isDeck
              ? { gridColumn: "1", gridRow: "2" }
              : {}),
          }}
          onPointerDown={pressButton}
          onPointerUp={releaseButton}
          onPointerCancel={releaseButton}
          onPointerLeave={releaseButton} onClick={() => onBottom(card.id)}>
          デッキ下へ
        </button>

        <button
          style={{
            ...actionButtonStyle,
            ...(isDeck
              ? { gridColumn: "2", gridRow: "2" }
              : {}),
          }}
          onPointerDown={pressButton}
          onPointerUp={releaseButton}
          onPointerCancel={releaseButton}
          onPointerLeave={releaseButton} onClick={() => onLifeTop(card.id)}>
          ライフ上へ
        </button>

        {isDeck && (
          <button
            style={{
              ...actionButtonStyle,
              gridColumn: "3",
              gridRow: "1 / span 2",
              height: "100%",
              minHeight: "70px",
              background: "#0369a1",
              color: "white",
            }}
            onPointerDown={pressButton}
            onPointerUp={releaseButton}
            onPointerCancel={releaseButton}
            onPointerLeave={releaseButton}
            onClick={() => onPublic(card.id)}
          >
            公開
          </button>
        )}
      </div>}

      {canOperate && <div
        {...attributes}
        {...listeners}
        style={{
          width: "36px",
          height: "36px",
          borderRadius: "8px",
          background: "#475569",
          color: "white",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          cursor: "grab",
          fontSize: "22px",
          fontWeight: "bold",
          userSelect: "none",
          touchAction: "none",
        }}
        title="並び替え"
      >
        ☰
      </div>}
    </div>
  );
}
