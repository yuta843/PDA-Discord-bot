const DEFAULT_CHANNEL_HISTORY_LIMIT = 30;

function getMessageAuthorName(message) {
  return (
    message?.member?.displayName ||
    message?.author?.globalName ||
    message?.author?.username ||
    message?.author?.id ||
    "unknown-user"
  );
}

function getMessageContent(message) {
  const content = typeof message?.cleanContent === "string"
    ? message.cleanContent.trim()
    : typeof message?.content === "string"
      ? message.content.trim()
      : "";
  const attachmentNames = message?.attachments?.values
    ? [...message.attachments.values()]
        .map((attachment) => attachment?.name || "unnamed-file")
        .join(", ")
    : "";

  return [
    content,
    attachmentNames ? `[attachments: ${attachmentNames}]` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function toTimestamp(message) {
  if (Number.isFinite(message?.createdTimestamp)) return message.createdTimestamp;
  const id = typeof message?.id === "string" ? message.id : "";
  return id && /^\d+$/.test(id) ? Number(id) : 0;
}

function buildChannelMessageHistory(messages, { limit = DEFAULT_CHANNEL_HISTORY_LIMIT } = {}) {
  const maxMessages = Number.isInteger(limit) && limit > 0
    ? limit
    : DEFAULT_CHANNEL_HISTORY_LIMIT;
  const values = messages?.values
    ? [...messages.values()]
    : Array.isArray(messages)
      ? messages
      : [];

  return values
    .filter((message) => getMessageContent(message))
    .sort((left, right) => toTimestamp(left) - toTimestamp(right))
    .slice(-maxMessages)
    .map((message) => ({
      role: message.author?.bot ? "assistant" : "user",
      content: `[channel message by ${getMessageAuthorName(message)}]\n${getMessageContent(message)}`,
    }));
}

async function fetchChannelMessageHistory(
  message,
  { limit = DEFAULT_CHANNEL_HISTORY_LIMIT } = {},
) {
  if (typeof message?.channel?.messages?.fetch !== "function") return [];

  const options = { limit };
  if (message.id) options.before = message.id;
  const messages = await message.channel.messages.fetch(options);
  return buildChannelMessageHistory(messages, { limit });
}

export {
  DEFAULT_CHANNEL_HISTORY_LIMIT,
  buildChannelMessageHistory,
  fetchChannelMessageHistory,
};
