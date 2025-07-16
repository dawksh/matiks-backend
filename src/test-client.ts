import { WebSocket } from "bun:web";

const ws = new WebSocket("ws://localhost:3000");
const userId = "test-user-" + Math.random().toString(36).slice(2, 7);

console.log("Attempting to connect to ws://localhost:3000...");

ws.onopen = () => {
  console.log("Connected to server");
  
  const message = {
    type: "join-matchmaking",
    userId
  };
  console.log("Sending:", message);
  ws.send(JSON.stringify(message));
};

ws.onmessage = (event: MessageEvent) => {
  try {
    const message = JSON.parse(event.data);
    console.log("Received:", message);
  } catch (err) {
    console.log("Raw message:", event.data);
  }
};

ws.onclose = (event: CloseEvent) => {
  console.log("Connection closed:", {
    code: event.code,
    reason: event.reason,
    wasClean: event.wasClean
  });
};

ws.onerror = (event: Event) => {
  console.error("WebSocket error:", event);
}; 