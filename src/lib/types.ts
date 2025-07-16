import type { ServerWebSocket } from "bun";

export type UserId = string;
export type RoomId = string;
export type Player = { userId: UserId; ws: ServerWebSocket<unknown> };
export type Message = { type: string; userId: UserId; roomId?: RoomId; answer?: any; results?: any }; 