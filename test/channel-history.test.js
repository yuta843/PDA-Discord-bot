import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CHANNEL_HISTORY_LIMIT,
  buildChannelMessageHistory,
  buildCurrentMessageContext,
  buildDiscordMessageContext,
  fetchChannelMessageHistory,
  fetchReplyTargetMessage,
  fetchUserMessageHistory,
} from "../src/channel-history.js";
import { CODEX_AGENT_CHANNEL_HISTORY_LIMIT } from "../src/codex-agent.js";

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

test("pages past Discord's 100-message fetch size for channel history", async () => {
  const calls = [];
  const history = await fetchChannelMessageHistory(
    {
      id: "current",
      channel: {
        messages: {
          fetch: async (options) => {
            calls.push(options);
            return Array.from({ length: options.limit }, (_, index) => createMessage({
              id: `${calls.length}-${index}`,
              author: `user-${calls.length}`,
              content: `message-${calls.length}-${index}`,
              timestamp: calls.length * 1_000 + index,
            }));
          },
        },
      },
    },
    { limit: CODEX_AGENT_CHANNEL_HISTORY_LIMIT },
  );

  assert.equal(history.length, CODEX_AGENT_CHANNEL_HISTORY_LIMIT);
  assert.deepEqual(calls.map(({ limit }) => limit), [100, 100, 100]);
  assert.equal(calls[0].before, "current");
  assert.notEqual(calls[1].before, "current");
});

test("filters paged channel history down to the requested user's messages", async () => {
  const targetUserId = "target-user";
  let page = 0;
  const history = await fetchUserMessageHistory(
    {
      id: "current",
      author: { id: targetUserId },
      channelId: "channel-1",
      channel: {
        name: "general",
        messages: {
          fetch: async () => {
            page += 1;
            return Array.from({ length: 100 }, (_, index) => createMessage({
              id: `${page}-${index}`,
              author: index === 0 ? targetUserId : `other-${page}-${index}`,
              content: index === 0 ? `target-${page}` : `other-${page}-${index}`,
              timestamp: page * 1_000 + index,
            }));
          },
        },
      },
    },
    { userId: targetUserId, limit: 2, maxPages: 5 },
  );

  assert.equal(history.length, 2);
  assert.match(history[0].content, /target-1/);
  assert.match(history[1].content, /target-2/);
  assert.equal(page, 2);
});

test("identifies the current speaker, reply target, and direct mentions", () => {
  const message = createMessage({ id: "current", author: "alice", content: "返事して" });
  message.channelId = "channel-1";
  message.mentions = {
    users: new Map([
      ["bot", { id: "bot", username: "miq", bot: true }],
    ]),
  };
  const context = buildDiscordMessageContext(message, {
    botUserId: "bot",
    replyTarget: createMessage({
      id: "target",
      author: "bob",
      content: "この件どう思う？",
      timestamp: 90,
    }),
  });

  assert.equal(context.author.id, "alice");
  assert.equal(context.addressedToBot, true);
  assert.equal(context.addressedToAnotherUser, true);
  assert.deepEqual(context.addressedTo[0], {
    id: "bob",
    name: "Global bob",
    reason: "reply-target",
  });
  assert.equal(context.replyTo.messageId, "target");
  assert.match(buildCurrentMessageContext(message, {
    botUserId: "bot",
    replyTarget: context.replyTo,
  }).content, /CURRENT DISCORD MESSAGE CONTEXT/);
});

test("loads a Discord reply target only when a message reference exists", async () => {
  let fetchedId = null;
  const target = createMessage({ id: "target", author: "bob", content: "target" });
  const withReference = {
    id: "current",
    reference: { messageId: "target" },
    channel: {
      messages: {
        fetch: async (id) => {
          fetchedId = id;
          return target;
        },
      },
    },
  };

  assert.equal(await fetchReplyTargetMessage({ id: "plain" }), null);
  assert.equal(await fetchReplyTargetMessage(withReference), target);
  assert.equal(fetchedId, "target");
});

test("can include reply relations in channel history without changing the legacy shape by default", () => {
  const message = createMessage({ id: "2", author: "alice", content: "follow-up", timestamp: 2 });
  message.reference = { messageId: "1", channelId: "channel-1" };
  const structured = buildChannelMessageHistory([message], { includeContext: true });

  assert.match(structured[0].content, /DISCORD MESSAGE RELATION CONTEXT/);
  assert.match(structured[0].content, /"messageId":"1"/);
  assert.match(structured[0].content, /follow-up/);
});
