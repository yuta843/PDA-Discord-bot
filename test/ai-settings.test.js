import test from "node:test";
import assert from "node:assert/strict";
import {
  AiSettingsStore,
  buildAiSystemInstruction,
  getAiLengthConfig,
} from "../src/ai-settings.js";

test("stores AI settings independently by conversation key", () => {
  const store = new AiSettingsStore();

  assert.deepEqual(store.get("a"), {
    length: "short",
    language: "auto",
    style: "casual",
  });
  store.set("a", "length", "long");
  store.set("a", "language", "ja");

  assert.deepEqual(store.get("a"), {
    length: "long",
    language: "ja",
    style: "casual",
  });
  assert.deepEqual(store.get("b"), {
    length: "short",
    language: "auto",
    style: "casual",
  });
});

test("builds a system instruction and generation limits from settings", () => {
  const instruction = buildAiSystemInstruction({
    length: "normal",
    language: "ja",
    style: "polite",
  });

  assert.match(instruction, /Answer in Japanese/);
  assert.match(instruction, /2 or 3 sentences/);
  assert.match(instruction, /polite/);
  assert.deepEqual(getAiLengthConfig({ length: "normal" }), {
    maxReplyLength: 400,
    maxOutputTokens: 256,
    instruction: "Give a concise answer in 2 or 3 sentences, at most 400 characters.",
  });
});

test("supports the cold style with safety boundaries", () => {
  const instruction = buildAiSystemInstruction({ style: "cold" });

  assert.match(instruction, /dry, cynical, lightly sarcastic/);
  assert.match(instruction, /non-abusive/);
});

test("supports the debate style without abusive language", () => {
  const instruction = buildAiSystemInstruction({ style: "debate" });

  assert.match(instruction, /concise, indirect debate style/);
  assert.match(instruction, /Do not insult/);
});

test("supports simple teasing without direct abuse", () => {
  const instruction = buildAiSystemInstruction({ style: "tease" });

  assert.match(instruction, /simple, short, indirect teasing/);
  assert.match(instruction, /non-abusive/);
});
