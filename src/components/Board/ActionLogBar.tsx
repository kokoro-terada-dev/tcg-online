import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  useGameStore,
  type QuickActionType,
} from "../../store/gameStore";

export const ACTION_LABELS: Record<QuickActionType, string> = {
  attack: "アタック",
  target: "対象",
  target1: "対象①",
  target2: "対象②",
  target3: "対象③",
  effect: "効果",
  characterEffect: "キャラクター効果",
  leaderEffect: "リーダー効果",
  stageEffect: "ステージ効果",
  processing: "処理中",
  confirmRequest: "確認して",
  confirmed: "確認OK",
  note: "付箋",
  rest: "レスト",
  active: "アクティブ",
  block: "ブロック",
  counter: "カウンター",
  event: "イベント",
  trigger: "トリガー発動",
  life: "ライフ追加",
  donPlus: "ドン追加",
  donMinus: "ドンマイナス",
  ok: "OK",
  wait: "待って",
  thinking: "考え中",
  takeHit: "ダメージ",
  endTurn: "ターン終了",
  clearTarget: "解除",
  cancel: "キャンセル",
  custom: "メッセージ",
};

export const PLAYER_COLORS = {
  0: {
    background: "#075985",
    border: "#38bdf8",
  },
  1: {
    background: "#9f1239",
    border: "#fb7185",
  },
} as const;

function getLogText(
  log: ReturnType<typeof useGameStore.getState>["actionLogs"][number]
) {
  return log.message ?? ACTION_LABELS[log.actionType];
}

function takeChars(
  text: string,
  count: number
) {
  return Array.from(text).slice(0, count).join("");
}

function formatLogText(
  text: string,
  distanceFromLatest: number
) {
  const chars = Array.from(text);

  if (distanceFromLatest === 0) {
    return chars.length > 10 ? takeChars(text, 10) : text;
  }

  if (distanceFromLatest === 1) {
    return chars.length > 5 ? takeChars(text, 5) : text;
  }

  return chars.length > 4
    ? `${takeChars(text, 4)}...`
    : text;
}

function estimateLogWidth(
  text: string
) {
  return Array.from(text).length * 11 + 18;
}

export default function ActionLogBar() {
  const logs = useGameStore((state) => state.actionLogs);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] =
    useState(0);

  useEffect(() => {
    const element = containerRef.current;

    if (!element) {
      return;
    }

    const observedElement = element;

    function updateWidth() {
      setContainerWidth(observedElement.clientWidth);
    }

    updateWidth();

    const resizeObserver = new ResizeObserver(updateWidth);
    resizeObserver.observe(observedElement);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  const visibleItems = useMemo(() => {
    const items = logs.map((log, index) => {
      const distanceFromLatest =
        logs.length - 1 - index;
      const text = formatLogText(
        getLogText(log),
        distanceFromLatest
      );

      return {
        log,
        text,
        width: estimateLogWidth(text),
      };
    });

    const availableWidth =
      containerWidth > 0 ? containerWidth - 12 : 280;
    const separatorWidth = 18;
    const gapWidth = 5;
    const selected: typeof items = [];
    let usedWidth = 0;

    for (let i = items.length - 1; i >= 0; i--) {
      const nextWidth =
        items[i].width +
        (selected.length > 0
          ? separatorWidth + gapWidth
          : 0);

      if (
        selected.length > 0 &&
        usedWidth + nextWidth > availableWidth
      ) {
        break;
      }

      selected.unshift(items[i]);
      usedWidth += nextWidth;
    }

    return selected;
  }, [containerWidth, logs]);

  return (
    <div
      ref={containerRef}
      aria-label="ターン中の行動ログ"
      style={{
        flex: 1,
        minWidth: 0,
        height: "34px",
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: "5px",
        padding: "4px 6px",
        overflow: "hidden",
        background: "rgba(2, 6, 23, 0.92)",
        border: "1px solid #475569",
        borderRadius: "6px",
      }}
    >
      {visibleItems.map((item, index) => {
        const { log } = item;
        const colors = PLAYER_COLORS[log.playerIndex];
        const isLatest =
          index === visibleItems.length - 1;

        return (
          <div
            key={log.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "5px",
              flexShrink: 0,
            }}
          >
            {index > 0 && (
              <span style={{ color: "#94a3b8" }}>→</span>
            )}
            <span
              title={`プレイヤー${log.playerIndex + 1}`}
              style={{
                maxWidth: isLatest ? "128px" : "74px",
                padding: "4px 7px",
                overflow: "hidden",
                textOverflow: "clip",
                borderRadius: "4px",
                border: `1px solid ${colors.border}`,
                background: colors.background,
                color: "white",
                fontSize: "10px",
                fontWeight: 900,
                whiteSpace: "nowrap",
              }}
            >
              {item.text}
            </span>
          </div>
        );
      })}
    </div>
  );
}
