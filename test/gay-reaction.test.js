import test from "node:test";
import assert from "node:assert/strict";
import {
  applyGayReactions,
  pickRandomFunReaction,
  selectFunniestMessage,
} from "../src/gay-reaction.js";

function message(id, content, overrides = {}) {
  return {
    id,
    content,
    author: { bot: false },
    attachments: new Map(),
    embeds: [],
    ...overrides,
  };
}

test("selects the funniest-looking human post", () => {
  const result = selectFunniestMessage([
    message("plain", "今日は晴れです"),
    message("funny", "それは草ｗｗｗ 😂😂！！"),
    message("bot", "草ｗｗｗｗｗ", { author: { bot: true } }),
  ]);
  assert.equal(result.id, "funny");
});

test("keeps the newest candidate when scores tie", () => {
  assert.equal(selectFunniestMessage([
    message("new", "同点候補です"),
    message("old", "別の候補です"),
  ]).id, "new");
});

test("adds G A Y and one deterministic random reaction", async () => {
  const reactions = [];
  const target = { react: async (reaction) => reactions.push(reaction) };
  const randomReaction = await applyGayReactions(target, { random: () => 0 });
  assert.equal(randomReaction, pickRandomFunReaction(() => 0));
  assert.deepEqual(reactions, ["🇬", "🇦", "🇾", "😂"]);
});
