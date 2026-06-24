import express = require("express");
import type { Request, Response } from "express";
import { createServer } from "http";
import { Server } from "socket.io";

import {
    canStartGame,
    createRoom,
    findRoomBySocketId,
    joinRoom,
    leaveRoom,
    removeRoom,
    resetRoomAfterMatch,
    markMulliganComplete,
    setCommunicationMode,
    setDeckRecipe,
    setReady,
} from "./roomManager";

import type {
    DeckRecipeForRoom,
    GameSetupPayload,
    MulliganResultPayload,
    BoardActionPayload,
} from "./types";

const app = express();

app.get("/", (_: Request, res: Response) => {
    res.send("Server Running");
});

const httpServer = createServer(app);

const allowedOrigins = [
    "https://tcg-online-theta.vercel.app",
    "http://localhost:5173",
];

const io = new Server(httpServer, {
    cors: {
        origin: allowedOrigins,
    },
});

io.on("connection", (socket) => {

    socket.emit("welcome", {
        socketId: socket.id,
    });

    socket.on("disconnect", () => {

        const room = findRoomBySocketId(socket.id);

        if (!room) {
            return;
        }

        if (room.hostSocketId === socket.id) {
            io.to(room.roomId).emit(
                "room-closed",
                {
                    message: "ホストがルームを解散しました",
                }
            );

            io.in(room.roomId).socketsLeave(room.roomId);

            removeRoom(room.roomId);
            return;
        }

        const result = leaveRoom(
            room.roomId,
            socket.id
        );

        if (!result || result.roomRemoved) {
            return;
        }

        io.to(room.roomId).emit(
            "room-state",
            result.room
        );

        io.to(room.roomId).emit(
            "guest-left",
            {
                message: "ゲストが退出しました",
            }
        );
    });

    socket.on("create-room", () => {
        const room = createRoom(socket.id);

        socket.join(room.roomId);

        socket.emit("room-created", room);
        io.to(room.roomId).emit("room-state", room);
    });

    socket.on(
        "leave-room",
        (payload: { roomId: string }) => {
            const result = leaveRoom(
                payload.roomId,
                socket.id
            );

            if (!result) {
                socket.leave(payload.roomId);
                return;
            }

            socket.leave(payload.roomId);

            if (result.roomRemoved) {
                io.to(payload.roomId).emit(
                    "room-closed",
                    {
                        message: "ホストがルームを解散しました",
                    }
                );
                io.in(payload.roomId).socketsLeave(payload.roomId);
                return;
            }

            io.to(payload.roomId).emit(
                "room-state",
                result.room
            );

            io.to(payload.roomId).emit(
                "guest-left",
                {
                    message: "ゲストが退出しました",
                }
            );
        }
    );

    socket.on(
        "join-room",
        (roomId: string) => {
            const room = joinRoom(
                roomId,
                socket.id
            );

            if (!room) {
                socket.emit("join-failed");
                return;
            }

            socket.join(roomId);

            socket.emit("room-joined", room);
            io.to(roomId).emit("room-state", room);
        }
    );

    socket.on(
        "deck-selected",
        (payload: {
            roomId: string;
            deckRecipe: DeckRecipeForRoom;
        }) => {
            const room = setDeckRecipe(
                payload.roomId,
                socket.id,
                payload.deckRecipe
            );

            if (!room) {
                return;
            }

            io.to(payload.roomId).emit(
                "room-state",
                room
            );
        }
    );

    socket.on(
        "ready",
        (roomId: string) => {
            const room = setReady(
                roomId,
                socket.id
            );

            if (!room) {
                return;
            }

            io.to(roomId).emit(
                "room-state",
                room
            );

            if (canStartGame(room)) {
                io.to(roomId).emit(
                    "both-ready"
                );
            }
        }
    );

    socket.on(
        "game-setup",
        (payload: GameSetupPayload) => {

            socket.to(payload.roomId).emit(
                "game-setup",
                payload.deckOrder
            );
        }
    );

    socket.on(
        "set-communication-mode",
        (payload: {
            roomId: string;
            communicationMode: "voice" | "silent";
        }) => {
            const room = setCommunicationMode(
                payload.roomId,
                socket.id,
                payload.communicationMode
            );

            if (room) {
                io.to(payload.roomId).emit("room-state", room);
            }
        }
    );

    socket.on(
        "mulligan-result",
        (payload: MulliganResultPayload) => {
            socket.to(payload.roomId).emit(
                "mulligan-result",
                payload
            );

            const room = markMulliganComplete(
                payload.roomId,
                socket.id
            );

            if (
                room?.hostMulliganComplete &&
                room.guestMulliganComplete
            ) {
                io.to(payload.roomId).emit("mulligan-complete");
            }
        }
    );

    socket.on(
        "board-action",
        (payload: BoardActionPayload) => {

            socket.to(payload.roomId).emit(
                "board-action",
                payload
            );
        }
    );

    socket.on(
        "match-exit-request",
        (payload: { roomId: string }) => {
            socket.to(payload.roomId).emit(
                "match-exit-request"
            );
        }
    );

    socket.on(
        "match-exit-accepted",
        (payload: { roomId: string }) => {
            const room = resetRoomAfterMatch(
                payload.roomId
            );

            if (room) {
                io.to(payload.roomId).emit(
                    "room-state",
                    room
                );
            }

            io.to(payload.roomId).emit(
                "match-exit-accepted"
            );
        }
    );

    socket.on(
        "match-exit-rejected",
        (payload: { roomId: string }) => {
            socket.to(payload.roomId).emit(
                "match-exit-rejected"
            );
        }
    );
});

const PORT = process.env.PORT || 3000;

httpServer.listen(PORT, () => {
    console.log(`server start ${PORT}`);
});
