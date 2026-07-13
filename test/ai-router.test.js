import test from "node:test";
import assert from "node:assert/strict";
import { GeminiUsageTracker, generateAiReply } from "../src/ai-router.js";
import { GeminiApiError } from "../src/gemini.js";

test("prefers Groq when Gemini approaches its soft limit", async () => {
  const tracker = new GeminiUsageTracker({ softRequestsPerMinute: 2 });
  tracker.recordGeminiRequest(1000);
  tracker.recordGeminiRequest(2000);

  const result = await generateAiReply("test", {
    geminiApiKey: "gemini",
    groqApiKey: "groq",
    tracker,
    now: 3000,
    geminiGenerator: async () => assert.fail("Gemini should not be called"),
    groqGenerator: async () => "fallback",
  });

  assert.equal(result.provider, "groq");
  assert.equal(result.reason, "gemini-soft-limit");
});

test("retries with Groq after a Gemini quota error", async () => {
  const tracker = new GeminiUsageTracker({ fallbackMinutes: 15 });
  const result = await generateAiReply("test", {
    geminiApiKey: "gemini",
    groqApiKey: "groq",
    tracker,
    now: 5000,
    geminiGenerator: async () => {
      throw new GeminiApiError("quota", { status: 429, code: "RESOURCE_EXHAUSTED" });
    },
    groqGenerator: async () => "fallback",
  });

  assert.equal(result.provider, "groq");
  assert.equal(result.reason, "gemini-limit");
  assert.equal(tracker.shouldPreferGroq(6000), true);
});

test("reports remaining soft-limit requests and fallback state", () => {
  const tracker = new GeminiUsageTracker({
    softRequestsPerMinute: 3,
    softTokensPerMinute: 100,
    dailyRequestLimit: 10,
    dailyTokenLimit: 1000,
    fallbackMinutes: 15,
  });
  tracker.recordGeminiRequest(1000);
  tracker.recordGeminiRequest(2000);
  tracker.recordGeminiUsage({ totalTokens: 40 }, 2500);

  assert.deepEqual(tracker.getRateLimitStatus(3000), {
    used: 2,
    limit: 3,
    remaining: 1,
    resetAt: 61000,
    fallbackActive: false,
    fallbackRemainingMs: 0,
    fallbackUntil: null,
    tokensUsedThisMinute: 40,
    tokenLimit: 100,
    tokensRemaining: 60,
    dailyTokensUsed: 40,
    dailyTokenLimit: 1000,
    dailyTokensRemaining: 960,
    dailyRequestsUsed: 2,
    dailyRequestLimit: 10,
    dailyRequestsRemaining: 8,
  });

  tracker.openFallbackCircuit(3000);
  const status = tracker.getRateLimitStatus(4000);
  assert.equal(status.fallbackActive, true);
  assert.equal(status.fallbackUntil, 903000);
  assert.equal(status.fallbackRemainingMs, 899000);
});

test("passes AI settings to the selected provider", async () => {
  const tracker = new GeminiUsageTracker();
  let receivedSettings;

  await generateAiReply("test", {
    geminiApiKey: "gemini",
    tracker,
    settings: { length: "normal", language: "ja", style: "polite" },
    geminiGenerator: async (_prompt, options) => {
      receivedSettings = options.settings;
      return "reply";
    },
  });

  assert.deepEqual(receivedSettings, { length: "normal", language: "ja", style: "polite" });
});

test("uses Groq as the configured primary provider", async () => {
  const tracker = new GeminiUsageTracker();
  const result = await generateAiReply("test", {
    geminiApiKey: "gemini",
    groqApiKey: "groq",
    preferredProvider: "groq",
    tracker,
    geminiGenerator: async () => assert.fail("Gemini should not be called"),
    groqGenerator: async () => "groq-primary",
  });

  assert.equal(result.provider, "groq");
  assert.equal(result.reason, "configured-primary");
});

