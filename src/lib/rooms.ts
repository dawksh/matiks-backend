import type { ServerWebSocket } from "bun";
import type { Player, UserId, RoomId } from "./types";
import { send, broadcast } from "./websocket";
import { wsToUser } from "./connections";

export const rooms = new Map<RoomId, Player[]>();

export const createRoom = (ws: ServerWebSocket<unknown>, userId: UserId) => {
  const roomId = `room-${Math.random().toString(36).slice(2, 8)}`;
  const player: Player = { userId, ws };
  rooms.set(roomId, [player]);
  wsToUser.set(ws, userId);
  send(ws, "create-room", { roomId });
  send(ws, "room-ready", { players: [userId] });
};

export const joinRoom = (ws: ServerWebSocket<unknown>, userId: UserId, roomId: RoomId) => {
  const room = rooms.get(roomId);
  if (!room) {
    send(ws, "error", { message: "Room not found" });
    return;
  }
  if (room.length >= 2) {
    send(ws, "error", { message: "Room full" });
    return;
  }
  if (room.some(p => p.userId === userId)) {
    send(ws, "error", { message: "Already in room" });
    return;
  }
  
  const player: Player = { userId, ws };
  room.push(player);
  wsToUser.set(ws, userId);
  broadcast(room, "room-ready", { players: room.map(p => p.userId) });
};

export const handleGameEvent = (type: string, roomId: RoomId, data: any) => {
  const room = rooms.get(roomId);
  if (!room) return;
  
  if (type === "game-over") {
    broadcast(room, type, { results: data.results });
    rooms.delete(roomId);
  } else {
    broadcast(room, type, data);
  }
}; 