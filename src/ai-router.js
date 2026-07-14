import {
  generateShortReply,
  isGeminiLimitError,
  isGeminiUnavailableError,
} from "./gemini.js";
import { generateGroqShortReply } from "./groq.js";
import { generateOpenAiShortReply } from "./openai.js";
import { generateCodexOAuthShortReply } from "./codex-oauth.js";
import {
  AiOutputReviewError,
  UnsafeAiOutputError,
  assertLocallySafeAiOutput,
} from "./ai-output-guard.js";

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
      (this.dailyRequestLimit !== null && this.dailyRequestUsage >= this.dailyRequestLimit) ||
      (this.dailyTokenLimit !== null && this.dailyTokenUsage >= this.dailyTokenLimit)
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
    qwenModel,
    groqFallbackModel,
    openaiApiKey,
    openaiOAuthAvailable = false,
    openaiModel,
    preferredProvider = "gemini",
    history = [],
    settings = {},
    taskInstruction = "",
    imageAssets = [],
    onGeminiUsage,
    tracker,
    geminiGenerator = generateShortReply,
    groqGenerator = generateGroqShortReply,
    openaiGenerator = generateOpenAiShortReply,
    codexOAuthGenerator = generateCodexOAuthShortReply,
    outputSafetyReviewer = null,
    now = Date.now(),
  },
) {
  const canUseGemini = Boolean(geminiApiKey);
  const canUseGroq = Boolean(groqApiKey);
  const canUseOpenAi = openaiOAuthAvailable || Boolean(openaiApiKey);
  if (!canUseGemini && !canUseGroq && !canUseOpenAi) {
    throw new Error("No AI API key is configured.");
  }

  const generateGroqCascade = async (primaryModel) => {
    try {
      return {
        text: await groqGenerator(prompt, {
          apiKey: groqApiKey,
          model: primaryModel,
          history,
          settings,
          taskInstruction,
        }),
        model: primaryModel,
        usedModelFallback: false,
      };
    } catch (error) {
      if (!groqFallbackModel || groqFallbackModel === primaryModel) throw error;
      return {
        text: await groqGenerator(prompt, {
          apiKey: groqApiKey,
          model: groqFallbackModel,
          history,
          settings,
          taskInstruction,
        }),
        model: groqFallbackModel,
        usedModelFallback: true,
      };
    }
  };

  const finalizeResult = async (result) => {
    assertLocallySafeAiOutput(result.text);
    if (typeof outputSafetyReviewer === "function") {
      let review;
      try {
        review = await outputSafetyReviewer(result.text);
      } catch (error) {
        if (error?.code === "AI_OUTPUT_REVIEW_FAILED") throw error;
        throw new AiOutputReviewError(error?.message ?? "AI output safety review failed.");
      }
      if (!review || review.allowed !== true) {
        throw new UnsafeAiOutputError(review?.category ?? "other_unsafe");
      }
    }
    return result;
  };

  if (preferredProvider === "openai") {
    if (!canUseOpenAi) throw new Error("ChatGPT/Codex OAuth is not configured.");
    return finalizeResult({
      text: openaiOAuthAvailable
        ? await codexOAuthGenerator(prompt, {
            model: openaiModel,
            history,
            settings,
            taskInstruction,
            imageAssets,
          })
        : await openaiGenerator(prompt, {
            apiKey: openaiApiKey,
            model: openaiModel,
            history,
            settings,
            taskInstruction,
          }),
      provider: "openai",
      reason: openaiOAuthAvailable ? "codex-oauth" : "configured-primary",
    });
  }

  if (preferredProvider === "groq" && canUseGroq) {
    const result = await generateGroqCascade(groqModel);
    return finalizeResult({
      text: result.text,
      provider: "groq",
      model: result.model,
      reason: result.usedModelFallback ? "groq-model-fallback" : "configured-primary",
    });
  }

  if ((!canUseGemini || tracker.shouldPreferGroq(now)) && canUseGroq) {
    const result = await generateGroqCascade(qwenModel ?? groqModel);
    return finalizeResult({
      text: result.text,
      provider: "groq",
      model: result.model,
      reason: canUseGemini ? "gemini-soft-limit" : "gemini-unavailable",
    });
  }

  tracker.recordGeminiRequest(now);
  try {
    return finalizeResult({
      text: await geminiGenerator(prompt, {
        apiKey: geminiApiKey,
        model: geminiModel,
        history,
        settings,
        taskInstruction,
        onUsage: onGeminiUsage,
      }),
      provider: "gemini",
      reason: "primary",
    });
  } catch (error) {
    const shouldFallback = isGeminiLimitError(error) || isGeminiUnavailableError(error);
    if (!shouldFallback || !canUseGroq) throw error;

    tracker.openFallbackCircuit(now);
    const result = await generateGroqCascade(qwenModel ?? groqModel);
    return finalizeResult({
      text: result.text,
      provider: "groq",
      model: result.model,
      reason: isGeminiLimitError(error) ? "gemini-limit" : "gemini-unavailable",
    });
  }
}

export { GeminiUsageTracker, generateAiReply };
