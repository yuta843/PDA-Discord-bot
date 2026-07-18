const IMAGE_COOLDOWN_MS = 3 * 60_000;
const IMAGE_UNLIMITED_USER_ID = "1068329268397998161";

class ImageAccessLimiter {
  constructor({ cooldownMs = IMAGE_COOLDOWN_MS, unlimitedUserId = IMAGE_UNLIMITED_USER_ID } = {}) {
    this.cooldownMs = cooldownMs;
    this.unlimitedUserId = unlimitedUserId;
    this.lastUsedAt = new Map();
  }

  checkAndRecord(userId, now = Date.now()) {
    if (userId === this.unlimitedUserId) return { allowed: true, retryAfterMs: 0 };
    const lastUsedAt = this.lastUsedAt.get(userId);
    if (lastUsedAt === undefined) {
      this.lastUsedAt.set(userId, now);
      return { allowed: true, retryAfterMs: 0 };
    }
    const retryAfterMs = Math.max(lastUsedAt + this.cooldownMs - now, 0);
    if (retryAfterMs > 0) return { allowed: false, retryAfterMs };
    this.lastUsedAt.set(userId, now);
    return { allowed: true, retryAfterMs: 0 };
  }
}

export { IMAGE_COOLDOWN_MS, IMAGE_UNLIMITED_USER_ID, ImageAccessLimiter };
