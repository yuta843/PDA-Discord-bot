import test from "node:test";
import assert from "node:assert/strict";
import {
  buildUserHistory,
  canRequestUserHistory,
  extractDiscordUserIds,
  fetchUserHistoryFromGuild,
  isHistoryEmptyReply,
  parseDiscordUserId,
  parseUserHistoryRequest,
} from "../src/user-history.js";

const targetUserId = "12345678901234567";
const requesterUserId = "23456789012345678";
const otherTargetUserId = "34567890123456789";

test("parses valid user IDs and detects history requests for any valid requester", () => {
  assert.equal(parseDiscordUserId(targetUserId), targetUserId);
  assert.equal(parseDiscordUserId("123"), null);
  assert.deepEqual(extractDiscordUserIds(`<@!${targetUserId}> ${targetUserId}`), [targetUserId]);
  assert.equal(parseUserHistoryRequest("履歴をまとめて", {
    requesterId: requesterUserId,
  }), null);
  assert.deepEqual(
    parseUserHistoryRequest(`${targetUserId}の履歴をまとめて`, {
      requesterId: requesterUserId,
    }),
    { targetUserId, prompt: `${targetUserId}の履歴をまとめて` },
  );
  assert.deepEqual(
    parseUserHistoryRequest(`${otherTargetUserId}の履歴を取得して傾向をまとめて`, {
      requesterId: requesterUserId,
    }),
    {
      targetUserId: otherTargetUserId,
      prompt: `${otherTargetUserId}の履歴を取得して傾向をまとめて`,
    },
  );
  assert.equal(canRequestUserHistory(requesterUserId), true);
  assert.equal(canRequestUserHistory("other"), false);
  assert.equal(parseUserHistoryRequest(`${targetUserId} history`, { requesterId: "other" }), null);
});

test("recognizes false empty-history replies for retry protection", () => {
  assert.equal(isHistoryEmptyReply("該当メッセージはありません。"), true);
  assert.equal(isHistoryEmptyReply("Discord履歴は取得できないよ。"), true);
  assert.equal(isHistoryEmptyReply("6件の発言から傾向をまとめます。"), false);
});

test("builds chronological user-only history with attachment context", () => {
  const history = buildUserHistory([
    { id: "2", createdTimestamp: 2, author: { id: targetUserId }, content: "second" },
    { id: "1", createdTimestamp: 1, author: { id: "other" }, content: "ignore" },
    {
      id: "3",
      createdTimestamp: 3,
      author: { id: targetUserId },
      content: "",
      attachments: new Map([["a", { name: "note.txt" }]]),
    },
  ], { targetUserId, channelId: "channel-1", channelName: "雑談" });

  assert.equal(history.length, 2);
  assert.match(history[0].content, /second/);
  assert.match(history[1].content, /note\.txt/);
  assert.equal(history[0].role, "user");
});

test("scans only readable text channels, continues after failures, and respects bounds", async () => {
  const calls = [];
  const makeChannel = (id, messages, { readable = true, failure = false } = {}) => ({
    id,
    name: id,
    isTextBased: () => true,
    messages: {
      fetch: async (options) => {
        calls.push({ id, options });
        if (failure) throw new Error("forbidden");
        return messages;
      },
    },
    readable,
  });
  const channels = [
    makeChannel("current", [
      { id: "current-message", author: { id: targetUserId }, content: "current request" },
      { id: "old", createdTimestamp: 1, author: { id: targetUserId }, content: "old message" },
    ]),
    makeChannel("private", [{ id: "private-1", author: { id: targetUserId }, content: "private" }], { readable: false }),
    makeChannel("broken", [], { failure: true }),
    makeChannel("other", [{ id: "other-1", author: { id: targetUserId }, content: "other channel" }]),
  ];
  const result = await fetchUserHistoryFromGuild({
    guild: { channels: { cache: new Map(channels.map((channel) => [channel.id, channel])) } },
    targetUserId,
    currentChannelId: "current",
    beforeMessageId: "current-message",
    maxChannels: 3,
    resultLimit: 10,
    canReadChannel: (channel) => channel.readable !== false,
  });

  assert.equal(result.matchedCount, 2);
  assert.match(result.history.map(({ content }) => content).join("\n"), /old message/);
  assert.match(result.history.map(({ content }) => content).join("\n"), /other channel/);
  assert.equal(result.scannedChannels, 3);
  assert.equal(result.failedChannels, 1);
  assert.equal(calls[0].options.before, "current-message");
});
