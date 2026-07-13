import test from "node:test";
import assert from "node:assert/strict";
import {
  extractOpenAiText,
  generateOpenAiShortReply,
  isOpenAiLimitError,
} from "../src/openai.js";

test("calls the OpenAI Responses API and returns output text", async () => {
  const fetchImpl = async (url, options) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(options.headers.Authorization, "Bearer openai-key");
    const body = JSON.parse(options.body);
    assert.equal(body.model, "gpt-4o-mini");
    assert.equal("reasoning" in body, false);
    assert.equal(body.max_output_tokens, 512);
    return {
      ok: true,
      json: async () => ({
        status: "completed",
        output: [{ content: [{ type: "output_text", text: "OpenAI response" }] }],
      }),
    };
  };

  assert.equal(
    await generateOpenAiShortReply("test", { apiKey: "openai-key", fetchImpl }),
    "OpenAI response",
  );
});

test("extracts the top-level Responses SDK output text", () => {
  assert.equal(extractOpenAiText({ output_text: "top-level" }), "top-level");
});

test("identifies OpenAI rate limit errors", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 429,
    json: async () => ({ error: { code: "rate_limit_exceeded", message: "limited" } }),
  });
  await assert.rejects(
    generateOpenAiShortReply("test", { apiKey: "openai-key", fetchImpl }),
    (error) => isOpenAiLimitError(error),
  );
});
