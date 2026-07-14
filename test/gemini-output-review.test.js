import test from "node:test";
import assert from "node:assert/strict";
import {
  REVIEW_INSTRUCTION,
  extractReviewJson,
  reviewAiOutputWithCodexOAuth,
  reviewAiOutputWithFallbacks,
  reviewAiOutputWithGroq,
  reviewAiOutputWithGemini,
} from "../src/gemini-output-review.js";

test("asks Gemini to return a structured safety decision over untrusted output", async () => {
  const result = await reviewAiOutputWithGemini("A normal answer.", {
    apiKey: "test-key",
    model: "gemini-review",
    fetchImpl: async (url, options) => {
      assert.match(url, /gemini-review:generateContent/);
      assert.equal(options.headers["x-goog-api-key"], "test-key");
      const body = JSON.parse(options.body);
      assert.match(body.systemInstruction.parts[0].text, /strict safety gate/);
      assert.match(body.systemInstruction.parts[0].text, /Return JSON only/);
      assert.match(body.contents[0].parts[0].text, /<untrusted_candidate_output>/);
      assert.match(body.contents[0].parts[0].text, /A normal answer/);
      assert.equal(body.generationConfig.responseMimeType, "application/json");
      return {
        ok: true,
        json: async () => ({
          candidates: [{
            content: { parts: [{ text: '{"safe":true,"category":"none","reason":"ok"}' }] },
          }],
        }),
      };
    },
  });

  assert.deepEqual(result, { allowed: true, category: null, reason: "ok" });
});

test("returns a blocked decision from Gemini", async () => {
  const result = await reviewAiOutputWithGemini("unsafe candidate", {
    apiKey: "test-key",
    model: "gemini-review",
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: '{"safe":false,"category":"self_harm_encouragement","reason":"encourages harm"}',
            }],
          },
        }],
      }),
    }),
  });

  assert.deepEqual(result, {
    allowed: false,
    category: "self_harm_encouragement",
    reason: "encourages harm",
  });
});

test("parses JSON and rejects malformed reviewer output", () => {
  assert.deepEqual(extractReviewJson('{"safe":true}'), { safe: true });
  assert.equal(extractReviewJson("not json"), null);
  assert.match(REVIEW_INSTRUCTION, /self-harm/);
});

test("can review through a generator-backed Groq fallback", async () => {
  let received;
  const result = await reviewAiOutputWithGroq("candidate", {
    apiKey: "groq-key",
    model: "review-model",
    generator: async (prompt, options) => {
      received = { prompt, options };
      return '{"safe":true,"category":"none","reason":"groq ok"}';
    },
  });

  assert.equal(result.allowed, true);
  assert.match(received.prompt, /<untrusted_candidate_output>/);
  assert.match(received.options.taskInstruction, /strict safety gate/);
  assert.deepEqual(received.options.settings, { length: "long", language: "en", style: "casual" });
});

test("falls back after a reviewer API failure and does not fall back after a block", async () => {
  const calls = [];
  const allowed = await reviewAiOutputWithFallbacks("candidate", [
    {
      name: "gemini",
      review: async () => {
        calls.push("gemini");
        throw new Error("quota");
      },
    },
    {
      name: "groq",
      review: async () => {
        calls.push("groq");
        return { allowed: true, category: null };
      },
    },
  ]);
  assert.equal(allowed.allowed, true);
  assert.deepEqual(calls, ["gemini", "groq"]);

  calls.length = 0;
  const blocked = await reviewAiOutputWithFallbacks("candidate", [
    {
      name: "gemini",
      review: async () => {
        calls.push("gemini");
        return { allowed: false, category: "sexual_content" };
      },
    },
    {
      name: "groq",
      review: async () => {
        calls.push("groq");
        return { allowed: true, category: null };
      },
    },
  ]);
  assert.equal(blocked.allowed, false);
  assert.deepEqual(calls, ["gemini"]);
});

test("supports OpenAI OAuth review through the same generator contract", async () => {
  const result = await reviewAiOutputWithCodexOAuth("candidate", {
    model: "oauth-review-model",
    generator: async (_prompt, options) => {
      assert.equal(options.model, "oauth-review-model");
      return '{"safe":true,"category":"none","reason":"oauth ok"}';
    },
  });

  assert.deepEqual(result, { allowed: true, category: null, reason: "oauth ok" });
});
