import { useEffect, useRef, useState } from "react";

import "./GameCard.css";

import type { CardData } from "../../types/card";

import { useGameStore } from "../../store/gameStore";

import { useDraggable } from "@dnd-kit/core";

import {
  getCardBackImageUrl,
  getDonDeckImageUrl
} from "../../utils/localCardImages";

import { createPortal } from "react-dom";

import { sendBoardAction } from "../../network/roomClient";
import type {
  ActionLog,
  CardMarkerType,
  QuickActionType,
} from "../../store/gameStore";

type CardFrom =
  | "hand"
  | "character"
  | "stage"
  | "trash"
  | "life"
  | "deck"
  | "public"
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

const MARKER_LABELS: Record<CardMarkerType, string> = {
  attackSource: "攻",
  attackTarget: "↓",
  target1: "①",
  target2: "②",
  target3: "③",
  effect: "効果",
  processing: "処理中",
  confirmRequest: "確認",
  confirmed: "OK",
  note: "！",
};

export default function GameCard({
  card,
  playerIndex,
  from,
  overlay = false,
  onPreview,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [quickMenuOpen, setQuickMenuOpen] = useState(false);
  const [quickMenuPosition, setQuickMenuPosition] = useState({
    left: 0,
    top: 0,
  });
  const [effectVisible, setEffectVisible] = useState(false);

  const longPressTimer = useRef<number | null>(null);
  const longPressTriggered = useRef(false);
  const pointerStartPos =
    useRef<{ x: number; y: number } | null>(null);

  const touchStartPos =
    useRef<{ x: number; y: number } | null>(null);

  function clearLongPressTimer() {
    if (longPressTimer.current !== null) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  const toggleRotate = useGameStore((x) => x.toggleRotate);
  const toggleCardFace = useGameStore((x) => x.toggleCardFace);
  const startAttack = useGameStore((x) => x.startAttack);
  const setAttackSource = useGameStore(
    (x) => x.setAttackSource
  );
  const changePower = useGameStore((x) => x.changePower);
  const changeCountModifier = useGameStore(
    (x) => x.changeCountModifier
  );
  const setStatusLabel = useGameStore((x) => x.setStatusLabel);
  const localPlayerIndex = useGameStore((x) => x.localPlayerIndex);
  const communicationMode = useGameStore(
    (x) => x.communicationMode
  );
  const isSilentMode = communicationMode === "silent";
  const returnAttachedDonsToRest = useGameStore(
    (x) => x.returnAttachedDonsToRest
  );
  const currentAttackSource = useGameStore(
    (x) => x.currentAttackSource
  );
  const currentAttackTarget = useGameStore(
    (x) => x.currentAttackTarget
  );
  const setAttackTarget = useGameStore(
    (x) => x.setAttackTarget
  );
  const clearAttackTarget = useGameStore(
    (x) => x.clearAttackTarget
  );
  const clearAttackState = useGameStore(
    (x) => x.clearAttackState
  );
  const addActionLog = useGameStore(
    (x) => x.addActionLog
  );
  const cardEffectSignal = useGameStore(
    (x) => x.cardEffectSignal
  );
  const showCardEffect = useGameStore(
    (x) => x.showCardEffect
  );
  const clearCardEffect = useGameStore(
    (x) => x.clearCardEffect
  );
  const clearCardMarkers = useGameStore(
    (x) => x.clearCardMarkers
  );
  const setCardMarker = useGameStore(
    (x) => x.setCardMarker
  );
  const cardMarkers = useGameStore(
    (x) => x.cardMarkers
  );

  const isOpponent =
    localPlayerIndex !== null &&
    playerIndex !== localPlayerIndex;

  const canOperate =
    localPlayerIndex === null ||
    playerIndex === localPlayerIndex;

  const isDraggable =
    !overlay &&
    canOperate &&
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
    from === "leader" ||
    from === "trash" ||
    from === "public";

  const canOpenQuickMenu =
    isSilentMode &&
    !overlay &&
    (from === "leader" ||
      from === "character" ||
      from === "stage" ||
      (from === "public" && canOperate)) &&
    (!isOpponent || from !== "stage");

  const isCurrentAttackSource =
    currentAttackSource?.playerIndex === playerIndex &&
    currentAttackSource.cardId === card.id;

  const isCurrentAttackTarget =
    currentAttackTarget?.playerIndex === playerIndex &&
    currentAttackTarget.cardId === card.id;
  const markersForThisCard = cardMarkers.filter(
    (marker) =>
      marker.playerIndex === playerIndex &&
      marker.cardId === card.id
  );

  function openCardMenu() {
    if (!overlay && canOpenMenu) {
      onPreview?.(null);
      setQuickMenuOpen(false);
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

    if (from === "public") {
      const targetIndex =
        player.publicCards.findIndex(
          (item) => item.id === card.id
        );

      if (targetIndex === -1) {
        return null;
      }

      return {
        targetArea: "public" as const,
        targetIndex,
      };
    }

    return null;
  }

  function createActionLog(
    actionType: QuickActionType
  ): ActionLog {
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      playerIndex: (localPlayerIndex ?? playerIndex) as 0 | 1,
      actionType,
      createdAt: Date.now(),
    };
  }

  function sendQuickAction(
    quickAction:
      | "attack"
      | "target"
      | "target1"
      | "target2"
      | "target3"
      | "effect"
      | "processing"
      | "confirmRequest"
      | "confirmed"
      | "note"
      | "rest"
      | "cancelSource"
      | "cancelTarget",
    log?: ActionLog
  ) {
    const targetInfo = getMenuTargetInfo();

    if (!targetInfo) {
      return;
    }

    sendBoardAction({
      actionType: "CARD_QUICK_ACTION",
      payload: {
        playerIndex: playerIndex as 0 | 1,
        targetArea: targetInfo.targetArea,
        targetIndex: targetInfo.targetIndex,
        quickAction,
        log,
      },
    });
  }

  function runQuickAction(
    action:
      | "attack"
      | "target"
      | "target1"
      | "target2"
      | "target3"
      | "effect"
      | "processing"
      | "confirmRequest"
      | "confirmed"
      | "note"
      | "rest"
      | "cancel"
  ) {
    if (!canOpenQuickMenu) {
      return;
    }

    if (action === "cancel") {
      clearAttackState();
      clearAttackTarget();
      clearCardEffect();
      clearCardMarkers();
      sendBoardAction({
        actionType: "CLEAR_CARD_ACTIONS",
        payload: {},
      });
      setQuickMenuOpen(false);
      return;
    }

    const pointer = {
      playerIndex: playerIndex as 0 | 1,
      cardId: card.id,
    };
    if (action === "attack") {
      if (!canOperate || from === "stage") {
        return;
      }
      const log = createActionLog("attack");
      startAttack(
        playerIndex as 0 | 1,
        card.id,
        log
      );
      sendQuickAction(action, log);
    } else if (action === "target") {
      if (!isOpponent || from === "stage") {
        return;
      }
      const log = createActionLog("target");
      setAttackTarget(pointer, log);
      sendQuickAction(action, log);
    } else if (
      action === "target1" ||
      action === "target2" ||
      action === "target3"
    ) {
      if (!isOpponent || from === "stage") {
        return;
      }
      const log = createActionLog(action);
      setCardMarker(
        {
          ...pointer,
          markerType: action,
          createdBy: (localPlayerIndex ?? playerIndex) as 0 | 1,
        },
        log
      );
      sendQuickAction(action, log);
    } else if (action === "effect") {
      if (!canOperate) {
        return;
      }
      const effectActionType =
        from === "leader"
          ? "leaderEffect"
          : from === "stage"
            ? "stageEffect"
            : from === "public"
              ? "effect"
            : "characterEffect";
      const log = createActionLog(effectActionType);
      showCardEffect({
        ...pointer,
        nonce: Date.now(),
      });
      setCardMarker(
        {
          ...pointer,
          markerType: "effect",
          createdBy: (localPlayerIndex ?? playerIndex) as 0 | 1,
        },
        from === "public" ? undefined : log
      );
      if (from === "public") {
        setAttackSource(pointer, log);
      }
      sendQuickAction(action, log);
    } else if (
      action === "processing" ||
      action === "confirmRequest" ||
      action === "confirmed" ||
      action === "note"
    ) {
      const markerType: CardMarkerType =
        action === "processing"
          ? "processing"
          : action === "confirmRequest"
            ? "confirmRequest"
            : action === "confirmed"
              ? "confirmed"
              : "note";

      if (
        (action === "processing" || action === "confirmRequest") &&
        !canOperate
      ) {
        return;
      }

      if (action === "confirmed" && !isOpponent) {
        return;
      }

      const log = createActionLog(action);
      setCardMarker(
        {
          ...pointer,
          markerType,
          createdBy: (localPlayerIndex ?? playerIndex) as 0 | 1,
        },
        log
      );
      sendQuickAction(action, log);
    } else {
      if (!canOperate) {
        return;
      }
      const log = createActionLog("rest");
      toggleRotate(playerIndex, card.id);
      addActionLog(log);
      sendQuickAction(action, log);
    }

    setQuickMenuOpen(false);
  }

  useEffect(() => {
    if (
      cardEffectSignal?.playerIndex !== playerIndex ||
      cardEffectSignal.cardId !== card.id
    ) {
      return;
    }

    setEffectVisible(true);
    const timer = window.setTimeout(
      () => {
        setEffectVisible(false);

        if (
          useGameStore.getState().cardEffectSignal?.nonce ===
          cardEffectSignal.nonce
        ) {
          clearCardEffect();
        }
      },
      1000
    );

    return () => window.clearTimeout(timer);
  }, [
    card.id,
    cardEffectSignal,
    clearCardEffect,
    playerIndex,
  ]);

  useEffect(() => {
    if (isDragging) {
      setQuickMenuOpen(false);
      longPressTriggered.current = true;
    }
  }, [isDragging]);

  function sendCardMenuAction(
    menuAction:
      | "TOGGLE_ROTATE"
      | "CHANGE_POWER"
      | "CHANGE_COUNT_MODIFIER"
      | "SET_STATUS_LABEL"
      | "RETURN_ATTACHED_DONS_TO_REST",
    options?: {
      amount?: number;
      label?: string;
    }
  ) {
    if (!canOperate) {
      return;
    }

    const targetInfo = getMenuTargetInfo();

    if (
      !targetInfo ||
      targetInfo.targetArea === "public"
    ) {
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
  const countModifier = card.countModifier ?? 0;
  const visibleStatusLabel =
    card.statusLabel &&
      !card.statusLabel.includes("アクティブ")
      ? "×"
      : null;
  const displayImage =
    from === "donDeck"
      ? getDonDeckImageUrl()
      : card.isFaceUp === false
        ? getCardBackImageUrl()
        : card.image;

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      data-card-id={card.id}
      data-player-index={playerIndex}
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
        zIndex:
          overlay || isDragging || menuOpen || quickMenuOpen
            ? 99999
            : 10,
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
        longPressTriggered.current = false;

        longPressTimer.current = window.setTimeout(() => {
          if (!isDragging) {
            longPressTriggered.current = true;
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
      onPointerDown={(e) => {
        listeners?.onPointerDown?.(e);

        if (!canOpenQuickMenu) {
          return;
        }

        pointerStartPos.current = {
          x: e.clientX,
          y: e.clientY,
        };
        longPressTriggered.current = false;
      }}
      onPointerMove={(e) => {
        if (!pointerStartPos.current) {
          return;
        }

        const distance = Math.hypot(
          e.clientX - pointerStartPos.current.x,
          e.clientY - pointerStartPos.current.y
        );

        if (distance > 10) {
          longPressTriggered.current = true;
          setQuickMenuOpen(false);
        }
      }}
      onPointerUp={(e) => {
        clearLongPressTimer();

        const start = pointerStartPos.current;
        pointerStartPos.current = null;

        if (
          !start ||
          !canOpenQuickMenu ||
          isDragging ||
          longPressTriggered.current
        ) {
          return;
        }

        const distance = Math.hypot(
          e.clientX - start.x,
          e.clientY - start.y
        );

        if (distance > 10) {
          return;
        }

        const rect =
          e.currentTarget.getBoundingClientRect();
        const menuWidth = 132;
        const menuHeight = isOpponent ? 250 : 300;
        const left = Math.min(
          window.innerWidth - menuWidth - 8,
          Math.max(8, rect.right + 6)
        );
        const top = Math.min(
          window.innerHeight - menuHeight - 8,
          Math.max(8, rect.top)
        );

        setQuickMenuPosition({ left, top });
        setQuickMenuOpen((open) => !open);
      }}
      onPointerCancel={() => {
        clearLongPressTimer();
        pointerStartPos.current = null;
        longPressTriggered.current = true;
      }}
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
          !isSilentMode &&
          canOperate &&
          (from === "leader" ||
            from === "character" ||
            from === "stage")
        ) {
          toggleRotate(playerIndex, card.id);
          sendCardMenuAction("TOGGLE_ROTATE");
          return;
        }

        if (
          !isSilentMode &&
          from === "public" &&
          canOperate
        ) {
          const player =
            useGameStore.getState().players[playerIndex];
          const cardIndex = player.publicCards.findIndex(
            (item) => item.id === card.id
          );

          if (cardIndex === -1) {
            return;
          }

          toggleCardFace(playerIndex, card.id);
          sendBoardAction({
            actionType: "TOGGLE_PUBLIC_CARD_FACE",
            payload: {
              playerIndex,
              cardIndex,
            },
          });
        }

      }}
    >
      <img
        src={displayImage}
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

      {countModifier !== 0 && (
        <div className="count-modifier">
          {countModifier > 0 ? `+${countModifier}` : countModifier}
        </div>
      )}

      {visibleStatusLabel && (
        <div className="status-label">{visibleStatusLabel}</div>
      )}

      {isSilentMode && isCurrentAttackTarget && (
        <div
          aria-label="攻撃対象"
          title="攻撃対象"
          style={{
            position: "absolute",
            inset: "-4px",
            border: "3px solid #facc15",
            borderRadius: "10px",
            boxShadow: "0 0 12px #facc15",
            pointerEvents: "none",
            zIndex: 1200,
          }}
        />
      )}

      {isSilentMode && isCurrentAttackSource && (
        <div
          aria-label="Attack source"
          style={{
            position: "absolute",
            inset: "-4px",
            border: "3px solid #f97316",
            borderRadius: "10px",
            boxShadow: "0 0 12px #f97316",
            pointerEvents: "none",
            zIndex: 1199,
          }}
        />
      )}

      {isSilentMode && effectVisible && (
        <div className="card-effect-toast" aria-live="polite">
          効果
        </div>
      )}

      {isSilentMode && markersForThisCard.length > 0 && (
        <div className="card-markers" aria-hidden="true">
          {markersForThisCard.slice(-5).map((marker) => (
            <span
              key={marker.id}
              className={`card-marker card-marker-${marker.markerType}`}
            >
              {MARKER_LABELS[marker.markerType]}
            </span>
          ))}
        </div>
      )}

      {card.attachedDonCount > 0 && (
        <DonBadge
          card={card}
          playerIndex={playerIndex}
          overlay={overlay}
          disabled={!canOperate}
        />
      )}

      {isSilentMode && quickMenuOpen &&
        createPortal(
          <>
            <button
              type="button"
              aria-label="Close quick actions"
              onClick={() => setQuickMenuOpen(false)}
              style={{
                position: "fixed",
                inset: 0,
                width: "100%",
                height: "100%",
                padding: 0,
                border: 0,
                background: "transparent",
                zIndex: 99990,
              }}
            />
            <div
              className="card-quick-actions"
              style={{
                left: quickMenuPosition.left,
                top: quickMenuPosition.top,
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              {!isOpponent &&
                (from === "leader" || from === "character") && (
                <button onClick={() => runQuickAction("attack")}>
                  アタック
                </button>
              )}
              {!isOpponent && (
                <button onClick={() => runQuickAction("effect")}>
                  効果
                </button>
              )}
              {!isOpponent && from !== "public" && (
                <button onClick={() => runQuickAction("processing")}>
                  処理中
                </button>
              )}
              {!isOpponent && from !== "public" && (
                <button onClick={() => runQuickAction("confirmRequest")}>
                  確認して
                </button>
              )}
              {!isOpponent && from !== "public" && (
                <button onClick={() => runQuickAction("note")}>
                  付箋
                </button>
              )}
              {!isOpponent && from !== "public" && (
                <button onClick={() => runQuickAction("rest")}>
                  {card.rotated ? "アクティブ" : "レスト"}
                </button>
              )}
              {isOpponent && from !== "stage" && (
                <button onClick={() => runQuickAction("target")}>
                  対象
                </button>
              )}
              {isOpponent && from !== "stage" && (
                <button onClick={() => runQuickAction("target1")}>
                  対象①
                </button>
              )}
              {isOpponent && from !== "stage" && (
                <button onClick={() => runQuickAction("target2")}>
                  対象②
                </button>
              )}
              {isOpponent && from !== "stage" && (
                <button onClick={() => runQuickAction("target3")}>
                  対象③
                </button>
              )}
              {isOpponent && (
                <button onClick={() => runQuickAction("confirmed")}>
                  確認OK
                </button>
              )}
              {isOpponent && (
                <button onClick={() => runQuickAction("note")}>
                  付箋
                </button>
              )}
              <button
                className="card-quick-actions-cancel"
                onClick={() => runQuickAction("cancel")}
              >
                キャンセル
              </button>
            </div>
          </>,
          document.body
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
            {isOpponent ||
              from === "hand" ||
              from === "stage" ||
              from === "trash" ||
              from === "public" ? (
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
                  src={displayImage}
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

                  {countModifier !== 0 && (
                    <div
                      style={{
                        position: "absolute",
                        top: "52px",
                        right: "8px",
                        minWidth: "52px",
                        height: "32px",
                        padding: "0 10px",
                        borderRadius: "999px",
                        background:
                          countModifier > 0 ? "#22c55e" : "#ef4444",
                        color: "#ffffff",
                        border: "2px solid white",
                        display: "flex",
                        justifyContent: "center",
                        alignItems: "center",
                        fontSize: "15px",
                        fontWeight: 900,
                        boxShadow: "0 0 10px rgba(0,0,0,0.8)",
                        zIndex: 10,
                      }}
                    >
                      {countModifier > 0
                        ? `+${countModifier}`
                        : countModifier}
                    </div>
                  )}

                  {visibleStatusLabel && (
                    <div
                      style={{
                        position: "absolute",
                        top: countModifier !== 0 ? "92px" : "52px",
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
                      {visibleStatusLabel}
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
                      setStatusLabel(playerIndex, card.id, "×");

                      sendCardMenuAction(
                        "SET_STATUS_LABEL",
                        {
                          label: "×",
                        }
                      );
                    }}
                  >
                    ×
                  </button>

                  <button
                    style={{
                      ...menuButtonStyle,
                      background: "#22c55e",
                    }}
                    onClick={() => {
                      changeCountModifier(playerIndex, card.id, 1);

                      sendCardMenuAction(
                        "CHANGE_COUNT_MODIFIER",
                        {
                          amount: 1,
                        }
                      );
                    }}
                  >
                    +1
                  </button>

                  <button
                    style={{
                      ...menuButtonStyle,
                      background: "#ef4444",
                    }}
                    onClick={() => {
                      changeCountModifier(playerIndex, card.id, -1);

                      sendCardMenuAction(
                        "CHANGE_COUNT_MODIFIER",
                        {
                          amount: -1,
                        }
                      );
                    }}
                  >
                    -1
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
  disabled,
}: {
  card: CardData;
  playerIndex: number;
  overlay: boolean;
  disabled: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    isDragging,
  } = useDraggable({
    id: `don-badge-${card.id}`,
    disabled: overlay || disabled,
    data: {
      type: "attached-don",
      targetCardId: card.id,
      playerIndex,
    },
  });

  const displayAttachedDonCount = isDragging
    ? Math.max(0, card.attachedDonCount - 1)
    : card.attachedDonCount;

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
        cursor: disabled ? "default" : "grab",
        opacity: displayAttachedDonCount > 0 ? 1 : 0,
        touchAction: "none",
      }}
    >
      ﾄﾞﾝ!!×{displayAttachedDonCount}
    </div>
  );
}
