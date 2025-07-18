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
  const player: Player = { userId, ws, score: 0 };
  queue.push(player);
  wsToUser.set(ws, userId);
  send(ws, "queue-joined", { position: queue.length });
  if (queue.length >= 2) createMatch();
};

const createMatch = async () => {
  const [p1, p2] = [queue.shift(), queue.shift()];
  if (!p1 || !p2) return;
  await createRoomWithPlayers([
    { userId: p1.userId, ws: p1.ws },
    { userId: p2.userId, ws: p2.ws },
  ]);
};
