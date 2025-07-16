import { serve } from "bun";
import type { ServerWebSocket } from "bun";

type UserId = string;
type RoomId = string;
type Player = { userId: UserId; ws: ServerWebSocket<unknown> };
type Message = { type: string; userId: UserId; roomId?: RoomId; answer?: any; results?: any };

const queue: Player[] = [];
const rooms = new Map<RoomId, Player[]>();
const wsToUser = new Map<ServerWebSocket<unknown>, UserId>();

const send = (ws: ServerWebSocket<unknown>, type: string, data: any) => 
  ws.readyState === 1 && ws.send(JSON.stringify({ type, ...data }));

const broadcast = (players: Player[], type: string, data: any) => 
  players.forEach(p => send(p.ws, type, data));

const handleMatchmaking = (ws: ServerWebSocket<unknown>, userId: UserId) => {
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

const createRoom = (ws: ServerWebSocket<unknown>, userId: UserId) => {
  const roomId = `room-${Math.random().toString(36).slice(2, 8)}`;
  const player: Player = { userId, ws };
  rooms.set(roomId, [player]);
  wsToUser.set(ws, userId);
  send(ws, "create-room", { roomId });
  send(ws, "room-ready", { players: [userId] });
};

const joinRoom = (ws: ServerWebSocket<unknown>, userId: UserId, roomId: RoomId) => {
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

const handleGameEvent = (type: string, roomId: RoomId, data: any) => {
  const room = rooms.get(roomId);
  if (!room) return;
  
  if (type === "game-over") {
    broadcast(room, type, { results: data.results });
    rooms.delete(roomId);
  } else {
    broadcast(room, type, data);
  }
};

const handleDisconnect = (ws: ServerWebSocket<unknown>) => {
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