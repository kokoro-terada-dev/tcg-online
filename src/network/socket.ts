import { io } from "socket.io-client";

const SERVER_URL =
  import.meta.env.DEV
    ? "http://localhost:3000"
    : "https://tcg-server-u085.onrender.com";

export const socket = io(
  SERVER_URL,
  {
    transports: ["polling", "websocket"],
    reconnection: true,
  }
);

socket.on("connect", () => {
  console.log("SOCKET CONNECTED", socket.id);
});

socket.on("connect_error", (error) => {
  console.error("SOCKET CONNECT ERROR", error);
});

export let isHost = false;

export function setHost(
  value: boolean
) {
  isHost = value;
}