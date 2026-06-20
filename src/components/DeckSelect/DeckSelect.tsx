import {
  useState
} from "react";

import type { CSSProperties } from "react";

import DeckBuilder from "../DeckBuilder/DeckBuilder";

import {
  hasLocalCardImages,
  loadCardImagesFromZip,
} from "../../utils/localCardImages";

type ScreenMode = "select" | "builder";

type DeckSelectProps = {
  onOpenOnlineMenu: () => void;
};

export default function DeckSelect({
  onOpenOnlineMenu,
}: DeckSelectProps) {
  const [mode, setMode] = useState<ScreenMode>("select");

  const [editingDeckId, setEditingDeckId] =
    useState<string | null>(null);

  const [isZipLoaded, setIsZipLoaded] =
    useState(hasLocalCardImages());

  const [message, setMessage] = useState("");

  const [error, setError] = useState("");

  async function handleLoadZip(file: File | null) {
    if (!file) {
      return;
    }

    setMessage("画像ZIPを読み込み中...");
    setError("");

    try {
      const loaded = await loadCardImagesFromZip(file);

      setIsZipLoaded(hasLocalCardImages());

      setMessage(
        loaded.length > 0
          ? `${loaded.length}枚の画像を読み込みました。`
          : "画像が0枚です。ZIP内が cards/OP01/OP01-001.png のような構成か確認してください。"
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "画像ZIPの読み込みに失敗しました。"
      );
    }
  }

  function openNewDeck() {
    setEditingDeckId(null);
    setMode("builder");
  }

  if (mode === "builder") {
    return (
      <DeckBuilder
        initialDeckId={editingDeckId}
        onBack={() => {
          setIsZipLoaded(hasLocalCardImages());
          setMode("select");
        }}
      />
    );
  }

  return (
    <div style={pageStyle}>
      <div style={bgGlowStyle} />

      <div style={containerStyle}>
        <div style={titleBlockStyle}>
          <div style={smallTitleStyle}>
            ONLINE CARD BATTLE
          </div>

          <h1 style={titleStyle}>
            TCG ONLINE
          </h1>

          <div style={subTitleStyle}>
            Local Images / Deck Edit / Online Match
          </div>
        </div>

        <div style={panelStyle}>
          <label style={menuButtonStyle}>
            <span style={buttonMainTextStyle}>
              画像ZIP読込
            </span>
            <span style={buttonSubTextStyle}>
              カード画像を読み込む
            </span>

            <input
              type="file"
              accept=".zip"
              onChange={(e) => {
                handleLoadZip(e.target.files?.[0] ?? null);
                e.currentTarget.value = "";
              }}
              style={{ display: "none" }}
            />
          </label>

          <button
            style={menuButtonStyle}
            onClick={openNewDeck}
          >
            <span style={buttonMainTextStyle}>
              デッキ編集
            </span>
            <span style={buttonSubTextStyle}>
              デッキを作成・編集する
            </span>
          </button>

          <button
            style={{
              ...battleButtonStyle,
              opacity: isZipLoaded ? 1 : 0.45,
            }}
            disabled={!isZipLoaded}
            onClick={onOpenOnlineMenu}
          >
            <span style={buttonMainTextStyle}>
              対戦
            </span>
            <span style={buttonSubTextStyle}>
              オンラインルームへ
            </span>
          </button>
        </div>

        {!isZipLoaded && (
          <div style={warningStyle}>
            画像ZIPを読み込むと対戦に進めます。
          </div>
        )}

        {message && (
          <div style={messageStyle}>
            {message}
          </div>
        )}

        {error && (
          <div style={errorStyle}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

const pageStyle: CSSProperties = {
  minHeight: "100dvh",
  background:
    "radial-gradient(circle at top, #1e3a8a 0%, #0f172a 38%, #020617 100%)",
  color: "white",
  padding: "18px",
  boxSizing: "border-box",
  overflow: "hidden",
  position: "relative",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const bgGlowStyle: CSSProperties = {
  position: "absolute",
  width: "280px",
  height: "280px",
  borderRadius: "999px",
  background: "rgba(59,130,246,0.22)",
  filter: "blur(48px)",
  top: "-60px",
  right: "-80px",
};

const containerStyle: CSSProperties = {
  width: "100%",
  maxWidth: "420px",
  position: "relative",
  zIndex: 1,
  display: "flex",
  flexDirection: "column",
  gap: "18px",
};

const titleBlockStyle: CSSProperties = {
  textAlign: "center",
  marginBottom: "10px",
};

const smallTitleStyle: CSSProperties = {
  fontSize: "12px",
  fontWeight: 900,
  color: "#93c5fd",
  letterSpacing: "2px",
};

const titleStyle: CSSProperties = {
  margin: "6px 0 4px",
  fontSize: "38px",
  fontWeight: 1000,
  letterSpacing: "1px",
  textShadow:
    "0 0 12px rgba(96,165,250,0.8), 0 4px 0 rgba(0,0,0,0.45)",
};

const subTitleStyle: CSSProperties = {
  fontSize: "12px",
  color: "#cbd5e1",
  fontWeight: 700,
};

const panelStyle: CSSProperties = {
  background: "rgba(15,23,42,0.86)",
  border: "1px solid rgba(148,163,184,0.45)",
  borderRadius: "22px",
  padding: "16px",
  display: "flex",
  flexDirection: "column",
  gap: "12px",
  boxShadow:
    "0 18px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)",
};

const menuButtonStyle: CSSProperties = {
  width: "100%",
  minHeight: "76px",
  borderRadius: "18px",
  border: "1px solid #475569",
  background:
    "linear-gradient(180deg, #334155 0%, #1e293b 100%)",
  color: "white",
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
  alignItems: "flex-start",
  gap: "4px",
  padding: "0 18px",
  boxSizing: "border-box",
  cursor: "pointer",
  boxShadow:
    "0 8px 0 #0f172a, 0 12px 20px rgba(0,0,0,0.35)",
};

const battleButtonStyle: CSSProperties = {
  ...menuButtonStyle,
  border: "1px solid #facc15",
  background:
    "linear-gradient(180deg, #f59e0b 0%, #b45309 100%)",
  boxShadow:
    "0 8px 0 #78350f, 0 12px 24px rgba(245,158,11,0.28)",
};

const buttonMainTextStyle: CSSProperties = {
  fontSize: "22px",
  fontWeight: 1000,
  lineHeight: 1,
};

const buttonSubTextStyle: CSSProperties = {
  fontSize: "12px",
  fontWeight: 800,
  color: "#e2e8f0",
};

const warningStyle: CSSProperties = {
  background: "rgba(127,29,29,0.9)",
  border: "1px solid #fca5a5",
  borderRadius: "14px",
  padding: "10px 12px",
  fontSize: "13px",
  fontWeight: 900,
  textAlign: "center",
};

const messageStyle: CSSProperties = {
  background: "rgba(22,78,99,0.9)",
  border: "1px solid #67e8f9",
  borderRadius: "14px",
  padding: "10px 12px",
  fontSize: "13px",
  fontWeight: 800,
};

const errorStyle: CSSProperties = {
  background: "rgba(127,29,29,0.9)",
  border: "1px solid #fca5a5",
  borderRadius: "14px",
  padding: "10px 12px",
  fontSize: "13px",
  fontWeight: 800,
};