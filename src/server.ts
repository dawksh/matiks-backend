import { serve } from "bun";
import type { Message } from "./lib/types";
import { handleMatchmaking } from "./lib/matchmaking";
import { createRoom, joinRoom, handleGameEvent } from "./lib/rooms";
import { handleDisconnect, wsToUser } from "./lib/connections";

serve({
  port: 3000,
  fetch: () => new Response("OK"),
  websocket: {
    open: () => {},
    message(ws, msg) {
      let data: Message;
      try { data = JSON.parse(msg.toString()); } catch { return; }
      
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
        case "start-round":
        case "submit-answer":
        case "game-over":
          if (data.roomId) handleGameEvent(data.type, data.roomId, data);
          break;
      }
    },
    close: handleDisconnect
  }
});

console.log("Bun WebSocket server running on :3000");