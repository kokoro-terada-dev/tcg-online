import { useRef, useState } from "react";

import "./GameCard.css";

import type { CardData } from "../../types/card";

import { useGameStore } from "../../store/gameStore";

import { useDraggable } from "@dnd-kit/core";

import { getDonDeckImageUrl } from "../../utils/localCardImages";

import { createPortal } from "react-dom";

import { sendBoardAction } from "../../network/roomClient";

type CardFrom =
  | "hand"
  | "character"
  | "stage"
  | "trash"
  | "life"
  | "deck"
  | "don"
  | "leader"
  | "activeDon"
  | "restDon"
  | "donDeck";

type Props = {
  card: CardData;
  playerIndex: number;
  from: CardFrom;
  overlay?: boolean;
  onPreview?: (image: string | null) => void;
};

const menuButtonStyle = {
  width: "100px",
  height: "34px",
  fontSize: "12px",
  fontWeight: 1000,
  borderRadius: "8px",
  padding: "10px 10px",
  border: "1px solid #475569",
  background: "#54c9ff",
  color: "#ffffff",
  cursor: "pointer",
};

const menuButtonStylePowerPlus = {
  width: "100px",
  height: "34px",
  fontSize: "12px",
  fontWeight: 1000,
  borderRadius: "8px",
  padding: "10px 10px",
  border: "1px solid #475569",
  background: "#facc15",
  color: "#ffffff",
  cursor: "pointer",
};

const menuButtonStylePowerMinus = {
  width: "100px",
  height: "34px",
  fontSize: "12px",
  fontWeight: 1000,
  borderRadius: "8px",
  padding: "10px 10px",
  border: "1px solid #475569",
  background: "#ef4444",
  color: "#ffffff",
  cursor: "pointer",
};



