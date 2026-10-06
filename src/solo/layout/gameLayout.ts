export const GAME_LAYOUT = {
  baseBoardWidth: 1600,
  baseBoardHeight: 950,

  css: {
    boardWidth: "var(--op-board-width)",
    boardPadding: "var(--op-board-padding)",
    boardGap: "var(--op-board-gap)",
    boardInnerGap: "var(--op-board-inner-gap)",

    cardWidth: "var(--op-card-width)",
    cardHeight: "var(--op-card-height)",
    leaderWidth: "var(--op-leader-width)",
    leaderHeight: "var(--op-leader-height)",
    deckWidth: "var(--op-deck-width)",
    deckHeight: "var(--op-deck-height)",
    lifeWidth: "var(--op-life-width)",
    lifeHeight: "var(--op-life-height)",
    trashWidth: "var(--op-trash-width)",
    trashHeight: "var(--op-trash-height)",

    donWidth: "var(--op-don-width)",
    donHeight: "var(--op-don-height)",
    donRotatedWidth: "var(--op-don-rotated-width)",
    donRotatedHeight: "var(--op-don-rotated-height)",

    cardRadius: "var(--op-card-radius)",
    areaRadius: "var(--op-area-radius)",
    areaBorder: "var(--op-area-border)",
    areaBorderActive: "var(--op-area-border-active)",

    characterGap: "var(--op-character-gap)",
    mainAreaGap: "var(--op-main-area-gap)",
    donAreaGap: "var(--op-don-area-gap)",
    handMinHeight: "var(--op-hand-min-height)",
    handPadding: "var(--op-hand-padding)",

    counterFontSize: "var(--op-counter-font-size)",
  },
} as const;

export type GameLayoutCss = typeof GAME_LAYOUT.css;
