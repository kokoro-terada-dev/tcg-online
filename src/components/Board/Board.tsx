import {
  useEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

import PlayerBoard from "./PlayerBoard";
import ActionLogBar from "./ActionLogBar";
import AttackArrow from "./AttackArrow";
import ChatControls from "./ChatControls";
import GameCard from "../Card/GameCard";

import { useGameStore } from "../../store/gameStore";

import {
  clearClientRoomState,
  onBoardAction,
  onMatchExitAccepted,
  onMatchExitRejected,
  onMatchExitRequest,
  onOpponentDisconnected,
  onRoomClosed,
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
  closestCenter,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  useDroppable,
} from "@dnd-kit/core";

import type {
  CollisionDetection,
  Collision,
  DragEndEvent,
  DragStartEvent,
} from "@dnd-kit/core";

import type { CardData } from "../../types/card";

import { GAME_LAYOUT } from "../../layout/gameLayout";
import {
  getCardBackImageUrl,
  getDonImageUrl,
} from "../../utils/localCardImages";

type DragFrom =
  | "hand"
  | "character"
  | "stage"
  | "trash"
  | "life"
  | "deck"
  | "public"
  | "counter"
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
  | "public"
  | "counter";

function prioritizeCounterCollision(
  collisions: Collision[],
  counterId: string | null
) {
  if (!counterId) {
    return null;
  }

  const counterCollision = collisions.find(
    (collision) => collision.id === counterId
  );

  return counterCollision ? [counterCollision] : null;
}

const boardCollisionDetection: CollisionDetection = (args) => {
  const state = useGameStore.getState();
  const phase = state.counterPhase;
  const activeData = args.active.data.current as any;
  const isCounterMove =
    phase &&
    activeData?.playerIndex === phase.playerIndex &&
    (activeData.from === "hand" ||
      activeData.from === "counter");
  const counterId = isCounterMove
    ? `counter-${phase.playerIndex}`
    : null;

  const pointerCollisions = pointerWithin(args);
  const pointerCounter = prioritizeCounterCollision(
    pointerCollisions,
    counterId
  );

  if (pointerCounter) {
    return pointerCounter;
  }

  if (pointerCollisions.length > 0) {
    return pointerCollisions;
  }

  const rectangleCollisions = rectIntersection(args);
  const rectangleCounter = prioritizeCounterCollision(
    rectangleCollisions,
    counterId
  );

  if (rectangleCounter) {
    return rectangleCounter;
  }

  if (rectangleCollisions.length > 0) {
    return rectangleCollisions;
  }

  const centerCollisions = closestCenter(args);
  const centerCounter = prioritizeCounterCollision(
    centerCollisions,
    counterId
  );

  return centerCounter ?? centerCollisions;
};

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
    value === "public" ||
    value === "counter"
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

  if (area === "counter") {
    return player.counterCards.findIndex((x) => x.id === cardId);
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

  if (area === "counter") {
    return player.counterCards[index]?.id;
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

function getCounterTargetCard(
  player: ReturnType<typeof useGameStore.getState>["players"][number],
  targetArea: "leader" | "character",
  targetIndex: number
) {
  if (targetArea === "leader") {
    return player.leader;
  }

  return player.characters[targetIndex] ?? null;
}

function findPlayerCardById(
  player: ReturnType<typeof useGameStore.getState>["players"][number],
  cardId: string
) {
  const allCards = [
    player.leader,
    player.stage,
    ...player.characters,
    ...player.hand,
    ...player.deck,
    ...player.trash,
    ...player.publicCards,
    ...player.counterCards,
    ...player.life,
    ...player.activeDons,
    ...player.restDons,
    ...player.donDeck,
  ];

  return allCards.find(
    (card): card is CardData => card?.id === cardId
  ) ?? null;
}

function getPowerModifierLabel(card: CardData | null) {
  const powerModifier = card?.powerModifier ?? 0;

  if (powerModifier === 0) {
    return null;
  }

  return powerModifier > 0
    ? `+${powerModifier}`
    : `${powerModifier}`;
}

function CounterPhasePanel({
  phase,
}: {
  phase: NonNullable<ReturnType<typeof useGameStore.getState>["counterPhase"]>;
}) {
  const players = useGameStore((x) => x.players);
  const localPlayerIndex = useGameStore((x) => x.localPlayerIndex);
  const adjustCounterPower = useGameStore(
    (x) => x.adjustCounterPower
  );
  const cancelCounterPhase = useGameStore(
    (x) => x.cancelCounterPhase
  );
  const confirmCounterPhase = useGameStore(
    (x) => x.confirmCounterPhase
  );
  const clearAttackState = useGameStore(
    (x) => x.clearAttackState
  );
  const clearCardEffect = useGameStore(
    (x) => x.clearCardEffect
  );
  const clearCardMarkers = useGameStore(
    (x) => x.clearCardMarkers
  );
  const currentAttackSource = useGameStore(
    (x) => x.currentAttackSource
  );

  const player = players[phase.playerIndex];
  const targetCard = getCounterTargetCard(
    player,
    phase.targetArea,
    phase.targetIndex
  );
  const attackSourceCard = currentAttackSource
    ? findPlayerCardById(
      players[currentAttackSource.playerIndex],
      currentAttackSource.cardId
    )
    : null;
  const sourcePowerLabel = getPowerModifierLabel(attackSourceCard);
  const targetPowerLabel = getPowerModifierLabel(targetCard);
  const canCounterPlayerOperate =
    localPlayerIndex === null ||
    localPlayerIndex === phase.playerIndex;
  const canConfirmPlayerOperate =
    localPlayerIndex === null ||
    localPlayerIndex !== phase.playerIndex;
  const counterCardWidth = canCounterPlayerOperate
    ? "clamp(64px, 18vw, 82px)"
    : "clamp(68px, 19vw, 86px)";
  const targetCardWidth = canCounterPlayerOperate
    ? "clamp(90px, 24vw, 110px)"
    : "clamp(96px, 26vw, 118px)";
  const relationCardWidth = attackSourceCard
    ? "clamp(76px, 21vw, 96px)"
    : targetCardWidth;
  const relationPanelWidth = attackSourceCard
    ? "min(92vw, 260px)"
    : targetCardWidth;
  const relationBackgroundWidth = "100%";
  const counterCardOverlap = canCounterPlayerOperate
    ? Math.min(
      48,
      Math.max(24, player.counterCards.length * 8)
    )
    : 28;

  const { setNodeRef, isOver } = useDroppable({
    id: `counter-${phase.playerIndex}`,
    disabled: !canCounterPlayerOperate,
    data: {
      to: "counter",
      playerIndex: phase.playerIndex,
    },
  });

  function sendCounterAction(
    payload:
      | {
        counterAction: "ADJUST";
        amount: number;
      }
      | {
        counterAction: "CANCEL" | "CONFIRM";
      }
  ) {
    sendBoardAction({
      actionType: "COUNTER_PHASE_ACTION",
      payload,
    });
  }

  function adjust(amount: number) {
    if (!canCounterPlayerOperate) {
      return;
    }

    adjustCounterPower(amount);
    sendCounterAction({
      counterAction: "ADJUST",
      amount,
    });
  }

  function cancel() {
    if (!canCounterPlayerOperate) {
      return;
    }

    cancelCounterPhase();
    sendCounterAction({
      counterAction: "CANCEL",
    });
  }

  function confirm() {
    if (!canConfirmPlayerOperate) {
      return;
    }

    confirmCounterPhase();
    clearAttackState();
    clearCardEffect();
    clearCardMarkers();
    sendCounterAction({
      counterAction: "CONFIRM",
    });
  }

  return (
    <div
      style={{
        position: "fixed",
        left: "50%",
        top: "50%",
        transform: "translate(-50%, -50%)",
        width: "min(94vw, 520px)",
        maxWidth: "calc(100vw - 12px)",
        zIndex: 100010,
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      {targetCard && (
        <div
          style={{
            width: relationBackgroundWidth,
            boxSizing: "border-box",
            minHeight: canCounterPlayerOperate
              ? undefined
              : "158px",
            padding: "10px",
            borderRadius: "8px",
            border: "1px solid #38bdf8",
            background: "rgba(15, 23, 42, 0.96)",
            boxShadow: "0 10px 24px rgba(0,0,0,0.5)",
            pointerEvents: "auto",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <div
            style={{
              width: relationPanelWidth,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
            }}
          >
            {attackSourceCard && (
              <>
                <CounterRelationCard
                  card={attackSourceCard}
                  powerLabel={sourcePowerLabel}
                  width={relationCardWidth}
                />
                <CounterRelationArrow />
              </>
            )}
            <CounterRelationCard
              card={targetCard}
              powerLabel={targetPowerLabel}
              width={relationCardWidth}
            >
              <div
                style={{
                  position: "absolute",
                  left: "50%",
                  top: "50%",
                  transform: "translate(-50%, -50%)",
                  minWidth: attackSourceCard ? "48px" : "70px",
                  padding: attackSourceCard ? "3px 6px" : "4px 8px",
                  borderRadius: "999px",
                  border: "3px solid #ffffff",
                  background: "#ffffff",
                  color: "#111827",
                  fontSize: attackSourceCard ? "15px" : "20px",
                  fontWeight: 1000,
                  textAlign: "center",
                  boxShadow: "0 0 12px rgba(0,0,0,0.72)",
                  pointerEvents: "none",
                  zIndex: 3,
                }}
              >
                {phase.power >= 0 ? `+${phase.power}` : phase.power}
              </div>
            </CounterRelationCard>
          </div>

          {canCounterPlayerOperate && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "7px",
                width: attackSourceCard
                  ? "min(240px, 76vw)"
                  : "min(220px, 70vw)",
              }}
            >
              <button
                type="button"
                onClick={() => adjust(1000)}
                style={counterButtonStyle("#facc15", "#111827", 44)}
              >
                +1000
              </button>
              <button
                type="button"
                onClick={() => adjust(-1000)}
                style={counterButtonStyle("#ef4444", "#ffffff", 44)}
              >
                -1000
              </button>
            </div>
          )}
        </div>
      )}

      <div
        ref={setNodeRef}
        style={{
          width: "100%",
          padding: "8px",
          borderRadius: "8px",
          border: "1px solid #38bdf8",
          background: "rgba(15, 23, 42, 0.96)",
          boxShadow: "0 10px 24px rgba(0,0,0,0.5)",
          pointerEvents: "auto",
        }}
      >
        <div
          style={{
            marginBottom: "6px",
            color: "#e0f2fe",
            fontSize: "12px",
            fontWeight: 1000,
          }}
        >
          カウンター
        </div>

        <div
          style={{
            minHeight: canCounterPlayerOperate ? "148px" : "166px",
            padding: "6px",
            borderRadius: "7px",
            border: `2px dashed ${isOver ? "#facc15" : "#475569"}`,
            background: isOver
              ? "rgba(250, 204, 21, 0.16)"
              : "rgba(2, 6, 23, 0.72)",
            display: "flex",
            gap: "5px",
            alignItems: "center",
            overflowX: canCounterPlayerOperate
              ? "hidden"
              : "auto",
            overflowY: "hidden",
          }}
        >
          {player.counterCards.length === 0 && (
            <div
              style={{
                color: "#94a3b8",
                fontSize: "11px",
                fontWeight: 800,
              }}
            >
              {canCounterPlayerOperate
                ? "手札からカードを置いてください"
                : "相手がカウンターします"}
            </div>
          )}
          {player.counterCards.map((card, index) => (
            <div
              key={card.id}
              style={{
                width: counterCardWidth,
                flexShrink: 0,
                marginLeft: index === 0
                  ? 0
                  : `-${counterCardOverlap}px`,
                zIndex: index + 1,
              }}
            >
              <GameCard
                card={card}
                playerIndex={phase.playerIndex}
                from="counter"
              />
            </div>
          ))}
        </div>

        <div
          style={{
            marginTop: "7px",
            display: "flex",
            gap: "6px",
            justifyContent: "flex-end",
          }}
        >
          {canCounterPlayerOperate && (
            <button
              type="button"
              onClick={cancel}
              style={counterButtonStyle("#475569", "#ffffff", 42)}
            >
              キャンセル
            </button>
          )}
          {canConfirmPlayerOperate && (
            <button
              type="button"
              onClick={confirm}
              style={counterButtonStyle("#0369a1", "#ffffff", 42)}
            >
              OK
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function CounterRelationCard({
  card,
  powerLabel,
  width,
  children,
}: {
  card: CardData;
  powerLabel: string | null;
  width: string;
  children?: ReactNode;
}) {
  return (
    <div
      style={{
        width,
        flexShrink: 0,
      }}
    >
      <div
        style={{
          position: "relative",
          width,
        }}
      >
        <img
          src={card.image}
          draggable={false}
          style={{
            width: "100%",
            borderRadius: "8px",
            display: "block",
          }}
        />
        {powerLabel && (
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "-10px",
              transform: "translateX(-50%)",
              padding: "2px clamp(5px, 2vw, 8px)",
              borderRadius: "999px",
              background: "#facc15",
              color: "#111827",
              fontSize: "clamp(10px, 3.5vw, 14px)",
              fontWeight: "bold",
              textAlign: "center",
              pointerEvents: "none",
              zIndex: 1500,
            }}
          >
            {powerLabel}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

function CounterRelationArrow() {
  return (
    <svg
      aria-hidden="true"
      width="38"
      height="18"
      viewBox="0 0 38 18"
      style={{
        flexShrink: 0,
        overflow: "visible",
      }}
    >
      <defs>
        <marker
          id="counter-relation-arrow-head"
          markerWidth="8"
          markerHeight="8"
          refX="7"
          refY="4"
          orient="auto"
        >
          <path d="M0,0 L8,4 L0,8 Z" fill="#facc15" />
        </marker>
      </defs>
      <line
        x1="1"
        y1="9"
        x2="36"
        y2="9"
        stroke="rgba(15, 23, 42, 0.8)"
        strokeWidth="8"
        strokeLinecap="round"
      />
      <line
        x1="1"
        y1="9"
        x2="36"
        y2="9"
        stroke="#facc15"
        strokeWidth="4"
        strokeLinecap="round"
        markerEnd="url(#counter-relation-arrow-head)"
      />
    </svg>
  );
}

function DamagePhasePanel({
  phase,
}: {
  phase: NonNullable<ReturnType<typeof useGameStore.getState>["damagePhase"]>;
}) {
  const [previewImage, setPreviewImage] =
    useState<string | null>(null);
  const players = useGameStore((x) => x.players);
  const localPlayerIndex = useGameStore((x) => x.localPlayerIndex);
  const moveDamageLifeToHand = useGameStore(
    (x) => x.moveDamageLifeToHand
  );
  const triggerDamageLife = useGameStore(
    (x) => x.triggerDamageLife
  );
  const showCardEffect = useGameStore(
    (x) => x.showCardEffect
  );
  const highlightPublicArea = useGameStore(
    (x) => x.highlightPublicArea
  );
  const clearAttackState = useGameStore(
    (x) => x.clearAttackState
  );
  const clearCardEffect = useGameStore(
    (x) => x.clearCardEffect
  );
  const clearCardMarkers = useGameStore(
    (x) => x.clearCardMarkers
  );
  const addActionLog = useGameStore(
    (x) => x.addActionLog
  );

  const player = players[phase.playerIndex];
  const lifeCard =
    player.life[phase.lifeIndex] ??
    null;
  const canOperate =
    localPlayerIndex === null ||
    localPlayerIndex === phase.playerIndex;
  const displayImage =
    canOperate && lifeCard
      ? lifeCard.image
      : getCardBackImageUrl();

  function sendDamageAction(
    damageAction: "TO_HAND" | "TRIGGER",
    log?: ReturnType<typeof useGameStore.getState>["actionLogs"][number]
  ) {
    sendBoardAction({
      actionType: "DAMAGE_PHASE_ACTION",
      payload: {
        damageAction,
        log,
      },
    });
  }

  function finishCommon() {
    clearAttackState();
    clearCardEffect();
    clearCardMarkers();
  }

  function moveToHand() {
    if (!canOperate || !lifeCard) {
      return;
    }

    moveDamageLifeToHand();
    finishCommon();
    sendDamageAction("TO_HAND");
  }

  function trigger() {
    if (!canOperate || !lifeCard) {
      return;
    }

    const cardId = lifeCard.id;
    const log = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      playerIndex: (localPlayerIndex ?? phase.playerIndex) as 0 | 1,
      actionType: "trigger" as const,
      createdAt: Date.now(),
    };

    triggerDamageLife();
    addActionLog(log);
    highlightPublicArea(phase.playerIndex);
    showCardEffect({
      playerIndex: phase.playerIndex,
      cardId,
      nonce: Date.now(),
      label: "トリガー",
      background: "#facc15",
      color: "#111827",
    });
    clearAttackState();
    sendDamageAction("TRIGGER", log);
  }

  return (
    <div
      style={{
        position: "fixed",
        left: "50%",
        top: "50%",
        transform: "translate(-50%, -50%)",
        width: "min(92vw, 360px)",
        zIndex: 100010,
        padding: "12px",
        borderRadius: "10px",
        border: "1px solid #facc15",
        background: "rgba(15, 23, 42, 0.97)",
        boxShadow: "0 14px 32px rgba(0,0,0,0.6)",
        pointerEvents: "auto",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        alignItems: "center",
      }}
    >
      <div
        style={{
          color: "#fef3c7",
          fontSize: "15px",
          fontWeight: 1000,
        }}
      >
        ダメージ
      </div>

      <img
        src={displayImage}
        draggable={false}
        onClick={() => setPreviewImage(displayImage)}
        onContextMenu={(e) => {
          e.preventDefault();
          setPreviewImage(displayImage);
        }}
        style={{
          width: "clamp(110px, 34vw, 148px)",
          borderRadius: "8px",
          boxShadow: "0 8px 18px rgba(0,0,0,0.45)",
          cursor: "pointer",
        }}
      />

      <div
        style={{
          color: "#e2e8f0",
          fontSize: "12px",
          fontWeight: 800,
          textAlign: "center",
        }}
      >
        {canOperate
          ? "ライフを確認してください"
          : "相手がライフを確認しています"}
      </div>

      {canOperate && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "8px",
            width: "100%",
          }}
        >
          <button
            type="button"
            onClick={moveToHand}
            style={counterButtonStyle("#0369a1", "#ffffff", 44)}
          >
            手札へ
          </button>
          <button
            type="button"
            onClick={trigger}
            style={counterButtonStyle("#facc15", "#111827", 44)}
          >
            トリガー発動
          </button>
        </div>
      )}

      {previewImage && (
        <div
          onClick={() => setPreviewImage(null)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000000,
            background: "rgba(0,0,0,0.86)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            padding: "12px",
            boxSizing: "border-box",
          }}
        >
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
  );
}

function counterButtonStyle(
  background: string,
  color: string,
  minHeight = 34
) {
  return {
    minHeight: `${minHeight}px`,
    borderRadius: "6px",
    border: "1px solid rgba(255,255,255,0.24)",
    background,
    color,
    fontSize: "12px",
    fontWeight: 1000,
  };
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
  const counterPhase = useGameStore(
    (x) => x.counterPhase
  );
  const damagePhase = useGameStore(
    (x) => x.damagePhase
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
    state.clearAttackState();
    state.clearCardEffect();
    state.clearCardMarkers();
    setQuickChatOpen(false);

    sendBoardAction({
      actionType: "CLEAR_CARD_ACTIONS",
      payload: {},
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

    const offRoomClosed = onRoomClosed((message) => {
      window.alert(message);

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
      offRoomClosed();
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
        } else if (payload.quickAction === "block") {
          const card =
            [
              state.players[payload.playerIndex].leader,
              ...state.players[payload.playerIndex].characters,
            ].find((item) => item?.id === cardId) ?? null;

          if (card && !card.rotated) {
            state.toggleRotate(payload.playerIndex, cardId);
          }

          if (
            state.currentAttackSource &&
            state.currentAttackTarget?.playerIndex === payload.playerIndex
          ) {
            state.setAttackTarget(pointer);
          }

          if (payload.log) {
            state.addActionLog(payload.log);
          }
        } else if (payload.quickAction === "powerPlus") {
          state.changePower(payload.playerIndex, cardId, 1000);
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

      if (action.actionType === "COUNTER_PHASE_ACTION") {
        const state = useGameStore.getState();
        const { payload } = action;

        if (payload.counterAction === "START") {
          state.startCounterPhase({
            playerIndex: payload.playerIndex,
            targetCardId: payload.targetCardId,
            targetArea: payload.targetArea,
            targetIndex: payload.targetIndex,
            power: 0,
          });
          if (payload.log) {
            state.addActionLog(payload.log);
          }
          return;
        }

        if (payload.counterAction === "ADJUST") {
          state.adjustCounterPower(payload.amount);
          return;
        }

        if (payload.counterAction === "CANCEL") {
          state.cancelCounterPhase();
          return;
        }

        state.confirmCounterPhase();
        state.clearAttackState();
        state.clearCardEffect();
        state.clearCardMarkers();
        return;
      }

      if (action.actionType === "DAMAGE_PHASE_ACTION") {
        const state = useGameStore.getState();
        const { payload } = action;

        if (payload.damageAction === "START") {
          state.startDamagePhase({
            playerIndex: payload.playerIndex,
            sourcePlayerIndex: payload.sourcePlayerIndex,
            sourceCardId: payload.sourceCardId,
            targetCardId: payload.targetCardId,
            lifeIndex: payload.lifeIndex,
          });
          if (payload.log) {
            state.addActionLog(payload.log);
          }
          return;
        }

        const phase = state.damagePhase;

        if (!phase) {
          return;
        }

        if (payload.damageAction === "TO_HAND") {
          state.moveDamageLifeToHand();
          state.clearAttackState();
          state.clearCardEffect();
          state.clearCardMarkers();
          return;
        }

        const cardId =
          state.players[phase.playerIndex].life[phase.lifeIndex]?.id;
        state.triggerDamageLife();
        state.highlightPublicArea(phase.playerIndex);
        if (cardId) {
          state.showCardEffect({
            playerIndex: phase.playerIndex,
            cardId,
            nonce: Date.now(),
            label: "トリガー",
            background: "#facc15",
            color: "#111827",
          });
        }
        state.clearAttackState();
        if (payload.log) {
          state.addActionLog(payload.log);
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
      ...player.counterCards,
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

    const activeCounterPhase =
      useGameStore.getState().counterPhase;

    if (
      activeCounterPhase &&
      activeData.playerIndex === activeCounterPhase.playerIndex &&
      (activeData.from === "hand" || activeData.from === "counter")
    ) {
      const isAllowedCounterMove =
        (activeData.from === "hand" &&
          overData.to === "counter" &&
          overData.playerIndex === activeCounterPhase.playerIndex) ||
        (activeData.from === "counter" &&
          overData.to === "hand" &&
          overData.playerIndex === activeCounterPhase.playerIndex);

      if (!isAllowedCounterMove) {
        return;
      }
    }

    if (
      activeCounterPhase &&
      overData.to === "counter" &&
      !(
        activeData.from === "hand" &&
        activeData.playerIndex === activeCounterPhase.playerIndex &&
        overData.playerIndex === activeCounterPhase.playerIndex
      )
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
      collisionDetection={boardCollisionDetection}
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
              padding: "3px 52px 3px 4px",

              fontSize: "10px",
              minHeight: "38px",
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

      {counterPhase && (
        <CounterPhasePanel phase={counterPhase} />
      )}

      {damagePhase && (
        <DamagePhasePanel phase={damagePhase} />
      )}

      {isSilentMode && <AttackArrow />}

      {isSilentMode && (currentAttackSource ||
        currentAttackTarget ||
        cardEffectSignal ||
        cardMarkers.length > 0) && (
        <button
          type="button"
          aria-label="処理終了"
          title="処理終了"
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
          処理終了
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
