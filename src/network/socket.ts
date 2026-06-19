import { io } from "socket.io-client";

export const socket = io(
  "https://tcg-server-u085.onrender.com"
);