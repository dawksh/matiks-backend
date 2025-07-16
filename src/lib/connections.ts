import type { ServerWebSocket } from "bun";
import type { UserId } from "./types";
import { queue } from "./matchmaking";
import { rooms, handleUserLeave } from "./rooms";

export const wsToUser = new Map<ServerWebSocket<unknown>, UserId>();

export const handleDisconnect = (ws: ServerWebSocket<unknown>) => {
  const userId = wsToUser.get(ws);
  if (!userId) return;

  const queueIdx = queue.findIndex(p => p.userId === userId);
  if (queueIdx !== -1) queue.splice(queueIdx, 1);
  
  handleUserLeave(ws);
}; 