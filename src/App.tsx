import Board from "./components/Board/Board";
import DeckSelect from "./components/DeckSelect/DeckSelect";
import MulliganScreen from "./components/Mulligan/MulliganScreen";
import { useGameStore } from "./store/gameStore";

import { useEffect } from "react";
import { socket } from "./network/socket";
import {
  createRoom
} from "./network/roomClient";

function App() {
  const isStarted = useGameStore((x) => x.isStarted);

  const mulliganPlayerIndex =
    useGameStore((x) => x.mulliganPlayerIndex);

  const resetToDeckSelect =
    useGameStore((x) => x.resetToDeckSelect);

  useEffect(() => {
    socket.on("connect", () => {
      console.log("socket connected");
    });

    socket.on(
      "room-created",
      (roomId) => {
        console.log(
          "created",
          roomId
        );
      }
    );

    useEffect(() => {
      socket.on("room-created", (roomId) => {
        console.log("created", roomId);
      });

      return () => {
        socket.off("room-created");
      };
    }, []);

    socket.on(
      "room-joined",
      (roomId) => {
        console.log(
          "joined",
          roomId
        );
      }
    );

    socket.on("welcome", (data) => {
      console.log("welcome", data);
    });

    return () => {
      socket.off("connect");
      socket.off("welcome");
    };
  }, []);

  <button
    onClick={() => createRoom()}
  >
    Create Room
  </button>

  if (!isStarted) {
    return <DeckSelect />;
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