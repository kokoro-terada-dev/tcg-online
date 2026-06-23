import {
  useGameStore,
  type QuickActionType,
} from "../../store/gameStore";

export const ACTION_LABELS: Record<QuickActionType, string> = {
  attack: "アタック",
  target: "対象",
  effect: "効果",
  characterEffect: "キャラクター効果",
  leaderEffect: "リーダー効果",
  stageEffect: "ステージ効果",
  rest: "レスト",
  block: "ブロック",
  counter: "カウンター",
  event: "イベント",
  trigger: "トリガー",
  life: "ライフ",
  ok: "OK",
  wait: "待って",
  thinking: "考え中",
  takeHit: "受ける",
  endTurn: "ターン終了",
  clearTarget: "解除",
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

const VISIBLE_LOG_COUNT = 4;

export default function ActionLogBar() {
  const logs = useGameStore((state) => state.actionLogs);
  const visibleLogs = logs.slice(-VISIBLE_LOG_COUNT);

  return (
    <div
      aria-label="ターン中の行動ログ"
      style={{
        flex: 1,
        minWidth: 0,
        height: "38px",
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: "5px",
        padding: "4px 8px",
        overflow: "hidden",
        background: "rgba(2, 6, 23, 0.92)",
        border: "1px solid #475569",
        borderRadius: "6px",
      }}
    >
      {visibleLogs.map((log, index) => {
        const colors = PLAYER_COLORS[log.playerIndex];

        return (
          <div
            key={log.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "5px",
              minWidth: 0,
              flexShrink: 1,
            }}
          >
            {index > 0 && (
              <span style={{ color: "#94a3b8" }}>→</span>
            )}
            <span
              title={`プレイヤー${log.playerIndex + 1}`}
              style={{
                maxWidth: "150px",
                padding: "4px 8px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                borderRadius: "4px",
                border: `1px solid ${colors.border}`,
                background: colors.background,
                color: "white",
                fontSize: "11px",
                fontWeight: 900,
                whiteSpace: "nowrap",
              }}
            >
              {ACTION_LABELS[log.actionType]}
            </span>
          </div>
        );
      })}
    </div>
  );
}
