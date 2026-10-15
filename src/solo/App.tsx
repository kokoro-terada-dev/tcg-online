import Board from "./components/Board/Board";

import DeckSelect from "./components/DeckSelect/DeckSelect";

import MulliganScreen from "./components/Mulligan/MulliganScreen";
import HandSelectScreen from "./components/HandSelect/HandSelectScreen";
import type { CardData } from "./types/card";

import { useGameStore } from "./store/gameStore";

import "./styles/layout.css";

type Props = {
  onBackToTop: () => void;
};

function App({
  onBackToTop,
}: Props) {
  const isStarted = useGameStore((x) => x.isStarted);
  const handSelectionPending = useGameStore((x) => x.handSelectionPending);
  const players = useGameStore((x) => x.players);
  const startGame = useGameStore((x) => x.startGame);

  const mulliganPlayerIndex =
    useGameStore((x) => x.mulliganPlayerIndex);

  const resetToDeckSelect =
    useGameStore((x) => x.resetToDeckSelect);

  if (!isStarted) {
    return <DeckSelect onBackToTop={onBackToTop} />;
  }

  if (handSelectionPending) {
    const decks = players.map((player) => [
      ...(player.leader ? [player.leader] : []),
      ...player.hand, ...player.life, ...player.deck, ...player.donDeck,
    ]) as [CardData[], CardData[]];
    return <HandSelectScreen decks={decks} onBack={resetToDeckSelect} onComplete={(hands) => startGame(decks[0], decks[1], hands)} />;
  }

  if (mulliganPlayerIndex !== null) {
    return <MulliganScreen />;
  }

  return (
    <Board
      resetToDeckSelect={resetToDeckSelect}
    />
  );
}

export default App;
