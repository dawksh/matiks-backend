const randomDelay = (min: number, max: number) =>
  Math.random() * (max - min) + min;

const createClient = (userId: string) => {
  const ws = new WebSocket("ws://localhost:3000/ws");
  let currentQuestionId: string | null = null;
  let currentRoomId: string | null = null;
  let active = true;

  const log = (msg: string, data?: any) =>
    console.log(`[${userId}] ${msg}`, data ?? "");

  const calculateAnswer = (question: string): number => {
    const [aRaw, op, bRaw] = question.split(/\s*([+\-*/])\s*/);
    const a = parseInt(aRaw ?? "");
    const b = parseInt(bRaw ?? "");
    if (isNaN(a) || isNaN(b)) return 0;
    return op === "+"
      ? a + b
      : op === "-"
      ? a - b
      : op === "*"
      ? a * b
      : op === "/"
      ? Math.floor(a / b)
      : 0;
  };

  const maybeDrop = () => {
    if (Math.random() < 0.05) {
      log("Simulated disconnect");
      active = false;
      ws.close();
      return true;
    }
    return false;
  };

  const handleQuestion = (question: { id: string; question: string }) => {
    if (!active || maybeDrop()) return;
    currentQuestionId = question.id;
    const answer = calculateAnswer(question.question);
    log(`Q${question.id}: ${question.question} = ${answer}`);
    if (Math.random() < 0.1) {
      log("Skipping answer (simulated user distraction)");
      return;
    }
    setTimeout(() => {
      if (!active || currentQuestionId !== question.id || !currentRoomId) return;
      ws.send(
        JSON.stringify({
          type: "submit-answer",
          userId,
          roomId: currentRoomId,
          questionId: question.id,
          answer,
        })
      );
      log(`Submitted answer ${answer} for Q${question.id}`);
    }, randomDelay(800, 3500));
  };

  ws.onopen = () => {
    log("Connected");
    setTimeout(() => {
      if (!active) return;
      ws.send(
        JSON.stringify({
          type: "register-user",
          fid: userId,
          displayName: `@${userId}${Math.floor(Math.random()*100)}`,
          profilePictureUrl: `https://example.com/profile${Math.floor(Math.random()*10)}.png`,
          username: userId,
        })
      );
      setTimeout(() => {
        if (!active) return;
        ws.send(JSON.stringify({ type: "join-matchmaking", userId }));
        log("Joined matchmaking queue");
      }, randomDelay(100, 2000));
    }, randomDelay(100, 2000));
  };

  ws.onmessage = (event) => {
    if (!active) return;
    try {
      const message = JSON.parse(event.data);
      const { type } = message;
      switch (type) {
        case "queue-joined":
          log(`Queue position: ${message.position}`);
          break;
        case "match-found":
          currentRoomId = message.roomId;
          log(`Matched! Room: ${message.roomId}`);
          break;
        case "game-start":
          log("Game started");
          handleQuestion(message.question);
          break;
        case "next-question":
          log("Next question");
          handleQuestion(message.question);
          break;
        case "answer-result":
          log(`Answer ${message.correct ? "✓" : "✗"} for Q${message.questionId}`);
          break;
        case "round-end":
          log("Round ended", message.results);
          active = false;
          ws.close();
          break;
        case "error":
          log(`Error: ${message.message}`);
          active = false;
          ws.close();
          break;
      }
    } catch (err) {
      log("Failed to parse message", event.data);
      active = false;
      ws.close();
    }
  };

  ws.onclose = ({ code, reason, wasClean }) =>
    log("Connection closed", { code, reason, wasClean });

  ws.onerror = (event) => {
    log("WebSocket error", event);
    active = false;
    ws.close();
  };
};

Array.from({ length: 100 }).forEach((_, i) => {
  const userId = `test-user-${Math.random().toString(36).slice(2, 7)}`;
  setTimeout(() => createClient(userId), randomDelay(0, 30000));
});
