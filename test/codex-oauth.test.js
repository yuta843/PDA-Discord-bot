import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildCodexPrompt,
  generateCodexOAuthImage,
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

test("enables Codex image generation and returns the generated file", async () => {
  const generatedImagesDirectory = mkdtempSync(join(tmpdir(), "miq-codex-generated-"));
  let options;
  const image = await generateCodexOAuthImage("a blue cat", {
    generatedImagesDirectory,
    runCodexImpl: async (prompt, receivedOptions) => {
      options = receivedOptions;
      assert.match(prompt, /^\$imagegen/m);
      writeFileSync(join(generatedImagesDirectory, "generated.png"), "png-bytes");
      writeFileSync(receivedOptions.outputPath, "generated", "utf8");
    },
  });
  assert.deepEqual(image, Buffer.from("png-bytes"));
  assert.equal(options.enableImageGeneration, true);
  assert.equal(options.allowWebSearch, false);
  assert.deepEqual(options.disableFeatures, ["shell_tool", "browser_use", "browser_use_external", "computer_use"]);
  assert.equal(existsSync(join(generatedImagesDirectory, "generated.png")), false);
});
