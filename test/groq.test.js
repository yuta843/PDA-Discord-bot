import test from "node:test";
import assert from "node:assert/strict";
import { generateGroqShortReply, isGroqLimitError } from "../src/groq.js";

test("calls Groq chat completions and returns a short reply", async () => {
  const fetchImpl = async (url, options) => {
    assert.equal(url, "https://api.groq.com/openai/v1/chat/completions");
    assert.equal(options.headers.Authorization, "Bearer groq-key");
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: "Groq応答。" } }] }),
    };
  };

  assert.equal(
    await generateGroqShortReply("テスト", { apiKey: "groq-key", fetchImpl }),
    "Groq応答。",
  );
});

test("sends prior conversation turns to Groq", async () => {
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.deepEqual(body.messages.slice(1), [
      { role: "user", content: "previous question" },
      { role: "assistant", content: "previous answer" },
      { role: "user", content: "current question" },
    ]);
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: "ok" } }] }),
    };
  };

  await generateGroqShortReply("current question", {
    apiKey: "groq-key",
    history: [
      { role: "user", content: "previous question" },
      { role: "assistant", content: "previous answer" },
    ],
    fetchImpl,
  });
});

test("identifies Groq rate limit errors", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 429,
    json: async () => ({ error: { code: "rate_limit_exceeded", message: "limited" } }),
  });

  await assert.rejects(
    generateGroqShortReply("テスト", { apiKey: "groq-key", fetchImpl }),
    (error) => isGroqLimitError(error),
  );
});
