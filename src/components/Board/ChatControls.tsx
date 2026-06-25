import { useEffect, useRef, useState } from "react";

import { sendBoardAction } from "../../network/roomClient";
import {
  useGameStore,
  type ActionLog,
  type QuickActionType,
} from "../../store/gameStore";
import {
  ACTION_LABELS,
  PLAYER_COLORS,
} from "./ActionLogBar";

const CHAT_ACTIONS: QuickActionType[] = [
  "counter",
  "event",
  "trigger",
  "life",
  "donPlus",
  "donMinus",
  "ok",
  "wait",
  "thinking",
  "takeHit",
  "endTurn",
  "clearTarget",
];

type Props = {
  senderPlayerIndex: 0 | 1;
  quickChatOpen: boolean;
  historyOpen: boolean;
  unreadCount: number;
  onToggleQuickChat: () => void;
  onToggleHistory: () => void;
  onCloseQuickChat: () => void;
};

export default function ChatControls({
  senderPlayerIndex,
  quickChatOpen,
  historyOpen,
  unreadCount,
  onToggleQuickChat,
  onToggleHistory,
  onCloseQuickChat,
}: Props) {
  const [customMessage, setCustomMessage] = useState("");
  const [customInputOpen, setCustomInputOpen] = useState(false);
  const logs = useGameStore((state) => state.actionLogs);
  const addActionLog = useGameStore(
    (state) => state.addActionLog
  );
  const historyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (historyOpen && historyRef.current) {
      historyRef.current.scrollTop =
        historyRef.current.scrollHeight;
    }
  }, [historyOpen, logs.length]);

  function sendChat(actionType: QuickActionType) {
    const log: ActionLog = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      playerIndex: senderPlayerIndex,
      actionType,
      createdAt: Date.now(),
    };

    addActionLog(log);
    sendBoardAction({
      actionType: "QUICK_ACTION",
      payload: { log },
    });
    onCloseQuickChat();
  }

  function sendCustomMessage() {
    const message = customMessage.trim();

    if (!message) {
      return;
    }

    const log: ActionLog = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      playerIndex: senderPlayerIndex,
      actionType: "custom",
      message: message.slice(0, 40),
      createdAt: Date.now(),
    };

    addActionLog(log);
    sendBoardAction({
      actionType: "QUICK_ACTION",
      payload: { log },
    });
    setCustomMessage("");
    setCustomInputOpen(false);
  }

  return (
    <>
      <button
        type="button"
        aria-label="チャット履歴"
        title="チャット履歴"
        onClick={onToggleHistory}
        style={{
          position: "fixed",
          right: "8px",
          top: "50%",
          transform: "translateY(-50%)",
          width: "40px",
          height: "40px",
          borderRadius: "7px",
          border: "1px solid #94a3b8",
          background: "rgba(15, 23, 42, 0.94)",
          color: "white",
          fontSize: "20px",
          zIndex: 89990,
        }}
      >
        ≡
        {unreadCount > 0 && (
          <span
            style={{
              position: "absolute",
              top: "-5px",
              right: "-5px",
              minWidth: "18px",
              height: "18px",
              padding: "0 4px",
              borderRadius: "9px",
              background: "#ef4444",
              color: "white",
              fontSize: "10px",
              fontWeight: 900,
              lineHeight: "18px",
            }}
          >
            {Math.min(unreadCount, 99)}
          </span>
        )}
      </button>

      {historyOpen && (
        <div
          style={{
            position: "fixed",
            right: "54px",
            top: "50%",
            transform: "translateY(-50%)",
            width: "min(340px, calc(100vw - 70px))",
            maxHeight: "46dvh",
            padding: "8px",
            border: "1px solid #64748b",
            borderRadius: "7px",
            background: "rgba(15, 23, 42, 0.97)",
            color: "white",
            zIndex: 89991,
            boxShadow: "0 10px 28px rgba(0,0,0,0.45)",
          }}
        >
          <button
            type="button"
            aria-label="履歴を閉じる"
            onClick={onToggleHistory}
            style={{
              display: "block",
              marginLeft: "auto",
              width: "30px",
              height: "30px",
              border: "1px solid #64748b",
              borderRadius: "5px",
              background: "#334155",
              color: "white",
              fontSize: "18px",
            }}
          >
            ×
          </button>
          <button
            type="button"
            onClick={() => setCustomInputOpen(true)}
            style={{
              width: "100%",
              height: "34px",
              marginTop: "7px",
              border: "1px solid #38bdf8",
              borderRadius: "5px",
              background: "#0369a1",
              color: "white",
              fontSize: "12px",
              fontWeight: 900,
            }}
          >
            メッセージ入力
          </button>
          <div
            ref={historyRef}
            style={{
              maxHeight: "calc(46dvh - 78px)",
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: "5px",
              paddingTop: "6px",
            }}
          >
            {logs.map((log) => {
              const colors = PLAYER_COLORS[log.playerIndex];
              const isOwn =
                log.playerIndex === senderPlayerIndex;

              return (
                <div
                  key={log.id}
                  style={{
                    maxWidth: "82%",
                    alignSelf: isOwn ? "flex-end" : "flex-start",
                    padding: "6px 8px",
                    border: `1px solid ${colors.border}`,
                    background: colors.background,
                    borderRadius: isOwn
                      ? "10px 10px 2px 10px"
                      : "10px 10px 10px 2px",
                    fontSize: "10px",
                    fontWeight: 800,
                    lineHeight: 1.35,
                    overflowWrap: "anywhere",
                  }}
                >
                  {log.message ?? ACTION_LABELS[log.actionType]}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <button
        type="button"
        aria-label="クイックチャット"
        title="クイックチャット"
        onClick={onToggleQuickChat}
        style={{
          position: "fixed",
          right: "8px",
          bottom: "max(8px, env(safe-area-inset-bottom))",
          width: "42px",
          height: "42px",
          borderRadius: "7px",
          border: "1px solid #94a3b8",
          background: "#0369a1",
          color: "white",
          fontSize: "20px",
          zIndex: 89990,
        }}
      >
        …
      </button>

      {quickChatOpen && (
        <div
          style={{
            position: "fixed",
            right: "8px",
            bottom: "max(56px, calc(env(safe-area-inset-bottom) + 56px))",
            width: "min(180px, calc(100vw - 16px))",
            maxHeight: "55dvh",
            overflowY: "auto",
            padding: "7px",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "5px",
            border: "1px solid #64748b",
            borderRadius: "7px",
            background: "rgba(15, 23, 42, 0.97)",
            zIndex: 89991,
            boxShadow: "0 10px 28px rgba(0,0,0,0.45)",
          }}
        >
          {CHAT_ACTIONS.map((actionType) => (
            <button
              key={actionType}
              type="button"
              onClick={() => sendChat(actionType)}
              style={{
                minHeight: "34px",
                padding: "5px",
                border: "1px solid #64748b",
                borderRadius: "4px",
                background: "#1e293b",
                color: "white",
                fontSize: "11px",
                fontWeight: 900,
              }}
            >
              {ACTION_LABELS[actionType]}
            </button>
          ))}
        </div>
      )}

      {customInputOpen && (
        <>
          <button
            type="button"
            aria-label="メッセージ入力を閉じる"
            onClick={() => setCustomInputOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              padding: 0,
              border: 0,
              background: "rgba(0, 0, 0, 0.18)",
              zIndex: 100000,
            }}
          />
          <div
            style={{
              position: "fixed",
              left: "8px",
              right: "8px",
              bottom:
                "max(8px, calc(env(safe-area-inset-bottom) + 8px))",
              display: "grid",
              gridTemplateColumns: "1fr 58px 58px",
              gap: "7px",
              padding: "8px",
              border: "1px solid #38bdf8",
              borderRadius: "8px",
              background: "rgba(15, 23, 42, 0.98)",
              boxShadow: "0 10px 28px rgba(0,0,0,0.55)",
              zIndex: 100001,
            }}
          >
            <input
              value={customMessage}
              maxLength={40}
              autoFocus
              placeholder="メッセージ"
              onChange={(e) => setCustomMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  sendCustomMessage();
                }
              }}
              style={{
                minWidth: 0,
                height: "44px",
                border: "1px solid #64748b",
                borderRadius: "6px",
                background: "#020617",
                color: "white",
                padding: "0 10px",
                fontSize: "16px",
                fontWeight: 800,
                WebkitTextSizeAdjust: "100%",
              }}
            />
            <button
              type="button"
              onClick={sendCustomMessage}
              style={{
                height: "44px",
                border: "1px solid #38bdf8",
                borderRadius: "6px",
                background: "#0369a1",
                color: "white",
                fontSize: "13px",
                fontWeight: 900,
              }}
            >
              送信
            </button>
            <button
              type="button"
              onClick={() => setCustomInputOpen(false)}
              style={{
                height: "44px",
                border: "1px solid #64748b",
                borderRadius: "6px",
                background: "#334155",
                color: "white",
                fontSize: "13px",
                fontWeight: 900,
              }}
            >
              閉じる
            </button>
          </div>
        </>
      )}
    </>
  );
}
