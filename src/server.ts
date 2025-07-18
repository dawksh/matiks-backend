import { serve } from "bun";
import type { Message } from "./lib/types";
import { handleMatchmaking } from "./lib/matchmaking";
import { createRoom, joinRoom, handleGameEvent } from "./lib/rooms";
import { handleDisconnect } from "./lib/connections";
import { handleUserConnect } from "./lib/user";

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
        console.log("Received message:", data);
      } catch { 
        console.error("Invalid JSON message");
        return; 
      }
      
      switch (data.type) {
        case "join-matchmaking":
          handleMatchmaking(ws, data.userId);
          break;
        case "create-room":
          createRoom(ws, data.userId);
          break;
        case "join-room":
          if (data.roomId) joinRoom(ws, data.userId, data.roomId);
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
            handleUserConnect(data.fid!, data.displayName!, data.profilePictureUrl!);
      }
    },
    close(ws) {
      console.log("Client disconnected");
      handleDisconnect(ws);
    }
  }
});

console.log("Bun WebSocket server running on :3000");