import { useEffect, useState } from "react";

import { useGameStore } from "../../store/gameStore";

type Point = {
  x: number;
  y: number;
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

export default function AttackArrow() {
  const source = useGameStore((state) => state.currentAttackSource);
  const target = useGameStore((state) => state.currentAttackTarget);
  const [points, setPoints] = useState<{
    source: Point;
    target: Point;
  } | null>(null);

  useEffect(() => {
    if (!source || !target) {
      setPoints(null);
      return;
    }

    let frame = 0;

    const update = () => {
      const sourcePoint = findCardCenter(
        source.playerIndex,
        source.cardId
      );
      const targetPoint = findCardCenter(
        target.playerIndex,
        target.cardId
      );

      setPoints((current) => {
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
          source: sourcePoint,
          target: targetPoint,
        };
      });
      frame = requestAnimationFrame(update);
    };

    frame = requestAnimationFrame(update);

    return () => cancelAnimationFrame(frame);
  }, [source, target]);

  if (!points) {
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
        zIndex: 100002,
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
      </defs>
      <line
        x1={points.source.x}
        y1={points.source.y}
        x2={points.target.x}
        y2={points.target.y}
        stroke="rgba(15, 23, 42, 0.8)"
        strokeWidth="8"
      />
      <line
        x1={points.source.x}
        y1={points.source.y}
        x2={points.target.x}
        y2={points.target.y}
        stroke="#facc15"
        strokeWidth="4"
        markerEnd="url(#attack-arrow-head)"
      />
    </svg>
  );
}
