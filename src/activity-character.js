const PHASES = new Set(["idle", "listening", "thinking", "speaking"]);
const EMOTIONS = new Set(["neutral", "happy", "sad", "angry", "surprised"]);

class ActivityCharacterPublisher {
  constructor({
    baseUrl = process.env.ACTIVITY_SERVER_URL,
    roomId = process.env.ACTIVITY_INSTANCE_ID,
    secret = process.env.ACTIVITY_BOT_API_SECRET,
    fetchImpl = fetch,
    timeoutMs = 3_000,
    logger = console,
  } = {}) {
    this.baseUrl = String(baseUrl ?? "").trim().replace(/\/+$/u, "");
    this.roomId = String(roomId ?? "").trim();
    this.secret = String(secret ?? "").trim();
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.logger = logger;
  }

  isConfigured() {
    try {
      const url = new URL(this.baseUrl);
      const secureTransport = url.protocol === "https:" || (
        url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      );
      return secureTransport && this.secret.length >= 32 && /^[A-Za-z0-9._:-]{1,200}$/u.test(this.roomId);
    } catch {
      return false;
    }
  }

  async publish(guildId, { phase, emotion = "neutral", text = "", turnId = null } = {}) {
    if (!this.isConfigured() || !/^\d{17,20}$/u.test(String(guildId ?? ""))) return false;
    const state = {
      phase: PHASES.has(phase) ? phase : "idle",
      emotion: EMOTIONS.has(emotion) ? emotion : "neutral",
      text: String(text ?? "").trim().slice(0, 2_000),
      turnId: turnId ? String(turnId).slice(0, 100) : null,
      updatedAt: new Date().toISOString(),
    };
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/internal/character-state`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({ roomId: this.roomId, guildId: String(guildId), state }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response?.ok) throw new Error(`Activity server returned ${response?.status ?? "unknown"}.`);
      return true;
    } catch (error) {
      this.logger.warn?.(`[activity-character] State publish failed: ${error.message}`);
      return false;
    }
  }
}

export { ActivityCharacterPublisher };
