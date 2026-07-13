import test from "node:test";
import assert from "node:assert/strict";
import {
  FICTION_LABEL,
  buildAhooNewsPrompt,
  formatAhooNewsReply,
  normalizeAhooTopic,
} from "../src/ahoo-news.js";

test("builds a clearly fictional news prompt", () => {
  const prompt = buildAhooNewsPrompt("空飛ぶ猫の市役所");

  assert.match(prompt, /架空ニュース/);
  assert.match(prompt, /空飛ぶ猫の市役所/);
  assert.match(prompt, /実在する人物、企業、団体、地名/);
  assert.match(prompt, /出典、URL、統計、引用を捏造しない/);
});

test("normalizes and caps the creative topic", () => {
  assert.equal(normalizeAhooTopic("  猫   ニュース  "), "猫 ニュース");
  assert.equal([...normalizeAhooTopic("あ".repeat(200))].length, 120);
});

test("always labels the generated result as fictional", () => {
  assert.equal(formatAhooNewsReply("見出し\n本文").startsWith(FICTION_LABEL), true);
  assert.equal(formatAhooNewsReply(`${FICTION_LABEL}\n見出し`).split(FICTION_LABEL).length, 2);
  assert.match(formatAhooNewsReply(""), /ニュースを生成できませんでした/);
});
