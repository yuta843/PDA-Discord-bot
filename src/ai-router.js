import {
  generateShortReply,
  isGeminiLimitError,
  isGeminiUnavailableError,
} from "./gemini.js";
import { generateGroqShortReply } from "./groq.js";

function getLocalDateKey(timestamp) {
  const date = new Date(timestamp);
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()].join("-");
}

class GeminiUsageTracker {
  constructor({
    softRequestsPerMinute = 8,
    softTokensPerMinute = null,
    dailyRequestLimit = null,
    dailyTokenLimit = null,
    fallbackMinutes = 15,
  } = {}) {
    this.softRequestsPerMinute = softRequestsPerMinute;
    this.softTokensPerMinute = Number.isFinite(softTokensPerMinute) && softTokensPerMinute > 0
      ? softTokensPerMinute
      : null;
    this.dailyRequestLimit = Number.isFinite(dailyRequestLimit) && dailyRequestLimit > 0
      ? dailyRequestLimit
      : null;
    this.dailyTokenLimit = Number.isFinite(dailyTokenLimit) && dailyTokenLimit > 0
      ? dailyTokenLimit
      : null;
    this.fallbackDurationMs = fallbackMinutes * 60_000;
    this.requestTimes = [];
    this.tokenUsages = [];
    this.dailyDateKey = null;
    this.dailyRequestUsage = 0;
    this.dailyTokenUsage = 0;
    this.fallbackUntil = 0;
  }

  prune(now) {
    this.requestTimes = this.requestTimes.filter((time) => now - time < 60_000);
    this.tokenUsages = this.tokenUsages.filter(({ time }) => now - time < 60_000);
    const dateKey = getLocalDateKey(now);
    if (this.dailyDateKey !== dateKey) {
      this.dailyDateKey = dateKey;
      this.dailyRequestUsage = 0;
      this.dailyTokenUsage = 0;
    }
  }

  shouldPreferGroq(now = Date.now()) {
    this.prune(now);
    const tokensUsedThisMinute = this.tokenUsages.reduce((sum, usage) => sum + usage.tokens, 0);
    return (
      now < this.fallbackUntil ||
      this.requestTimes.length >= this.softRequestsPerMinute ||
      (this.softTokensPerMinute !== null && tokensUsedThisMinute >= this.softTokensPerMinute) ||
      (this.dailyRequestLimit !== null && this.dailyRequestUsage >= this.dailyRequestLimit)
    );
  }

  recordGeminiRequest(now = Date.now()) {
    this.prune(now);
    this.requestTimes.push(now);
    this.dailyRequestUsage += 1;
  }

  recordGeminiUsage(usage = {}, now = Date.now()) {
    const tokens = Number(usage?.totalTokens);
    if (!Number.isFinite(tokens) || tokens <= 0) return;

    this.prune(now);
    this.tokenUsages.push({ time: now, tokens });
    this.dailyTokenUsage += tokens;
  }

  openFallbackCircuit(now = Date.now()) {
    this.fallbackUntil = now + this.fallbackDurationMs;
  }

  getRateLimitStatus(now = Date.now()) {
    this.prune(now);
    const oldestRequest = this.requestTimes[0];
    const fallbackRemainingMs = Math.max(this.fallbackUntil - now, 0);
    const tokensUsedThisMinute = this.tokenUsages.reduce((sum, usage) => sum + usage.tokens, 0);

    return {
      used: this.requestTimes.length,
      limit: this.softRequestsPerMinute,
      remaining: Math.max(this.softRequestsPerMinute - this.requestTimes.length, 0),
      resetAt: oldestRequest === undefined ? now : oldestRequest + 60_000,
      fallbackActive: fallbackRemainingMs > 0,
      fallbackRemainingMs,
      fallbackUntil: fallbackRemainingMs > 0 ? this.fallbackUntil : null,
      tokensUsedThisMinute,
      tokenLimit: this.softTokensPerMinute,
      tokensRemaining: this.softTokensPerMinute === null
        ? null
        : Math.max(this.softTokensPerMinute - tokensUsedThisMinute, 0),
      dailyTokensUsed: this.dailyTokenUsage,
      dailyTokenLimit: this.dailyTokenLimit,
      dailyTokensRemaining: this.dailyTokenLimit === null
        ? null
        : Math.max(this.dailyTokenLimit - this.dailyTokenUsage, 0),
      dailyRequestsUsed: this.dailyRequestUsage,
      dailyRequestLimit: this.dailyRequestLimit,
      dailyRequestsRemaining: this.dailyRequestLimit === null
        ? null
        : Math.max(this.dailyRequestLimit - this.dailyRequestUsage, 0),
    };
  }
}

async function generateAiReply(
  prompt,
  {
    geminiApiKey,
    geminiModel,
    groqApiKey,
    groqModel,
    history = [],
    settings = {},
    onGeminiUsage,
    tracker,
    geminiGenerator = generateShortReply,
    groqGenerator = generateGroqShortReply,
    now = Date.now(),
  },
) {
  const canUseGemini = Boolean(geminiApiKey);
  const canUseGroq = Boolean(groqApiKey);
  if (!canUseGemini && !canUseGroq) throw new Error("No AI API key is configured.");

  if ((!canUseGemini || tracker.shouldPreferGroq(now)) && canUseGroq) {
    return {
      text: await groqGenerator(prompt, {
        apiKey: groqApiKey,
        model: groqModel,
        history,
        settings,
      }),
      provider: "groq",
      reason: canUseGemini ? "gemini-soft-limit" : "gemini-unavailable",
    };
  }

  tracker.recordGeminiRequest(now);
  try {
    return {
      text: await geminiGenerator(prompt, {
        apiKey: geminiApiKey,
        model: geminiModel,
        history,
        settings,
        onUsage: onGeminiUsage,
      }),
      provider: "gemini",
      reason: "primary",
    };
  } catch (error) {
    const shouldFallback = isGeminiLimitError(error) || isGeminiUnavailableError(error);
    if (!shouldFallback || !canUseGroq) throw error;

    tracker.openFallbackCircuit(now);
    return {
      text: await groqGenerator(prompt, {
        apiKey: groqApiKey,
        model: groqModel,
        history,
        settings,
      }),
      provider: "groq",
      reason: isGeminiLimitError(error) ? "gemini-limit" : "gemini-unavailable",
    };
  }
}

export { GeminiUsageTracker, generateAiReply };
