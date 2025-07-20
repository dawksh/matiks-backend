import { serve } from "bun";
import type { Message } from "./lib/types";
import { handleMatchmaking, startPeriodicCleanup } from "./lib/matchmaking";
import { createRoom, joinRoom, handleGameEvent } from "./lib/rooms";
import { handleDisconnect, trackConnection, updateHeartbeat, isConnectionStale } from "./lib/connections";
import { handleUserConnect } from "./lib/user";
import { sendHeartbeat } from "./lib/websocket";
import { startConnectionMonitoring } from "./lib/connection-stability";
import Elysia, { t } from "elysia";
import { prisma } from "./lib/prisma";

const app = new Elysia();
app.get("/leaderboard", async ({query}: {query: {limit: number, page: number}}) => {
    const users = await prisma.user.findMany({
        orderBy: {
            points: "desc",
        },
        take: query.limit,
        skip: (query.page -1 ) * query.limit,
    });
    return {
        users,
        total: users.length,
        page: query.page,
    };
}, {
    query: t.Object({
        limit: t.Number({default: 10}),
        page: t.Number({default: 1}),
    }),
});
app.listen(8080, () => {
    console.log("App Working on port 8080")
});

startPeriodicCleanup();
startConnectionMonitoring();

serve({
  port: 3000,
  fetch(req, server) {
    if (server.upgrade(req)) {
      return;
    }
    return new Response("Expected WebSocket connection", { status: 426 });
  },
  websocket: {
    open: () => {
      console.log("Client connected");
    },
    message(ws, msg) {
      let data: Message;
      try { 
        data = JSON.parse(msg.toString()); 
      } catch { 
        console.error("Invalid JSON message");
        return; 
      }
      
      // Handle heartbeat responses
      if (data.type === "pong") {
        updateHeartbeat(ws);
        return;
      }
      
      // Track connection for user-related messages
      if (data.userId && data.type !== "ping" && data.type !== "pong") {
        trackConnection(ws, data.userId);
      }
      
      switch (data.type) {
        case "join-matchmaking":
          if (data.userId) handleMatchmaking(ws, data.userId);
          break;
        case "create-room":
          if (data.userId) createRoom(ws, data.userId);
          break;
        case "join-room":
          if (data.roomId && data.userId) joinRoom(ws, data.userId, data.roomId);
          break;
        case "submit-answer":
          if (data.roomId && data.questionId !== undefined && data.answer !== undefined) {
            handleGameEvent(data.type, data.roomId, data);
          }
          break;
        case "game-over":
          if (data.roomId) handleGameEvent(data.type, data.roomId, data);
          break;
        case "register-user":
            handleUserConnect(data.fid!, data.displayName!, data.profilePictureUrl!, data.username!);
          break;
        case "ping":
          // Respond to client pings
          ws.send(JSON.stringify({ type: "pong", timestamp: data.timestamp }));
          break;
      }
    },
    close(ws) {
      console.log("Client disconnected");
      handleDisconnect(ws);
    }
  }
});

console.log("Bun WebSocket server running on :3000");