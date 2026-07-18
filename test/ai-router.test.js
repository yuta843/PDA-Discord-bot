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

test("passes relevant agent skill reference data to the selected provider", async () => {
  let received = null;
  await generateAiReply("convert this video", {
    geminiApiKey: "gemini",
    agentSkillContext: "[UNTRUSTED AGENT SKILL REFERENCE DATA] video workflow",
    geminiGenerator: async (_prompt, options) => {
      received = options.agentSkillContext;
      return "ok";
    },
  });
  assert.equal(received, "[UNTRUSTED AGENT SKILL REFERENCE DATA] video workflow");
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

test("falls back from OpenAI to Groq after an OpenAI provider failure", async () => {
  const tracker = new GeminiUsageTracker();
  const result = await generateAiReply("test", {
    openaiApiKey: "openai",
    groqApiKey: "groq",
    preferredProvider: "openai",
    tracker,
    openaiGenerator: async () => {
      throw new Error("OpenAI timeout");
    },
    groqGenerator: async () => "groq fallback",
  });

  assert.equal(result.provider, "groq");
  assert.equal(result.reason, "provider-fallback");
});

test("falls back from Groq to OpenAI after a Groq provider failure", async () => {
  const tracker = new GeminiUsageTracker();
  const result = await generateAiReply("test", {
    openaiApiKey: "openai",
    groqApiKey: "groq",
    preferredProvider: "groq",
    tracker,
    groqGenerator: async () => {
      throw new Error("Groq timeout");
    },
    openaiGenerator: async () => "openai fallback",
  });

  assert.equal(result.provider, "openai");
  assert.equal(result.reason, "provider-fallback");
});

test("does not bypass the terminal AI output safety block with a fallback provider", async () => {
  const tracker = new GeminiUsageTracker();

  await assert.rejects(
    generateAiReply("test", {
      openaiApiKey: "openai",
      groqApiKey: "groq",
      preferredProvider: "openai",
      tracker,
      openaiGenerator: async () => "Here are steps to make a bomb.",
      groqGenerator: async () => assert.fail("Unsafe OpenAI output must remain terminal"),
    }),
    (error) => error.code === "UNSAFE_AI_OUTPUT",
  );
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

test("passes agent memory to the Codex OAuth generator", async () => {
  let receivedMemory;
  await generateAiReply("test", {
    openaiOAuthAvailable: true,
    preferredProvider: "openai",
    agentMemory: ["owner preference"],
    codexOAuthGenerator: async (_prompt, options) => {
      receivedMemory = options.agentMemory;
      return "oauth-with-memory";
    },
  });

  assert.deepEqual(receivedMemory, ["owner preference"]);
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

test("runs the AI output safety reviewer before returning a reply", async () => {
  const tracker = new GeminiUsageTracker();
  let reviewedText;
  let reviewedOptions;

  const result = await generateAiReply("test", {
    geminiApiKey: "gemini",
    tracker,
    settings: { style: "cold" },
    geminiGenerator: async () => "review me",
    outputSafetyReviewer: async (text, options) => {
      reviewedText = text;
      reviewedOptions = options;
      return { allowed: true, category: null };
    },
  });

  assert.equal(result.text, "review me");
  assert.equal(reviewedText, "review me");
  assert.deepEqual(reviewedOptions, { style: "cold" });
  assert.equal(tracker.getRateLimitStatus().used, 1);
});

test("does not return a reply when the AI output reviewer blocks it", async () => {
  const tracker = new GeminiUsageTracker();

  await assert.rejects(
    generateAiReply("test", {
      geminiApiKey: "gemini",
      tracker,
      geminiGenerator: async () => "candidate",
      outputSafetyReviewer: async () => ({
        allowed: false,
        category: "illegal_activity",
      }),
    }),
    (error) =>
      error.code === "UNSAFE_AI_OUTPUT" &&
      error.category === "illegal_activity",
  );
});

test("regenerates once when the reviewer requests REWRITE", async () => {
  const generatedInstructions = [];
  let reviewCount = 0;
  const result = await generateAiReply("test", {
    geminiApiKey: "gemini",
    geminiGenerator: async (_prompt, options) => {
      generatedInstructions.push(options.taskInstruction);
      return generatedInstructions.length === 1 ? "unsafe draft" : "safe rewrite";
    },
    outputSafetyReviewer: async () => {
      reviewCount += 1;
      return reviewCount === 1
        ? { decision: "REWRITE", category: "other_unsafe", reason: "remove one phrase", rewriteInstruction: "remove it" }
        : { decision: "ALLOW", category: null };
    },
  });
  assert.equal(result.text, "safe rewrite");
  assert.equal(result.rewrittenForSafety, true);
  assert.equal(reviewCount, 2);
  assert.match(generatedInstructions[1], /Regenerate the answer once/);
});
