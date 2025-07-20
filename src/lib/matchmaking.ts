import type { ServerWebSocket } from "bun";
import type { Player, UserId, RoomId } from "./types";
import { send, broadcast } from "./websocket";
import { READY_TIME, ROUND_TIME_LIMIT, createRoomWithPlayers } from "./rooms";
import { wsToUser } from "./connections";
import { setRoomData, getRoomData, delRoomData } from "./redis";

export const queue: Player[] = [];

export const handleMatchmaking = (
  ws: ServerWebSocket<unknown>,
  userId: UserId
) => {
  if (queue.some((p) => p.userId === userId)) {
    send(ws, "error", { message: "Already in queue" });
    return;
  }
  
  if (ws.readyState !== 1) {
    send(ws, "error", { message: "WebSocket not ready" });
    return;
  }
  
  const player: Player = { userId, ws, score: 0 };
  queue.push(player);
  wsToUser.set(ws, userId);
  send(ws, "queue-joined", { position: queue.length });
  
  if (queue.length >= 2) {
    createMatch();
  }
};

export const removeFromQueue = (userId: UserId) => {
  const index = queue.findIndex((p) => p.userId === userId);
  if (index !== -1) {
    queue.splice(index, 1);
  }
};

export const cleanupQueue = () => {
  const validPlayers = queue.filter((p) => p.ws.readyState === 1);
  const removedCount = queue.length - validPlayers.length;
  if (removedCount > 0) {
    console.log(`Cleaned up ${removedCount} stale connections from queue`);
  }
  queue.length = 0;
  queue.push(...validPlayers);
};

export const startPeriodicCleanup = () => {
  setInterval(() => {
    cleanupQueue();
  }, 15000);
};

const createMatch = async () => {
  cleanupQueue();
  
  if (queue.length < 2) return;
  
  const [p1, p2] = [queue.shift(), queue.shift()];
  if (!p1 || !p2) return;
  
  if (p1.ws.readyState !== 1 || p2.ws.readyState !== 1) {
    if (p1.ws.readyState === 1) queue.unshift(p1);
    if (p2.ws.readyState === 1) queue.unshift(p2);
    return;
  }
  
  try {
    await createRoomWithPlayers([
      { userId: p1.userId, ws: p1.ws },
      { userId: p2.userId, ws: p2.ws },
    ]);
  } catch (error) {
    console.error("Failed to create match:", error);
    if (p1.ws.readyState === 1) {
      queue.unshift(p1);
      send(p1.ws, "error", { message: "Failed to create match" });
    }
    if (p2.ws.readyState === 1) {
      queue.unshift(p2);
      send(p2.ws, "error", { message: "Failed to create match" });
    }
  }
};
