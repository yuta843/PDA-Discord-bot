const DISCORD_USER_ID_PATTERN = /^\d{17,20}$/;
const DEFAULT_USER_HISTORY_CHANNEL_LIMIT = 12;
const DEFAULT_USER_HISTORY_MESSAGES_PER_CHANNEL = 50;
const DEFAULT_USER_HISTORY_RESULT_LIMIT = 30;
const HISTORY_EMPTY_REPLY_PATTERN = /(?:該当(?:する)?メッセージはありません|no matching messages|no relevant messages|no messages found|cannot access Discord history|can't access Discord history|Discord履歴(?:には)?アクセスできない|Discord履歴(?:は|を)?取得できない)/iu;
const USER_HISTORY_REQUEST_PATTERN = /(?:履歴|過去|傾向|まとめ|要約|発言|history|past|messages?|profile|summari[sz]e|patterns?)/iu;

function parseDiscordUserId(value) {
  const normalized = String(value ?? "").trim();
  return DISCORD_USER_ID_PATTERN.test(normalized) ? normalized : null;
}

function canRequestUserHistory(userId) {
  return Boolean(parseDiscordUserId(userId));
}

function isHistoryEmptyReply(value) {
  return typeof value === "string" && HISTORY_EMPTY_REPLY_PATTERN.test(value);
}

function extractDiscordUserIds(value) {
  const text = String(value ?? "");
  const ids = [
    ...text.matchAll(/<@!?(\d{17,20})>/gu),
    ...text.matchAll(/(?<!\d)(\d{17,20})(?!\d)/gu),
  ].map((match) => match[1]);
  return [...new Set(ids)];
}

function parseUserHistoryRequest(prompt, { requesterId = null } = {}) {
  if (!canRequestUserHistory(requesterId)) return null;
  const text = String(prompt ?? "").trim();
  if (!text || !USER_HISTORY_REQUEST_PATTERN.test(text)) return null;
  const targetUserId = extractDiscordUserIds(text)[0] ?? null;
  if (!targetUserId) return null;
  return { targetUserId, prompt: text };
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
  return [content, attachmentNames ? `[attachments: ${attachmentNames}]` : ""]
    .filter(Boolean)
    .join("\n");
}

function getMessageTimestamp(message) {
  if (Number.isFinite(message?.createdTimestamp)) return message.createdTimestamp;
  const id = typeof message?.id === "string" && /^\d+$/.test(message.id)
    ? Number(message.id)
    : 0;
  return id;
}

function buildUserHistory(messages, {
  targetUserId,
  channelId = "unknown-channel",
  channelName = channelId,
  limit = DEFAULT_USER_HISTORY_RESULT_LIMIT,
} = {}) {
  const parsedTargetUserId = parseDiscordUserId(targetUserId);
  if (!parsedTargetUserId) return [];
  const maxResults = Number.isInteger(limit) && limit > 0
    ? Math.min(limit, DEFAULT_USER_HISTORY_RESULT_LIMIT)
    : DEFAULT_USER_HISTORY_RESULT_LIMIT;
  const values = messages?.values ? [...messages.values()] : Array.isArray(messages) ? messages : [];

  return values
    .filter((message) => message?.author?.id === parsedTargetUserId && getMessageContent(message))
    .sort((left, right) => getMessageTimestamp(left) - getMessageTimestamp(right))
    .slice(-maxResults)
    .map((message) => ({
      role: "user",
      content: `[Discord user history in #${channelName || channelId}]\n${getMessageContent(message)}`,
      timestamp: getMessageTimestamp(message),
      channelId,
      messageId: message.id ?? null,
    }));
}

function defaultCanReadHistoryChannel(channel, botMember) {
  if (!botMember || typeof channel?.permissionsFor !== "function") return true;
  const permissions = channel.permissionsFor(botMember);
  return Boolean(permissions?.has?.(["ViewChannel", "ReadMessageHistory"]));
}

async function fetchUserHistoryFromGuild({
  guild,
  targetUserId,
  beforeMessageId = null,
  currentChannelId = null,
  botMember = null,
  canReadChannel = defaultCanReadHistoryChannel,
  maxChannels = DEFAULT_USER_HISTORY_CHANNEL_LIMIT,
  messagesPerChannel = DEFAULT_USER_HISTORY_MESSAGES_PER_CHANNEL,
  resultLimit = DEFAULT_USER_HISTORY_RESULT_LIMIT,
} = {}) {
  const parsedTargetUserId = parseDiscordUserId(targetUserId);
  if (!guild || !parsedTargetUserId) {
    return { history: [], matchedCount: 0, scannedChannels: 0, failedChannels: 0 };
  }

  const channelLimit = Number.isInteger(maxChannels) && maxChannels > 0
    ? Math.min(maxChannels, 50)
    : DEFAULT_USER_HISTORY_CHANNEL_LIMIT;
  const messageLimit = Number.isInteger(messagesPerChannel) && messagesPerChannel > 0
    ? Math.min(messagesPerChannel, 100)
    : DEFAULT_USER_HISTORY_MESSAGES_PER_CHANNEL;
  const channels = guild.channels?.cache
    ? [...guild.channels.cache.values()]
    : Array.isArray(guild.channels)
      ? guild.channels
      : [];
  const readableChannels = channels
    .filter((channel) => channel?.isTextBased?.() && typeof channel?.messages?.fetch === "function")
    .filter((channel) => canReadChannel(channel, botMember))
    .sort((left, right) => {
      if (left.id === currentChannelId) return -1;
      if (right.id === currentChannelId) return 1;
      return String(left.id ?? "").localeCompare(String(right.id ?? ""));
    })
    .slice(0, channelLimit);

  const history = [];
  let failedChannels = 0;
  for (const channel of readableChannels) {
    const options = { limit: messageLimit };
    if (channel.id === currentChannelId && beforeMessageId) options.before = beforeMessageId;
    try {
      const messages = await channel.messages.fetch(options);
      history.push(...buildUserHistory(messages, {
        targetUserId: parsedTargetUserId,
        channelId: channel.id,
        channelName: channel.name ?? channel.id,
        limit: resultLimit,
      }));
    } catch {
      failedChannels += 1;
    }
  }

  const deduplicated = [...new Map(
    history
      .filter((entry) => entry.messageId !== beforeMessageId)
      .sort((left, right) => left.timestamp - right.timestamp)
      .map((entry) => [`${entry.channelId}:${entry.messageId ?? entry.content}`, entry]),
  ).values()]
    .slice(-Math.min(resultLimit, DEFAULT_USER_HISTORY_RESULT_LIMIT));

  return {
    history: deduplicated,
    matchedCount: deduplicated.length,
    scannedChannels: readableChannels.length,
    failedChannels,
  };
}

export {
  DEFAULT_USER_HISTORY_CHANNEL_LIMIT,
  DEFAULT_USER_HISTORY_MESSAGES_PER_CHANNEL,
  DEFAULT_USER_HISTORY_RESULT_LIMIT,
  DISCORD_USER_ID_PATTERN,
  buildUserHistory,
  canRequestUserHistory,
  extractDiscordUserIds,
  fetchUserHistoryFromGuild,
  isHistoryEmptyReply,
  parseDiscordUserId,
  parseUserHistoryRequest,
};
