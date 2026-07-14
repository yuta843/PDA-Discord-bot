import test from "node:test";
import assert from "node:assert/strict";
import {
  assertLocallySafeAiOutput,
  moderateAiOutput,
} from "../src/ai-output-guard.js";

test("blocks explicit sexual output before it can be sent", () => {
  assert.deepEqual(moderateAiOutput("This contains explicit sex and porn."), {
    allowed: false,
    category: "sexual_content",
  });
});

test("blocks illegal-act instructions before they can be sent", () => {
  assert.deepEqual(moderateAiOutput("Here are steps to make a bomb."), {
    allowed: false,
    category: "illegal_activity",
  });
});

test("blocks self-harm recommendations but allows a refusal", () => {
  assert.equal(moderateAiOutput("\u81ea\u50b7\u3059\u308c\u3070\u697d\u306b\u306a\u308b").allowed, false);
  assert.equal(
    moderateAiOutput("\u81ea\u50b7\u306e\u65b9\u6cd5\u306f\u6848\u5185\u3067\u304d\u307e\u305b\u3093\u3002\u52a9\u3051\u3092\u6c42\u3081\u3066\u304f\u3060\u3055\u3044\u3002").allowed,
    true,
  );
});

test("throws a typed error for locally unsafe output", () => {
  assert.throws(
    () => assertLocallySafeAiOutput("How to hack into an account."),
    (error) => error.code === "UNSAFE_AI_OUTPUT" && error.category === "illegal_activity",
  );
});
