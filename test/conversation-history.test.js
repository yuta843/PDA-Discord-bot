import test from "node:test";
import assert from "node:assert/strict";
import { ConversationHistory } from "../src/conversation-history.js";

test("keeps only the latest five conversation turns", () => {
  const history = new ConversationHistory();

  for (let index = 1; index <= 6; index += 1) {
    history.add("conversation", `質問${index}`, `回答${index}`);
  }

  assert.deepEqual(history.get("conversation"), [
    { role: "user", content: "質問2" },
    { role: "assistant", content: "回答2" },
    { role: "user", content: "質問3" },
    { role: "assistant", content: "回答3" },
    { role: "user", content: "質問4" },
    { role: "assistant", content: "回答4" },
    { role: "user", content: "質問5" },
    { role: "assistant", content: "回答5" },
    { role: "user", content: "質問6" },
    { role: "assistant", content: "回答6" },
  ]);
});

test("keeps histories isolated by conversation key", () => {
  const history = new ConversationHistory();
  history.add("user-a", "質問A", "回答A");

  assert.deepEqual(history.get("user-b"), []);
  assert.deepEqual(history.get("user-a"), [
    { role: "user", content: "質問A" },
    { role: "assistant", content: "回答A" },
  ]);
});

test("clears one conversation without affecting another", () => {
  const history = new ConversationHistory();
  history.add("conversation-a", "質問A", "回答A");
  history.add("conversation-b", "質問B", "回答B");

  history.clear("conversation-a");

  assert.deepEqual(history.get("conversation-a"), []);
  assert.equal(history.get("conversation-b").length, 2);
});
