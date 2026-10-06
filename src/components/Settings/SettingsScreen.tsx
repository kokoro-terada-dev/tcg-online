import type { CSSProperties } from "react";

export const DEFAULT_BACKGROUND = "#0f172a";
export const BACKGROUND_STORAGE_KEY = "opcg-background-color-v1";

export function readBackgroundColor() {
  try {
    const value = localStorage.getItem(BACKGROUND_STORAGE_KEY);
    return value && /^#[0-9a-f]{6}$/i.test(value) ? value : DEFAULT_BACKGROUND;
  } catch {
    return DEFAULT_BACKGROUND;
  }
}

const colors = [
  ["標準", DEFAULT_BACKGROUND],
  ["ブラック", "#18181b"],
  ["グレー", "#374151"],
  ["グリーン", "#14532d"],
  ["ティール", "#134e4a"],
  ["ブルー", "#1e40af"],
  ["パープル", "#581c87"],
  ["ワイン", "#881337"],
  ["レッド", "#991b1b"],
  ["オレンジ", "#9a3412"],
  ["オリーブ", "#4d5b24"],
  ["ライトグレー", "#cbd5e1"],
];

const buttonStyle: CSSProperties = {
  padding: "10px 16px", borderRadius: "8px", border: "1px solid #64748b",
  background: "#1e293b", color: "white", cursor: "pointer", fontWeight: 700,
};

type Props = {
  color: string;
  onChange: (color: string) => void;
  onBack: () => void;
};

export default function SettingsScreen({ color, onChange, onBack }: Props) {
  return (
    <main style={{ height: "100dvh", overflowY: "auto", touchAction: "pan-y", background: "var(--app-background, #0f172a)", padding: "16px", paddingBottom: "max(24px, env(safe-area-inset-bottom))" }}>
      <div style={{ maxWidth: "480px", margin: "0 auto", background: "#111827", color: "white", padding: "20px", borderRadius: "8px" }}>
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginBottom: "24px" }}>
          <h1 style={{ margin: 0, fontSize: "22px" }}>設定</h1>
          <button style={buttonStyle} onClick={onBack}>戻る</button>
        </header>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontSize: "18px", fontWeight: 700, marginBottom: "16px" }}>背景色</legend>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "12px" }}>
            {colors.map(([name, value]) => (
              <label key={value} style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "12px", textAlign: "center" }}>
                <input type="radio" name="background-color" value={value} checked={color.toLowerCase() === value} onChange={() => onChange(value)} style={{ position: "absolute", top: "8px", left: "8px", margin: 0 }} />
                <span style={{ width: "100%", height: "56px", borderRadius: "6px", background: value, border: color.toLowerCase() === value ? "3px solid #38bdf8" : "1px solid #64748b" }} />
                {name}
              </label>
            ))}
          </div>
        </fieldset>
        <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "16px", marginTop: "24px" }}>
          その他の色
          <input aria-label="背景色を指定" type="color" value={color} onChange={(event) => onChange(event.target.value)} style={{ width: "64px", height: "44px", padding: "2px", border: "1px solid #64748b", background: "transparent" }} />
        </label>
        <button style={{ ...buttonStyle, marginTop: "24px" }} onClick={() => onChange(DEFAULT_BACKGROUND)}>標準に戻す</button>
      </div>
    </main>
  );
}
