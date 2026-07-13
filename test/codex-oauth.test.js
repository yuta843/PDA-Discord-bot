import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import {
  buildCodexPrompt,
  DEFAULT_CODEX_MODEL,
  DEFAULT_CODEX_REASONING_EFFORT,
  generateCodexOAuthShortReply,
  isCodexOAuthAvailable,
} from "../src/codex-oauth.js";

test("defaults to GPT-5.6 Luna with low reasoning", () => {
  assert.equal(DEFAULT_CODEX_MODEL, "gpt-5.6-luna");
  assert.equal(DEFAULT_CODEX_REASONING_EFFORT, "low");
});

test("detects a ChatGPT Codex login without exposing credentials", () => {
  assert.equal(
    isCodexOAuthAvailable({
      spawnSyncImpl: () => ({ status: 0, stdout: "", stderr: "Logged in using ChatGPT\n" }),
    }),
    true,
  );
  assert.equal(
    isCodexOAuthAvailable({
      spawnSyncImpl: () => ({ status: 0, stdout: "Not logged in\n", stderr: "" }),
    }),
    false,
  );
});

test("allows only web search in the Codex prompt", () => {
  const prompt = buildCodexPrompt("hello", {
    history: [{ user: "previous", assistant: "answer" }],
  });
  assert.match(prompt, /only tool you may use is web search/i);
  assert.match(prompt, /api\.fxtwitter\.com/);
  assert.match(prompt, /Never inspect files, run commands/i);
  assert.match(prompt, /untrusted/i);
  assert.match(prompt, /hello/);
});

test("returns only the Codex final message", async () => {
  const reply = await generateCodexOAuthShortReply("hello", {
    runCodexImpl: async (_prompt, { outputPath }) => {
      writeFileSync(outputPath, "OAuth reply", "utf8");
    },
  });
  assert.equal(reply, "OAuth reply");
});

test("downloads only an image and passes its temporary path to Codex", async () => {
  let receivedImagePaths;
  const reply = await generateCodexOAuthShortReply("describe", {
    imageAssets: [{ url: "https://cdn.discordapp.com/attachments/1/2/test.png", name: "test.png" }],
    fetchImpl: async () => ({
      ok: true,
      headers: { get: () => "image/png" },
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }),
    runCodexImpl: async (_prompt, { outputPath, imagePaths }) => {
      receivedImagePaths = imagePaths;
      writeFileSync(outputPath, "image reply", "utf8");
    },
  });
  assert.equal(receivedImagePaths.length, 1);
  assert.match(receivedImagePaths[0], /image-1\.png$/);
  assert.equal(reply, "image reply");
});
