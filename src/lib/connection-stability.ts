import type { ServerWebSocket } from "bun";
import { userToWs, isConnectionStale, untrackConnection } from "./connections";
import { send } from "./websocket";

export const HEARTBEAT_INTERVAL = 30000; // 30 seconds
export const CONNECTION_TIMEOUT = 60000; // 60 seconds

export const startConnectionMonitoring = () => {
  setInterval(() => {
    const staleConnections: ServerWebSocket<unknown>[] = [];
    
    for (const [userId, ws] of userToWs.entries()) {
      if(userId == "formula_bot") continue;
      if (isConnectionStale(ws, CONNECTION_TIMEOUT)) {
        staleConnections.push(ws);
        console.log(`Stale connection detected for user: ${userId}`);
      }
    }
    
    staleConnections.forEach(ws => {
      try {
        send(ws, "connection-timeout", { message: "Connection timeout" });
        ws.close();
      } catch (error) {
        console.error("Error closing stale connection:", error);
      }
      untrackConnection(ws);
    });
  }, HEARTBEAT_INTERVAL);
};

export const validateRoomConnections = async (roomId: string, players: any[]) => {
  const validPlayers = players.filter(player => {
    const ws = userToWs.get(player.userId);
    return ws && !isConnectionStale(ws);
  });
  
  if (validPlayers.length !== players.length) {
    console.log(`Room ${roomId}: ${players.length - validPlayers.length} players have stale connections`);
  }
  
  return validPlayers;
};

export const sendConnectionStatus = (ws: ServerWebSocket<unknown>, status: "connected" | "disconnected" | "timeout") => {
  send(ws, "connection-status", { status });
}; 