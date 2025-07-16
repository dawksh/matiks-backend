import type { ServerWebSocket } from "bun";
import type { UserId } from "./types";
import { queue } from "./matchmaking";
import { rooms } from "./rooms";
import { broadcast } from "./websocket";

export const wsToUser = new Map<ServerWebSocket<unknown>, UserId>();

export const handleDisconnect = (ws: ServerWebSocket<unknown>) => {
  const userId = wsToUser.get(ws);
  if (!userId) return;

  const queueIdx = queue.findIndex(p => p.userId === userId);
  if (queueIdx !== -1) queue.splice(queueIdx, 1);
  wsToUser.delete(ws);

  for (const [roomId, players] of rooms) {
    const playerIdx = players.findIndex(p => p.userId === userId);
    if (playerIdx !== -1) {
      players.splice(playerIdx, 1);
      broadcast(players, "room-ready", { players: players.map(p => p.userId) });
      if (players.length === 0) rooms.delete(roomId);
    }
  }
}; 