export default function GameCard({
  card,
  playerIndex,
  from,
  overlay = false,
  onPreview,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);

  const longPressTimer = useRef<number | null>(null);

  const touchStartPos =
    useRef<{ x: number; y: number } | null>(null);

  function clearLongPressTimer() {
    if (longPressTimer.current !== null) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  const toggleRotate = useGameStore((x) => x.toggleRotate);
  const changePower = useGameStore((x) => x.changePower);
  const setStatusLabel = useGameStore((x) => x.setStatusLabel);
  const returnAttachedDonsToRest = useGameStore(
    (x) => x.returnAttachedDonsToRest
  );

  const isDraggable =
    !overlay &&
    from !== "leader";

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = useDraggable({
    id: card.id,

    disabled: !isDraggable,

    data: {
      cardId: card.id,
      from,
      playerIndex,
    },
  });

  const canOpenMenu =
    from === "hand" ||
    from === "stage" ||
    from === "character" ||
    from === "leader";

  function openCardMenu() {
    if (!overlay && canOpenMenu) {
      onPreview?.(null);
      setMenuOpen(true);
    }
  }

  function getMenuTargetInfo() {
    const player =
      useGameStore.getState().players[playerIndex];

    if (from === "leader") {
      return {
        targetArea: "leader" as const,
        targetIndex: 0,
      };
    }

    if (from === "stage") {
      return {
        targetArea: "stage" as const,
        targetIndex: 0,
      };
    }

    if (from === "character") {
      const targetIndex =
        player.characters.findIndex(
          (x) => x?.id === card.id
        );

      if (targetIndex === -1) {
        return null;
      }

      return {
        targetArea: "character" as const,
        targetIndex,
      };
    }

    return null;
  }

  function sendCardMenuAction(
    menuAction:
      | "TOGGLE_ROTATE"
      | "CHANGE_POWER"
      | "SET_STATUS_LABEL"
      | "RETURN_ATTACHED_DONS_TO_REST",
    options?: {
      amount?: number;
      label?: "アタック×" | "アクティブ×";
    }
  ) {
    const targetInfo = getMenuTargetInfo();

    if (!targetInfo) {
      return;
    }

    sendBoardAction({
      actionType: "CARD_MENU_ACTION",
      payload: {
        playerIndex,
        cardId: card.id,
        targetArea: targetInfo.targetArea,
        targetIndex: targetInfo.targetIndex,
        menuAction,
        amount: options?.amount,
        label: options?.label,
      },
    });
  }

  const powerModifier = card.powerModifier ?? 0;

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`game-card game-card-${from} ${card.rotated ? "rotated" : ""
        }`}
      style={{
        position: "relative",
        transform:
          !overlay && transform
            ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
            : undefined,
        cursor: isDraggable ? "grab" : "default",
        touchAction: "none",
        zIndex: overlay || isDragging || menuOpen ? 99999 : 10,
        opacity: isDragging && !overlay ? 0.2 : 1,
      }}
      onTouchStart={(e) => {
        if (!canOpenMenu || overlay) {
          return;
        }

        const touch = e.touches[0];

        touchStartPos.current = {
          x: touch.clientX,
          y: touch.clientY,
        };

        clearLongPressTimer();

        longPressTimer.current = window.setTimeout(() => {
          if (!isDragging) {
            openCardMenu();
          }
        }, 550);
      }}
      onTouchMove={(e) => {
        if (!touchStartPos.current) {
          return;
        }

        const touch = e.touches[0];

        const dx = Math.abs(
          touch.clientX - touchStartPos.current.x
        );

        const dy = Math.abs(
          touch.clientY - touchStartPos.current.y
        );

        if (dx > 8 || dy > 8) {
          clearLongPressTimer();
        }
      }}
      onTouchEnd={() => {
        clearLongPressTimer();
        touchStartPos.current = null;
      }}
      onTouchCancel={() => {
        clearLongPressTimer();
        touchStartPos.current = null;
      }}
      onPointerUp={clearLongPressTimer}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        openCardMenu();
      }}
      onClick={(e) => {
        e.stopPropagation();

        if (overlay) {
          return;
        }

        if (
          from === "leader" ||
          from === "character" ||
          from === "stage"
        ) {
          toggleRotate(playerIndex, card.id);

          sendCardMenuAction("TOGGLE_ROTATE");
        }
      }}
    >
      <img
        src={from === "donDeck" ? getDonDeckImageUrl() : card.image}
        draggable={false}
        style={{
          pointerEvents: "none",
        }}
      />

      {powerModifier !== 0 && (
        <div className="power-modifier">
          {powerModifier > 0 ? `+${powerModifier}` : powerModifier}
        </div>
      )}

      {card.statusLabel && (
        <div className="status-label">{card.statusLabel}</div>
      )}

      {card.attachedDonCount > 0 && (
        <DonBadge card={card} playerIndex={playerIndex} overlay={overlay} />
      )}

      {menuOpen &&
        createPortal(
          <div
            className="card-menu-backdrop"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(false);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenuOpen(false);
            }}
          >
            {from === "hand" || from === "stage" ? (
              <div
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                style={{
                  position: "relative",
                  maxWidth: "92vw",
                  maxHeight: "92dvh",
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                <button
                  onClick={() => setMenuOpen(false)}
                  style={{
                    position: "absolute",
                    top: "8px",
                    right: "8px",

                    width: "40px",
                    height: "40px",

                    borderRadius: "999px",
                    border: "2px solid white",

                    background: "#dc2626",
                    color: "white",

                    fontSize: "22px",
                    fontWeight: 900,

                    zIndex: 100,
                    cursor: "pointer",
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                  }}
                >
                  ×
                </button>

                <img
                  src={card.image}
                  draggable={false}
                  style={{
                    maxWidth: "92vw",
                    maxHeight: "92dvh",
                    objectFit: "contain",
                    borderRadius: "12px",
                    display: "block",
                    pointerEvents: "none",
                  }}
                />
              </div>
            ) : (
              <div
                className="card-menu-modal"
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
              >
                <div
                  style={{
                    position: "relative",
                    flexShrink: 0,
                  }}
                >
                  <img
                    src={card.image}
                    draggable={false}
                    style={{
                      width: "min(500px, 60vw)",
                      borderRadius: "10px",
                      transform: "rotate(0deg)",
                      display: "block",
                      pointerEvents: "none",
                    }}
                  />

                  {powerModifier !== 0 && (
                    <div
                      style={{
                        position: "absolute",
                        top: "8px",
                        right: "8px",
                        minWidth: "72px",
                        height: "36px",
                        padding: "0 12px",
                        borderRadius: "999px",
                        background:
                          powerModifier > 0 ? "#facc15" : "#ef4444",
                        color:
                          powerModifier > 0 ? "#111827" : "#ffffff",
                        border: "2px solid white",
                        display: "flex",
                        justifyContent: "center",
                        alignItems: "center",
                        fontSize: "16px",
                        fontWeight: 900,
                        boxShadow: "0 0 12px rgba(0,0,0,0.8)",
                        zIndex: 10,
                      }}
                    >
                      {powerModifier > 0
                        ? `+${powerModifier}`
                        : powerModifier}
                    </div>
                  )}

                  {card.statusLabel && (
                    <div
                      style={{
                        position: "absolute",
                        top: "52px",
                        right: "8px",
                        padding: "4px 10px",
                        borderRadius: "999px",
                        background: "#38bdf8",
                        color: "#0f172a",
                        border: "2px solid white",
                        fontSize: "12px",
                        fontWeight: 900,
                        boxShadow: "0 0 10px rgba(0,0,0,0.8)",
                      }}
                    >
                      {card.statusLabel}
                    </div>
                  )}

                  {card.attachedDonCount > 0 && (
                    <div
                      style={{
                        position: "absolute",
                        bottom: "8px",
                        right: "8px",
                        padding: "4px 10px",
                        borderRadius: "999px",
                        background: "#ffffff",
                        color: "#111827",
                        border: "2px solid #facc15",
                        fontSize: "12px",
                        fontWeight: 900,
                        boxShadow: "0 0 10px rgba(0,0,0,0.8)",
                      }}
                    >
                      DON×{card.attachedDonCount}
                    </div>
                  )}
                </div>

                <div
                  className="card-menu-buttons"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "20px",
                    alignItems: "center",
                  }}
                >
                  <button
                    style={menuButtonStylePowerPlus}
                    onClick={() => {
                      changePower(playerIndex, card.id, 1000);

                      sendCardMenuAction(
                        "CHANGE_POWER",
                        {
                          amount: 1000,
                        }
                      );
                    }}
                  >
                    パワー+1000
                  </button>

                  <button
                    style={menuButtonStylePowerMinus}
                    onClick={() => {
                      changePower(playerIndex, card.id, -1000);

                      sendCardMenuAction(
                        "CHANGE_POWER",
                        {
                          amount: -1000,
                        }
                      );
                    }}
                  >
                    パワー-1000
                  </button>

                  <button
                    style={menuButtonStyle}
                    onClick={() => {
                      setStatusLabel(playerIndex, card.id, "アタック×");

                      sendCardMenuAction(
                        "SET_STATUS_LABEL",
                        {
                          label: "アタック×",
                        }
                      );
                    }}
                  >
                    アタック×
                  </button>

                  <button
                    style={menuButtonStyle}
                    onClick={() => {
                      setStatusLabel(playerIndex, card.id, "アクティブ×");

                      sendCardMenuAction(
                        "SET_STATUS_LABEL",
                        {
                          label: "アクティブ×",
                        }
                      );
                    }}
                  >
                    アクティブ×
                  </button>

                  <div
                    style={{
                      height: "46px",
                      display: "flex",
                      alignItems: "flex-end",
                      justifyContent: "center",
                    }}
                  >
                    <button
                      style={{
                        ...menuButtonStyle,
                        height: "44px",
                        fontSize: "11px",
                        lineHeight: 1.1,
                        textAlign: "center",

                        display: "flex",
                        justifyContent: "center",
                        alignItems: "center",
                        flexDirection: "column",

                        background: "#fa9e15",
                        color: "#111827",

                        opacity:
                          card.attachedDonCount > 0 ? 1 : 0,

                        pointerEvents:
                          card.attachedDonCount > 0
                            ? "auto"
                            : "none",
                      }}
                      onClick={() => {
                        returnAttachedDonsToRest(playerIndex, card.id);

                        sendCardMenuAction(
                          "RETURN_ATTACHED_DONS_TO_REST"
                        );
                      }}
                    >
                      付与ドン!!
                      <br />
                      を戻す
                    </button>
                  </div>

                  <button
                    style={{
                      ...menuButtonStyle,
                      background: "#ff2222",
                      color: "#ffffff",
                      textAlign: "center",

                      display: "flex",
                      justifyContent: "center",
                      alignItems: "center",
                      flexDirection: "column",
                    }}
                    className="card-menu-close"
                    onClick={() => setMenuOpen(false)}
                  >
                    閉じる
                  </button>
                </div>
              </div>
            )}
          </div>
          ,
          document.body
        )}
    </div>
  );
}

function DonBadge({
  card,
  playerIndex,
  overlay,
}: {
  card: CardData;
  playerIndex: number;
  overlay: boolean;
}) {
  const { attributes, listeners, setNodeRef } = useDraggable({
    id: `don-badge-${card.id}`,
    disabled: overlay,
    data: {
      type: "attached-don",
      targetCardId: card.id,
      playerIndex,
    },
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={(e) => {
        e.stopPropagation();
      }}
      style={{
        position: "absolute",
        right: "0px",
        bottom: "0px",
        width: "60px",
        height: "25px",
        color: "#111827",
        background: "rgba(255, 255, 255, 0.92)",
        border: "2px solid #001a3f",
        borderRadius: "6px",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        fontSize: "14px",
        fontWeight: "bold",
        boxShadow: "0 0 10px rgba(0,0,0,0.6)",
        zIndex: 999,
        cursor: "pointer",
      }}
    >
      ﾄﾞﾝ!!×{card.attachedDonCount}
    </div>
  );
}