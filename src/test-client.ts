const ws = new WebSocket("ws://localhost:3000");
const userId = "test-user-" + Math.random().toString(36).slice(2, 7);
let currentQuestionId: string | null = null;
let currentRoomId: string | null = null;

console.log(`Starting test client with userId: ${userId}`);

const calculateAnswer = (question: string): number => {
  const parts = question.split("+");
  if (parts.length !== 2) return 0;
  const a = parseInt(parts[0]?.trim() ?? "0");
  const b = parseInt(parts[1]?.trim() ?? "0");
  return isNaN(a) || isNaN(b) ? 0 : a + b;
};

const handleQuestion = (question: { id: string; question: string }) => {
  currentQuestionId = question.id;
  const answer = calculateAnswer(question.question);
  console.log(`Processing question ${question.id}: ${question.question} = ${answer}`);
  
  setTimeout(() => {
    if (currentQuestionId === question.id && currentRoomId) {
      ws.send(JSON.stringify({
        type: "submit-answer",
        userId,
        roomId: currentRoomId,
        questionId: question.id,
        answer
      }));
      console.log(`Submitted answer for ${question.id}: ${answer}`);
    }
  }, 1000);
};

ws.onopen = () => {
  console.log("Connected to server");
  ws.send(JSON.stringify({ type: "join-matchmaking", userId }));
  console.log("Joined matchmaking queue");
};

ws.onmessage = (event) => {
  try {
    const message = JSON.parse(event.data);
    const { type } = message;

    switch (type) {
      case "queue-joined":
        console.log(`Queue position: ${message.position}`);
        break;

      case "match-found":
        console.log(`Matched! Room: ${message.roomId}`);
        currentRoomId = message.roomId;
        break;

      case "room-ready":
        const startDelay = (message.startTime - Date.now()) / 1000;
        console.log(`Room ready with ${message.players.length} players`);
        console.log(`Game starting in ${startDelay.toFixed(1)}s`);
        break;

      case "game-start":
        console.log("Game started!");
        console.log(message.question);
        handleQuestion(message.question);
        break;

      case "next-question":
        console.log("Received next question");
        handleQuestion(message.question);
        break;

      case "point-update":
        console.log("Score update:", message.scores);
        break;

      case "answer-result":
        console.log(
          `Answer ${message.correct ? "✓" : "✗"} for Q${message.questionId}`
        );
        break;

      case "round-end":
        const { winner, scores, reason } = message.results;
        console.log("Round ended!", {
          winner: winner === userId ? "You" : "Opponent",
          yourScore: scores[userId],
          opponentScore: Object.values(scores).find(s => s !== scores[userId]),
          reason
        });
        break;

      case "error":
        console.error("Server error:", message.message);
        break;
    }
  } catch (err) {
    console.error("Failed to parse:", event.data);
  }
};

ws.onclose = ({ code, reason, wasClean }) => 
  console.log("Connection closed:", { code, reason, wasClean });

ws.onerror = (event) => console.error("WebSocket error:", event); 