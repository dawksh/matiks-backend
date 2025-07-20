import type { ServerWebSocket } from "bun";
import type { Player } from "./types";

export const send = (ws: ServerWebSocket<unknown> | undefined, type: string, data: any) => {
  if (!ws || ws.readyState !== 1) {
    return false;
  }
  
  try {
    ws.send(JSON.stringify({ type, ...data }));
    return true;
  } catch (error) {
    console.error("Failed to send message:", error);
    return false;
  }
};

export const broadcast = (players: Player[], type: string, data: any) => {
  const validPlayers = players.filter(p => p.ws && p.ws.readyState === 1);
  validPlayers.forEach(p => send(p.ws, type, data));
  return validPlayers.length;
};

export const ping = (ws: ServerWebSocket<unknown>) => {
  if (ws.readyState === 1) {
    try {
      ws.send(JSON.stringify({ type: "ping", timestamp: Date.now() }));
      return true;
    } catch (error) {
      console.error("Failed to send ping:", error);
      return false;
    }
  }
  return false;
};

export const validateConnection = (ws: ServerWebSocket<unknown>): boolean => {
  return ws && ws.readyState === 1;
};

export const sendHeartbeat = (ws: ServerWebSocket<unknown>) => {
  return ping(ws);
}; 