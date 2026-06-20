import Board from "./components/Board/Board";
import DeckSelect from "./components/DeckSelect/DeckSelect";
import MulliganScreen from "./components/Mulligan/MulliganScreen";
import { useGameStore } from "./store/gameStore";

import { useEffect } from "react";
import { socket } from "./network/socket";
import {
  createRoom,
  joinRoom,
  ready,
  setClientRoomId
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

    socket.on("welcome", (data) => {
      console.log("welcome", data);
    });

    socket.on("room-created", (roomId) => {
      setClientRoomId(roomId);
      console.log("created", roomId);
    });

    socket.on("room-joined", (roomId) => {
      setClientRoomId(roomId);
      console.log("joined", roomId);
    });

    socket.on(
      "ready-state",
      (state) => {
        console.log(
          "ready-state",
          state
        );
      }
    );

    socket.on(
      "game-start",
      () => {
        console.log(
          "GAME START"
        );
      }
    );

    return () => {
      socket.off("connect");
      socket.off("welcome");
      socket.off("room-created");
      socket.off("room-joined");
    };
  }, []);

  if (!isStarted) {
    return (
      <>
        <button
          style={{
            position: "fixed",
            top: "10px",
            right: "10px",
            zIndex: 999999,
            padding: "10px",
            backgroundColor: "red",
            color: "white",
            fontSize: "20px"
          }}
          onClick={() => createRoom()}
        >
          Create Room
        </button>
        <button
          style={{
            position: "fixed",
            top: "60px",
            right: "10px",
            zIndex: 999999
          }}
          onClick={() => {
            const roomId =
              prompt("Room ID");

            if (roomId) {
              joinRoom(roomId);
            }
          }}
        >
          Join Room
        </button>
        <button
          style={{
            position: "fixed",
            top: "110px",
            right: "10px",
            zIndex: 999999
          }}
          onClick={() => {
            ready();
          }}
        >
          Ready
        </button>

        <DeckSelect />
      </>
    );
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