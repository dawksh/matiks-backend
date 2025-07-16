import type { ServerWebSocket } from "bun";
import type { Player } from "./types";

export const send = (ws: ServerWebSocket<unknown>, type: string, data: any) => 
  ws.readyState === 1 && ws.send(JSON.stringify({ type, ...data }));

export const broadcast = (players: Player[], type: string, data: any) => 
  players.forEach(p => send(p.ws, type, data)); 