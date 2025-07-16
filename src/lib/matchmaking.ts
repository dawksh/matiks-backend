import type { ServerWebSocket } from "bun";
import type { Player, UserId, RoomId } from "./types";
import { send, broadcast } from "./websocket";
import { rooms } from "./rooms";
import { wsToUser } from "./connections";

export const queue: Player[] = [];

export const handleMatchmaking = (ws: ServerWebSocket<unknown>, userId: UserId) => {
  if (queue.some(p => p.userId === userId)) {
    send(ws, "error", { message: "Already in queue" });
    return;
  }
  const player: Player = { userId, ws };
  queue.push(player);
  wsToUser.set(ws, userId);
  if (queue.length >= 2) createMatch();
};

const createMatch = () => {
  const [p1, p2] = [queue.shift(), queue.shift()];
  if (!p1 || !p2) return;
  const roomId = `room-${Date.now()}`;
  rooms.set(roomId, [p1, p2]);
  [p1, p2].forEach(p => send(p.ws, "match-found", { roomId }));
  broadcast([p1, p2], "room-ready", { players: [p1.userId, p2.userId] });
}; 