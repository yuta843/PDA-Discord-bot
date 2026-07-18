const DEFAULT_MAX_TURNS = 5;

function normalizeContent(content) {
  return typeof content === "string" ? content.trim() : "";
}

class ConversationHistory {
  constructor({ maxTurns = DEFAULT_MAX_TURNS } = {}) {
    this.maxTurns = Number.isInteger(maxTurns) && maxTurns > 0 ? maxTurns : DEFAULT_MAX_TURNS;
    this.conversations = new Map();
  }

  get(key) {
    const turns = this.conversations.get(key) ?? [];
    return turns.flatMap(({ user, assistant }) => [
      { role: "user", content: user },
      { role: "assistant", content: assistant },
    ]);
  }

  getTurns(key) {
    return (this.conversations.get(key) ?? []).map(({ user, assistant }) => ({
      user,
      assistant,
    }));
  }

  getTurnCount(key) {
    return (this.conversations.get(key) ?? []).length;
  }

  add(key, userContent, assistantContent) {
    const user = normalizeContent(userContent);
    const assistant = normalizeContent(assistantContent);
    if (!key || !user || !assistant) return;

    const turns = this.conversations.get(key) ?? [];
    turns.push({ user, assistant });
    this.conversations.set(key, turns.slice(-this.maxTurns));
  }

  clear(key) {
    this.conversations.delete(key);
  }
}

export { ConversationHistory, DEFAULT_MAX_TURNS };
