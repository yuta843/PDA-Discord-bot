import test from "node:test";
import assert from "node:assert/strict";
import {
  TemporaryConversationMemory,
  rankRelevantConversation,
} from "../src/temporary-conversation-memory.js";

function message({ id, userId, content, bot = false, timestamp = 1 } = {}) {
  return {
    id,
    guildId: "guild-1",
    channelId: "channel-1",
    createdTimestamp: timestamp,
    content,
    author: {
      id: userId,
      username: userId,
      bot,
    },
  };
}

test("keeps a volatile channel buffer and a separate per-user buffer", () => {
  const memory = new TemporaryConversationMemory({
    maxChannelMessages: 10,
    maxUserMessages: 10,
  });

  memory.recordMessage(message({ id: "a1", userId: "alice", content: "alice one" }));
  memory.recordMessage(message({ id: "b1", userId: "bob", content: "bob one" }));
  memory.recordMessage(message({ id: "a2", userId: "alice", content: "alice two" }));
  memory.recordAssistantReply(message({ userId: "alice" }), "bot answer");
  memory.recordMessage(message({ id: "bot", userId: "bot", content: "ignore", bot: true }));

  const key = TemporaryConversationMemory.key({ guildId: "guild-1", channelId: "channel-1" });
  assert.equal(memory.getChannelHistory(key).length, 4);
  assert.equal(memory.getUserHistory(key, "alice").length, 2);
  assert.equal(memory.getUserHistory(key, "bob").length, 1);
  assert.match(memory.getUserHistory(key, "alice")[0].content, /alice one/);
  assert.doesNotMatch(memory.getUserHistory(key, "alice")[0].content, /bob one/);
});

test("labels volatile assistant replies with the user and message they answer", () => {
  const memory = new TemporaryConversationMemory();
  const key = TemporaryConversationMemory.key({ guildId: "guild-1", channelId: "channel-1" });
  memory.recordAssistantReply(message({ id: "user-message", userId: "alice", content: "question" }), "answer");

  const reply = memory.getChannelHistory(key)[0];
  assert.match(reply.content, /reply-to alice \(alice\) message user-message/);
  assert.match(reply.content, /answer/);
});

test("bounds temporary memory and expires it without persistence", () => {
  let now = 1_000;
  const memory = new TemporaryConversationMemory({
    maxChannelMessages: 2,
    maxUserMessages: 1,
    ttlMs: 100,
    now: () => now,
  });
  const key = TemporaryConversationMemory.key({ guildId: "guild-1", channelId: "channel-1" });

  memory.recordMessage(message({ id: "1", userId: "alice", content: "one" }));
  now += 1;
  memory.recordMessage(message({ id: "2", userId: "alice", content: "two" }));
  now += 1;
  memory.recordMessage(message({ id: "3", userId: "alice", content: "three" }));

  assert.equal(memory.getChannelHistory(key).length, 2);
  assert.equal(memory.getUserHistory(key, "alice").length, 1);
  assert.match(memory.getChannelHistory(key)[0].content, /two/);
  now += 101;
  assert.equal(memory.getChannelHistory(key).length, 0);
  assert.equal(memory.channelCount, 0);
});

test("imports historical channel and user entries once while preserving live messages", () => {
  const memory = new TemporaryConversationMemory();
  const key = TemporaryConversationMemory.key({ guildId: "guild-1", channelId: "channel-1" });

  memory.recordMessage(message({ id: "live", userId: "alice", content: "live" }));
  assert.equal(memory.importChannelHistory(key, [
    { role: "user", content: "old channel" },
  ]), 1);
  assert.equal(memory.importUserHistory(key, "alice", [
    { role: "user", content: "old alice" },
  ]), 1);

  assert.deepEqual(
    memory.getChannelHistory(key).map(({ content }) => content),
    ["old channel", memory.getChannelHistory(key).at(-1).content],
  );
  assert.match(memory.getUserHistory(key, "alice").at(-1).content, /live/);
  assert.equal(memory.hasChannelHistory(key), true);
  assert.equal(memory.hasUserHistory(key, "alice"), true);
});

test("ranks nearby conversation topics above unrelated temporary memory", () => {
  const ranked = rankRelevantConversation("Codex OAuthのモデルについて", [
    { role: "user", content: "[temporary conversation by alice]\n今日は天気がいいね" },
    { role: "user", content: "[temporary conversation by bob]\nCodex OAuthのモデルを確認した" },
    { role: "assistant", content: "[temporary conversation by Codex Agent]\nモデルはLunaだった" },
  ]);

  assert.equal(ranked.length > 0, true);
  assert.match(ranked[0].entry.content, /Codex OAuth/);
  assert.equal(ranked[0].score > ranked.at(-1).score, true);
});

test("provides recent context as a fallback for short follow-up messages", () => {
  const memory = new TemporaryConversationMemory();
  const key = TemporaryConversationMemory.key({ guildId: "guild-1", channelId: "channel-1" });
  memory.recordMessage(message({ id: "old", userId: "alice", content: "Codex OAuthの話をした" }));
  memory.recordMessage(message({ id: "current", userId: "alice", content: "それどうなった？" }));

  const relevant = memory.getRelevantHistory(key, "それどうなった？", {
    userId: "alice",
  });
  assert.equal(relevant.length, 1);
  assert.match(relevant[0].entry.content, /Codex OAuth/);
  assert.equal(relevant[0].score, 0);
});
