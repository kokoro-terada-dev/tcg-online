import type { CSSProperties } from "react";

export function createAreaTheme(value: string): CSSProperties {
  const hex = /^#[0-9a-f]{6}$/i.test(value) ? value : "#0f172a";
  const rgb = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
  const luminance = (channels: number[]) => channels.reduce((sum, channel, index) => {
    const v = channel / 255;
    return sum + (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][index];
  }, 0);
  const light = luminance(rgb) > 0.35;
  const mix = (target: number, amount: number) => rgb.map((channel) => Math.round(channel * (1 - amount) + target * amount));
  const surface = mix(light ? 0 : 255, light ? 0.08 : 0.12);
  const raised = mix(light ? 0 : 255, light ? 0.16 : 0.20);
  const cssColor = (channels: number[]) => `rgb(${channels.join(", ")})`;
  const text = (channels: number[]) => luminance(channels) > 0.179 ? "#000000" : "#ffffff";
  return {
    "--solo-area-background": cssColor(surface),
    "--solo-area-raised": cssColor(raised),
    "--solo-area-text": text(surface),
    "--solo-area-raised-text": text(raised),
    "--op-area-border": `2px solid ${cssColor(mix(light ? 0 : 255, 0.48))}`,
  } as CSSProperties;
}
