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
    codexOAuthOptions = {},
    preferredProvider = "gemini",
    history = [],
    agentMemory = [],
    agentSkillContext = "",
    settings = {},
    taskInstruction = "",
    imageAssets = [],
    onGeminiUsage,
    tracker = new GeminiUsageTracker(),
    geminiGenerator = generateShortReply,
    groqGenerator = generateGroqShortReply,
    openaiGenerator = generateOpenAiShortReply,
    codexOAuthGenerator = generateCodexOAuthShortReply,
    outputSafetyReviewer = null,
    outputReviewStyle = null,
    now = Date.now(),
  },
) {
  const canUseGemini = Boolean(geminiApiKey);
  const canUseGroq = Boolean(groqApiKey);
  const canUseOpenAi = openaiOAuthAvailable || Boolean(openaiApiKey);
  if (!canUseGemini && !canUseGroq && !canUseOpenAi) {
    throw new Error("No AI API key is configured.");
  }

  const buildTaskInstruction = (extraInstruction = "") =>
    [taskInstruction, extraInstruction].filter(Boolean).join(" ");

  const generateGroqCascade = async (primaryModel, extraInstruction = "") => {
    try {
      return {
        text: await groqGenerator(prompt, {
          apiKey: groqApiKey,
          model: primaryModel,
          history,
          agentSkillContext,
          settings,
          taskInstruction: buildTaskInstruction(extraInstruction),
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
          agentSkillContext,
          settings,
          taskInstruction: buildTaskInstruction(extraInstruction),
        }),
        model: groqFallbackModel,
        usedModelFallback: true,
      };
    }
  };

  const reviewResult = async (result) => {
    assertLocallySafeAiOutput(result.text);
    if (typeof outputSafetyReviewer === "function") {
      let review;
      try {
        review = await outputSafetyReviewer(result.text, { style: outputReviewStyle ?? settings.style });
      } catch (error) {
        if (error?.code === "AI_OUTPUT_REVIEW_FAILED") throw error;
        throw new AiOutputReviewError(error?.message ?? "AI output safety review failed.");
      }
      const decision = review?.decision ?? (review?.allowed === true ? "ALLOW" : "BLOCK");
      return { ...review, decision };
    }
    return { decision: "ALLOW", allowed: true, category: null, reason: "local-only" };
  };

  const generateOpenAiResult = async (reason, extraInstruction = "") => ({
    text: openaiOAuthAvailable
      ? await codexOAuthGenerator(prompt, {
          model: openaiModel,
          history,
          agentMemory,
          agentSkillContext,
          settings,
          taskInstruction: buildTaskInstruction(extraInstruction),
          imageAssets,
          ...codexOAuthOptions,
        })
      : await openaiGenerator(prompt, {
          apiKey: openaiApiKey,
          model: openaiModel,
          history,
          agentSkillContext,
          settings,
          taskInstruction: buildTaskInstruction(extraInstruction),
        }),
    provider: "openai",
    reason: reason ?? (openaiOAuthAvailable ? "codex-oauth" : "configured-primary"),
  });

  const generateGroqResult = async (primaryModel, reason, extraInstruction = "") => {
    const result = await generateGroqCascade(primaryModel ?? groqModel, extraInstruction);
    return {
      text: result.text,
      provider: "groq",
      model: result.model,
      reason: reason === "configured-primary" && result.usedModelFallback
        ? "groq-model-fallback"
        : reason,
    };
  };

  const generateGeminiResult = async (reason, extraInstruction = "") => {
    tracker.recordGeminiRequest(now);
    return {
      text: await geminiGenerator(prompt, {
        apiKey: geminiApiKey,
        model: geminiModel,
        history,
        agentSkillContext,
        settings,
        taskInstruction: buildTaskInstruction(extraInstruction),
        onUsage: onGeminiUsage,
      }),
      provider: "gemini",
      reason,
    };
  };

  const selectedProvider = ["gemini", "groq", "openai"].includes(preferredProvider)
    ? preferredProvider
    : "gemini";
  const attempts = [];
  const attemptedProviders = new Set();
  const addAttempt = (provider, reason, model = null) => {
    if (attemptedProviders.has(provider)) return;
    if (imageAssets.length > 0 && provider !== "openai") return;
    const available = {
      gemini: canUseGemini,
      groq: canUseGroq,
      openai: canUseOpenAi,
    }[provider];
    if (!available) return;
    attemptedProviders.add(provider);
    attempts.push({ provider, reason, model });
  };

  const geminiShouldYield = canUseGemini && tracker.shouldPreferGroq(now);
  if (selectedProvider === "gemini") {
    if (geminiShouldYield || !canUseGemini) {
      addAttempt(
        "groq",
        geminiShouldYield ? "gemini-soft-limit" : "gemini-unavailable",
        qwenModel ?? groqModel,
      );
    } else {
      addAttempt("gemini", "primary");
    }
    addAttempt("groq", "provider-fallback", qwenModel ?? groqModel);
    addAttempt("gemini", "primary");
    addAttempt("openai", "provider-fallback");
  } else if (selectedProvider === "groq") {
    addAttempt("groq", "configured-primary", groqModel);
    addAttempt("gemini", "provider-fallback");
    addAttempt("openai", "provider-fallback");
  } else {
    addAttempt("openai", openaiOAuthAvailable ? "codex-oauth" : "configured-primary");
    addAttempt("groq", "provider-fallback", groqModel);
    addAttempt("gemini", "provider-fallback");
  }

  let lastError = null;
  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index];
    try {
      const generateAttempt = (extraInstruction = "") => attempt.provider === "openai"
        ? generateOpenAiResult(attempt.reason, extraInstruction)
        : attempt.provider === "groq"
          ? generateGroqResult(attempt.model, attempt.reason, extraInstruction)
          : generateGeminiResult(attempt.reason, extraInstruction);
      let result = await generateAttempt();
      let review = await reviewResult(result);
      if (review.decision === "BLOCK") {
        throw new UnsafeAiOutputError(review.category ?? "other_unsafe");
      }
      if (review.decision === "REWRITE") {
        const rewriteInstruction = [
          "Regenerate the answer once. Preserve the useful intent, but remove or safely replace the part flagged by the output reviewer.",
          `Reviewer category: ${review.category ?? "other_unsafe"}.`,
          review.reason ? `Reviewer reason: ${review.reason}.` : "",
          review.rewriteInstruction ? `Required correction: ${review.rewriteInstruction}.` : "",
          "Do not mention the review process. Return only the rewritten answer.",
        ].filter(Boolean).join(" ");
        result = await generateAttempt(rewriteInstruction);
        review = await reviewResult(result);
        if (review.decision !== "ALLOW") {
          throw new UnsafeAiOutputError(review.category ?? "other_unsafe");
        }
        return { ...result, rewrittenForSafety: true };
      }
      if (review.decision !== "ALLOW") {
        throw new AiOutputReviewError(`Unhandled AI output review decision: ${review.decision}`);
      }
      return result;
    } catch (error) {
      if (error?.code === "UNSAFE_AI_OUTPUT" || error?.code === "AI_OUTPUT_REVIEW_FAILED") {
        throw error;
      }

      if (
        attempt.provider === "gemini" &&
        !isGeminiLimitError(error) &&
        !isGeminiUnavailableError(error)
      ) {
        throw error;
      }

      lastError = error;
      if (attempt.provider === "gemini") {
        if (isGeminiLimitError(error)) {
          tracker.openFallbackCircuit(now);
          if (attempts[index + 1]) attempts[index + 1].reason = "gemini-limit";
        } else if (isGeminiUnavailableError(error) && attempts[index + 1]) {
          attempts[index + 1].reason = "gemini-unavailable";
        }
      }
    }
  }

  throw lastError ?? new Error("No configured AI provider is available.");
}

export { GeminiUsageTracker, generateAiReply };