test("falls back from Qwen to GPT-OSS 120B", async () => {
  const tracker = new GeminiUsageTracker();
  const calledModels = [];
  const result = await generateAiReply("test", {
    groqApiKey: "groq",
    groqModel: "qwen/qwen3.6-27b",
    groqFallbackModel: "openai/gpt-oss-120b",
    preferredProvider: "groq",
    tracker,
    groqGenerator: async (_prompt, options) => {
      calledModels.push(options.model);
      if (options.model === "qwen/qwen3.6-27b") throw new Error("Qwen unavailable");
      return "gpt-oss fallback";
    },
  });

  assert.deepEqual(calledModels, ["qwen/qwen3.6-27b", "openai/gpt-oss-120b"]);
  assert.equal(result.text, "gpt-oss fallback");
  assert.equal(result.model, "openai/gpt-oss-120b");
  assert.equal(result.reason, "groq-model-fallback");
});

test("uses Qwen before GPT-OSS when Gemini is unavailable", async () => {
  const tracker = new GeminiUsageTracker();
  const calledModels = [];
  const result = await generateAiReply("test", {
    geminiApiKey: "gemini",
    groqApiKey: "groq",
    qwenModel: "qwen/qwen3.6-27b",
    groqFallbackModel: "openai/gpt-oss-120b",
    tracker,
    geminiGenerator: async () => {
      throw new GeminiApiError("quota", { status: 429 });
    },
    groqGenerator: async (_prompt, options) => {
      calledModels.push(options.model);
      if (options.model === "qwen/qwen3.6-27b") throw new Error("Qwen unavailable");
      return "gpt-oss fallback";
    },
  });

  assert.deepEqual(calledModels, ["qwen/qwen3.6-27b", "openai/gpt-oss-120b"]);
  assert.equal(result.model, "openai/gpt-oss-120b");
  assert.equal(result.reason, "gemini-limit");
});

test("uses OpenAI as the configured primary provider", async () => {
  const tracker = new GeminiUsageTracker();
  const result = await generateAiReply("test", {
    openaiApiKey: "openai",
    openaiModel: "gpt-test",
    preferredProvider: "openai",
    tracker,
    openaiGenerator: async (_prompt, options) => {
      assert.equal(options.model, "gpt-test");
      return "openai-primary";
    },
  });

  assert.equal(result.provider, "openai");
  assert.equal(result.reason, "configured-primary");
});

test("prefers ChatGPT Codex OAuth over an OpenAI API key", async () => {
  const tracker = new GeminiUsageTracker();
  const result = await generateAiReply("test", {
    openaiApiKey: "must-not-be-used",
    openaiOAuthAvailable: true,
    preferredProvider: "openai",
    tracker,
    openaiGenerator: async () => assert.fail("API key route should not be called"),
    codexOAuthGenerator: async (_prompt, options) => {
      assert.equal(options.model, undefined);
      return "oauth-primary";
    },
  });

  assert.equal(result.text, "oauth-primary");
  assert.equal(result.provider, "openai");
  assert.equal(result.reason, "codex-oauth");
});

test("prefers Groq after reaching the Gemini daily token limit", async () => {
  const tracker = new GeminiUsageTracker({ dailyTokenLimit: 100 });
  tracker.recordGeminiUsage({ totalTokens: 100 }, 1000);

  const result = await generateAiReply("test", {
    geminiApiKey: "gemini",
    groqApiKey: "groq",
    tracker,
    now: 2000,
    geminiGenerator: async () => assert.fail("Gemini should not be called"),
    groqGenerator: async () => "fallback",
  });

  assert.equal(result.provider, "groq");
  assert.equal(result.reason, "gemini-soft-limit");
});

test("passes the trusted application task to the selected provider", async () => {
  const tracker = new GeminiUsageTracker();
  let receivedTaskInstruction;

  await generateAiReply("test", {
    geminiApiKey: "gemini",
    tracker,
    taskInstruction: "Only perform the server-defined task.",
    geminiGenerator: async (_prompt, options) => {
      receivedTaskInstruction = options.taskInstruction;
      return "reply";
    },
  });

  assert.equal(receivedTaskInstruction, "Only perform the server-defined task.");
});
