import type { ServerWebSocket } from "bun";

export type UserId = string;
export type RoomId = string;
export type QuestionId = string;

export type Player = { 
  userId: UserId; 
  ws: ServerWebSocket<unknown>;
  score?: number;
};

export type Question = {
  id: QuestionId;
  question: string;
  answer: number;
};

export type GameState = {
  startTime: number;
  questions: Map<QuestionId, Question>;
  scores: Map<UserId, number>;
};

export type Message = { 
  type: string; 
  userId: UserId; 
  roomId?: RoomId; 
  questionId?: QuestionId;
  answer?: number; 
  results?: any;
}; 