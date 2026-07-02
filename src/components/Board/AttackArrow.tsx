import { useEffect, useState } from "react";

import { useGameStore } from "../../store/gameStore";
import type { EffectTargetArrow } from "../../store/gameStore";

type Point = {
  x: number;
  y: number;
};

type ArrowPoints = {
  id: string;
  source: Point;
  target: Point;
  markerType?: EffectTargetArrow["markerType"];
};

function findCardCenter(
  playerIndex: number,
  cardId: string
): Point | null {
  const cards = document.querySelectorAll<HTMLElement>(
    `[data-player-index="${playerIndex}"][data-card-id]`
  );
  const card = Array.from(cards).find(
    (element) => element.dataset.cardId === cardId
  );

  if (!card) {
    return null;
  }

  const rect = card.getBoundingClientRect();

  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

function createEffectPath(
  source: Point,
  target: Point,
  index: number
) {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const normalX = -dy / length;
  const normalY = dx / length;
  const offset = 18 + index * 9;
  const midX = (source.x + target.x) / 2 + normalX * offset;
  const midY = (source.y + target.y) / 2 + normalY * offset;

  return `M ${source.x} ${source.y} Q ${midX} ${midY} ${target.x} ${target.y}`;
}

export default function AttackArrow() {
  const source = useGameStore((state) => state.currentAttackSource);
  const target = useGameStore((state) => state.currentAttackTarget);
  const effectTargetArrows = useGameStore(
    (state) => state.effectTargetArrows
  );
  const [attackPoints, setAttackPoints] = useState<ArrowPoints | null>(null);
  const [effectPoints, setEffectPoints] = useState<ArrowPoints[]>([]);

  useEffect(() => {
    if (!source && effectTargetArrows.length === 0) {
      setAttackPoints(null);
      setEffectPoints([]);
      return;
    }

    let frame = 0;

    const update = () => {
      if (source && target) {
        const sourcePoint = findCardCenter(
          source.playerIndex,
          source.cardId
        );
        const targetPoint = findCardCenter(
          target.playerIndex,
          target.cardId
        );

        setAttackPoints((current) => {
          if (!sourcePoint || !targetPoint) {
            return current === null ? current : null;
          }

          if (
            current &&
            current.source.x === sourcePoint.x &&
            current.source.y === sourcePoint.y &&
            current.target.x === targetPoint.x &&
            current.target.y === targetPoint.y
          ) {
            return current;
          }

          return {
            id: "attack",
            source: sourcePoint,
            target: targetPoint,
          };
        });
      } else {
        setAttackPoints(null);
      }

      const nextEffectPoints: ArrowPoints[] = effectTargetArrows.flatMap(
        (arrow): ArrowPoints[] => {
          const sourcePoint = findCardCenter(
            arrow.source.playerIndex,
            arrow.source.cardId
          );
          const targetPoint = findCardCenter(
            arrow.target.playerIndex,
            arrow.target.cardId
          );

          if (!sourcePoint || !targetPoint) {
            return [];
          }

          return [
            {
              id: arrow.id,
              source: sourcePoint,
              target: targetPoint,
              markerType: arrow.markerType,
            },
          ];
        }
      );

      setEffectPoints(nextEffectPoints);
      frame = requestAnimationFrame(update);
    };

    frame = requestAnimationFrame(update);

    return () => cancelAnimationFrame(frame);
  }, [source, target, effectTargetArrows]);

  if (!attackPoints && effectPoints.length === 0) {
    return null;
  }

  return (
    <svg
      aria-hidden="true"
      width="100%"
      height="100%"
      viewBox={`0 0 ${window.innerWidth} ${window.innerHeight}`}
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 100001,
        overflow: "visible",
      }}
    >
      <defs>
        <marker
          id="attack-arrow-head"
          markerWidth="8"
          markerHeight="8"
          refX="7"
          refY="4"
          orient="auto"
        >
          <path d="M0,0 L8,4 L0,8 Z" fill="#facc15" />
        </marker>
        <marker
          id="effect-arrow-head"
          markerWidth="8"
          markerHeight="8"
          refX="7"
          refY="4"
          orient="auto"
        >
          <path d="M0,0 L8,4 L0,8 Z" fill="#7c3aed" />
        </marker>
      </defs>

      {attackPoints && (
        <>
          <line
            x1={attackPoints.source.x}
            y1={attackPoints.source.y}
            x2={attackPoints.target.x}
            y2={attackPoints.target.y}
            stroke="rgba(15, 23, 42, 0.8)"
            strokeWidth="8"
          />
          <line
            x1={attackPoints.source.x}
            y1={attackPoints.source.y}
            x2={attackPoints.target.x}
            y2={attackPoints.target.y}
            stroke="#facc15"
            strokeWidth="4"
            markerEnd="url(#attack-arrow-head)"
          />
        </>
      )}

      {effectPoints.map((points, index) => {
        const path = createEffectPath(
          points.source,
          points.target,
          index
        );

        return (
          <g key={points.id}>
            <path
              d={path}
              fill="none"
              stroke="rgba(15, 23, 42, 0.75)"
              strokeWidth="7"
              strokeLinecap="round"
            />
            <path
              d={path}
              fill="none"
              stroke="#7c3aed"
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeDasharray="8 5"
              markerEnd="url(#effect-arrow-head)"
            />
          </g>
        );
      })}
    </svg>
  );
}