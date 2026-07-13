import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CHANNEL_HISTORY_LIMIT,
  buildChannelMessageHistory,
  fetchChannelMessageHistory,
} from "../src/channel-history.js";

function createMessage({ id, author, content, timestamp, attachmentName } = {}) {
  return {
    id,
    author: {
      id: author,
      username: `user-${author}`,
      globalName: `Global ${author}`,
      bot: author === "bot",
    },
    content,
    createdTimestamp: timestamp,
    attachments: attachmentName
      ? new Map([["attachment", { name: attachmentName }]])
      : new Map(),
  };
}

test("builds channel history in chronological order with author labels", () => {
  const history = buildChannelMessageHistory([
    createMessage({ id: "3", author: "3", content: "third", timestamp: 300 }),
    createMessage({ id: "1", author: "1", content: "first", timestamp: 100 }),
    createMessage({ id: "2", author: "bot", content: "second", timestamp: 200 }),
  ]);

  assert.deepEqual(history, [
    {
      role: "user",
      content: "[channel message by Global 1]\nfirst",
    },
    {
      role: "assistant",
      content: "[channel message by Global bot]\nsecond",
    },
    {
      role: "user",
      content: "[channel message by Global 3]\nthird",
    },
  ]);
});

test("keeps attachment-only messages and caps the number of messages", () => {
  const messages = Array.from({ length: DEFAULT_CHANNEL_HISTORY_LIMIT + 5 }, (_, index) =>
    createMessage({
      id: String(index),
      author: String(index),
      content: "",
      timestamp: index,
      attachmentName: `file-${index}.png`,
    }),
  );

  const history = buildChannelMessageHistory(messages);

  assert.equal(history.length, DEFAULT_CHANNEL_HISTORY_LIMIT);
  assert.match(history[0].content, /file-5\.png/);
  assert.match(history.at(-1).content, /file-34\.png/);
});

test("fetches only messages before the message that triggered the AI", async () => {
  let receivedOptions;
  const history = await fetchChannelMessageHistory(
    {
      id: "current",
      channel: {
        messages: {
          fetch: async (options) => {
            receivedOptions = options;
            return [createMessage({ id: "previous", author: "1", content: "previous" })];
          },
        },
      },
    },
    { limit: 12 },
  );

  assert.deepEqual(receivedOptions, { limit: 12, before: "current" });
  assert.equal(history.length, 1);
});
