const DEFAULT_ANK_TIMEOUT_MS = 10 * 60_000;
const MAX_ANK_TARGET = 100;

function parseAnkCommand(content) {
  const match = content?.trim().match(/^!ank(?:\s+([0-9]+|stop|status))?$/i);
  if (!match) return null;

  const argument = match[1]?.toLowerCase();
  if (!argument) return { type: "help" };
  if (argument === "stop") return { type: "stop" };
  if (argument === "status") return { type: "status" };

  const targetCount = Number.parseInt(argument, 10);
  if (!Number.isInteger(targetCount) || targetCount < 1 || targetCount > MAX_ANK_TARGET) {
    return { type: "invalid" };
  }
  return { type: "start", targetCount };
}

class AnkSessionStore {
  constructor({ timeoutMs = DEFAULT_ANK_TIMEOUT_MS } = {}) {
    this.timeoutMs = timeoutMs;
    this.sessions = new Map();
  }

  get(channelId, now = Date.now()) {
    const session = this.sessions.get(channelId);
    if (!session) return null;
    if (session.expiresAt <= now) {
      this.sessions.delete(channelId);
      return null;
    }
    return { ...session };
  }

  start(channelId, targetCount, startedBy, now = Date.now()) {
    const session = {
      channelId,
      targetCount,
      collectedCount: 0,
      startedBy,
      startedAt: now,
      expiresAt: now + this.timeoutMs,
    };
    this.sessions.set(channelId, session);
    return { ...session };
  }

  stop(channelId) {
    const session = this.sessions.get(channelId);
    this.sessions.delete(channelId);
    return session ? { ...session } : null;
  }

  accept(channelId, now = Date.now()) {
    const session = this.get(channelId, now);
    if (!session) return null;

    session.collectedCount += 1;
    if (session.collectedCount >= session.targetCount) {
      this.sessions.delete(channelId);
      return { ...session, complete: true, remaining: 0 };
    }

    this.sessions.set(channelId, session);
    return {
      ...session,
      complete: false,
      remaining: session.targetCount - session.collectedCount,
    };
  }
}

export { AnkSessionStore, DEFAULT_ANK_TIMEOUT_MS, MAX_ANK_TARGET, parseAnkCommand };
