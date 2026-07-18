import test from "node:test";
import assert from "node:assert/strict";
import { canReceiveAiMentionFrom } from "../src/ai-mention-access.js";

test("accepts AI mentions from bot 1526014470806048839", () => {
  assert.equal(
    canReceiveAiMentionFrom({ id: "1526014470806048839", bot: true }),
    true,
  );
});

test("rejects unregistered bots while accepting people", () => {
  assert.equal(canReceiveAiMentionFrom({ id: "unknown-bot", bot: true }), false);
  assert.equal(canReceiveAiMentionFrom({ id: "person", bot: false }), true);
});
