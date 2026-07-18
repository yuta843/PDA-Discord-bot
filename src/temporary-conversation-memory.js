const DEFAULT_MAX_CHANNEL_MESSAGES = 500;
const DEFAULT_MAX_USER_MESSAGES = 200;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_RELEVANT_MEMORY_LIMIT = 5;
const MAX_TEMPORARY_MESSAGE_LENGTH = 4_000;
const RELEVANCE_STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "i", "in", "is",
  "it", "me", "my", "of", "on", "or", "that", "the", "this", "to", "we", "with", "you",
  "これ", "それ", "あれ", "ここ", "そこ", "こと", "もの", "ため", "よう", "です", "ます", "した", "して",
]);

function normalizeKey(value) {
  const key = String(value ?? "").trim();
  return key || null;
}

function normalizeText(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, MAX_TEMPORARY_MESSAGE_LENGTH);
}

function getMessageText(message) {
  const content = normalizeText(
    typeof message?.cleanContent === "string" ? message.cleanContent : message?.content,
  );
  const attachmentNames = message?.attachments?.values
    ? [...message.attachments.values()]
      .map((attachment) => attachment?.name || "unnamed-file")
      .join(", ")
    : "";
  return [content, attachmentNames ? `[attachments: ${attachmentNames}]` : ""]
    .filter(Boolean)
    .join("\n");
}

function getAuthorName(message) {
  return (
    message?.member?.displayName ||
    message?.author?.globalName ||
    message?.author?.username ||
    message?.author?.id ||
    "unknown-user"
  );
}

function getTimestamp(message) {
  return Number.isFinite(message?.createdTimestamp)
    ? message.createdTimestamp
    : Date.now();
}

function formatEntryContent(content, {
  source,
  authorName,
  authorId,
  replyTo,
} = {}) {
  const text = normalizeText(content);
  if (!text) return "";
  const label = source || "temporary conversation";
  const author = authorName || authorId || "unknown-user";
  const replyTarget = replyTo?.id
    ? `; reply-to ${replyTo.name || replyTo.id} (${replyTo.id})${replyTo.messageId ? ` message ${replyTo.messageId}` : ""}`
    : "";
  return `[${label} by ${author}${authorId ? ` (${authorId})` : ""}${replyTarget}]\n${text}`;
}

function asHistoryEntry(entry) {
  if (!entry || typeof entry.content !== "string" || !entry.content.trim()) return null;
  return {
    role: entry.role === "assistant" ? "assistant" : "user",
    content: entry.content,
  };
}

function stripTemporaryEntryLabel(content) {
  if (typeof content !== "string") return "";
  const normalized = content.normalize("NFKC");
  const newlineIndex = normalized.indexOf("\n");
  return normalizeText(newlineIndex >= 0 ? normalized.slice(newlineIndex + 1) : normalized);
}

function tokenizeRelevanceText(value) {
  const normalized = normalizeText(value).toLocaleLowerCase("ja-JP");
  const tokens = new Set();
  for (const match of normalized.matchAll(/[a-z0-9]+(?:[._-][a-z0-9]+)*/giu)) {
    if (!RELEVANCE_STOPWORDS.has(match[0])) tokens.add(match[0]);
  }
  for (const match of normalized.matchAll(/[\u3040-\u30ff\u3400-\u9fff]+/gu)) {
    const segment = match[0];
    if (segment.length <= 4 && !RELEVANCE_STOPWORDS.has(segment)) tokens.add(segment);
    for (let index = 0; index < segment.length - 1; index += 1) {
      const token = segment.slice(index, index + 2);
      if (!RELEVANCE_STOPWORDS.has(token)) tokens.add(token);
    }
    if (segment.length >= 3) {
      for (let index = 0; index < segment.length - 2; index += 1) {
        tokens.add(segment.slice(index, index + 3));
      }
    }
  }
  return tokens;
}

function rankRelevantConversation(query, entries, { limit = DEFAULT_RELEVANT_MEMORY_LIMIT, excludeLast = false } = {}) {
  const normalizedQuery = normalizeText(
    typeof query === "string" ? query.normalize("NFKC") : query,
  );
  const queryTokens = tokenizeRelevanceText(query);
  if (!queryTokens.size || !Array.isArray(entries)) return [];
  const maxResults = Number.isInteger(limit) && limit > 0
    ? Math.min(limit, 20)
    : DEFAULT_RELEVANT_MEMORY_LIMIT;

  return entries
    .map((entry, index) => {
      if (!entry || typeof entry.content !== "string") return null;
      if (excludeLast && index === entries.length - 1) return null;
      const candidateText = stripTemporaryEntryLabel(entry.content);
      if (candidateText === normalizedQuery) return null;
      const candidateTokens = tokenizeRelevanceText(candidateText);
      if (!candidateTokens.size) return null;
      const sharedTokens = [...queryTokens].filter((token) => candidateTokens.has(token));
      if (!sharedTokens.length) return null;

      const queryCoverage = sharedTokens.length / queryTokens.size;
      const cosineLikeCoverage = sharedTokens.length / Math.sqrt(queryTokens.size * candidateTokens.size);
      const recency = 1 / (1 + Math.max(0, entries.length - 1 - index));
      const score = Number((queryCoverage * 0.65 + cosineLikeCoverage * 0.30 + recency * 0.05).toFixed(4));
      return {
        entry,
        score,
        sharedTokens,
        index,
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score || right.index - left.index)
    .slice(0, maxResults);
}

class TemporaryConversationMemory {
  constructor({
    maxChannelMessages = DEFAULT_MAX_CHANNEL_MESSAGES,
    maxUserMessages = DEFAULT_MAX_USER_MESSAGES,
    ttlMs = DEFAULT_TTL_MS,
    now = () => Date.now(),
  } = {}) {
    this.maxChannelMessages = Number.isInteger(maxChannelMessages) && maxChannelMessages > 0
      ? maxChannelMessages
      : DEFAULT_MAX_CHANNEL_MESSAGES;
    this.maxUserMessages = Number.isInteger(maxUserMessages) && maxUserMessages > 0
      ? maxUserMessages
      : DEFAULT_MAX_USER_MESSAGES;
    this.ttlMs = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : DEFAULT_TTL_MS;
    this.now = now;
    this.channels = new Map();
    this.users = new Map();
    this.hydratedChannels = new Set();
    this.hydratedUsers = new Set();
  }

  static key({ guildId, channelId }) {
    const normalizedChannelId = normalizeKey(channelId);
    if (!normalizedChannelId) return null;
    return `${normalizeKey(guildId) || "dm"}:${normalizedChannelId}`;
  }

  #prune() {
    const cutoff = this.now() - this.ttlMs;
    for (const [key, bucket] of this.channels) {
      if (bucket.updatedAt < cutoff) {
        this.channels.delete(key);
        this.hydratedChannels.delete(key);
      }
    }
    for (const [key, bucket] of this.users) {
      if (bucket.updatedAt < cutoff) {
        this.users.delete(key);
        this.hydratedUsers.delete(key);
      }
    }
  }

  #appendChannel(key, entry) {
    const bucket = this.channels.get(key) || { entries: [], updatedAt: this.now() };
    bucket.entries.push(entry);
    bucket.entries = bucket.entries.slice(-this.maxChannelMessages);
    bucket.updatedAt = this.now();
    this.channels.set(key, bucket);
  }

  #appendUser(key, userId, entry) {
    const normalizedUserId = normalizeKey(userId);
    if (!normalizedUserId) return;
    const userKey = `${key}:${normalizedUserId}`;
    const bucket = this.users.get(userKey) || { entries: [], updatedAt: this.now() };
    bucket.entries.push(entry);
    bucket.entries = bucket.entries.slice(-this.maxUserMessages);
    bucket.updatedAt = this.now();
    this.users.set(userKey, bucket);
  }

  recordMessage(message) {
    if (!message || message.author?.bot) return false;
    const key = TemporaryConversationMemory.key(message);
    const authorId = normalizeKey(message.author?.id);
    const text = getMessageText(message);
    if (!key || !authorId || !text) return false;

    this.#prune();
    const entry = {
      role: "user",
      content: formatEntryContent(text, {
        source: "temporary conversation",
        authorName: getAuthorName(message),
        authorId,
      }),
      messageId: message.id ?? null,
      timestamp: getTimestamp(message),
    };
    this.#appendChannel(key, entry);
    this.#appendUser(key, authorId, entry);
    return true;
  }

  recordAssistantReply(message, content, { authorName = "Codex Agent", authorId = null } = {}) {
    const key = TemporaryConversationMemory.key(message);
    const text = normalizeText(content);
    if (!key || !text) return false;

    this.#prune();
    this.#appendChannel(key, {
      role: "assistant",
      content: formatEntryContent(text, {
        source: "temporary conversation",
        authorName,
        authorId,
        replyTo: message?.author?.id
          ? {
              id: message.author.id,
              name: getAuthorName(message),
              messageId: message.id ?? null,
            }
          : null,
      }),
      timestamp: this.now(),
    });
    return true;
  }

  importChannelHistory(messageOrKey, entries) {
    const key = typeof messageOrKey === "string"
      ? normalizeKey(messageOrKey)
      : TemporaryConversationMemory.key(messageOrKey);
    if (!key || !Array.isArray(entries)) return 0;

    this.#prune();
    const importedEntries = [];
    for (const entry of entries) {
      const normalized = asHistoryEntry(entry);
      if (!normalized) continue;
      importedEntries.push(normalized);
    }
    const bucket = this.channels.get(key) || { entries: [], updatedAt: this.now() };
    const existing = new Set(bucket.entries.map((entry) => `${entry.role}:${entry.content}`));
    bucket.entries = [
      ...importedEntries.filter((entry) => {
        const entryKey = `${entry.role}:${entry.content}`;
        if (existing.has(entryKey)) return false;
        existing.add(entryKey);
        return true;
      }),
      ...bucket.entries,
    ].slice(-this.maxChannelMessages);
    bucket.updatedAt = this.now();
    this.channels.set(key, bucket);
    this.hydratedChannels.add(key);
    return importedEntries.length;
  }

  importUserHistory(messageOrKey, userId, entries) {
    const key = typeof messageOrKey === "string"
      ? normalizeKey(messageOrKey)
      : TemporaryConversationMemory.key(messageOrKey);
    const normalizedUserId = normalizeKey(userId);
    if (!key || !normalizedUserId || !Array.isArray(entries)) return 0;

    this.#prune();
    const importedEntries = [];
    for (const entry of entries) {
      const normalized = asHistoryEntry(entry);
      if (!normalized) continue;
      importedEntries.push(normalized);
    }
    const userKey = `${key}:${normalizedUserId}`;
    const bucket = this.users.get(userKey) || { entries: [], updatedAt: this.now() };
    const existing = new Set(bucket.entries.map((entry) => `${entry.role}:${entry.content}`));
    bucket.entries = [
      ...importedEntries.filter((entry) => {
        const entryKey = `${entry.role}:${entry.content}`;
        if (existing.has(entryKey)) return false;
        existing.add(entryKey);
        return true;
      }),
      ...bucket.entries,
    ].slice(-this.maxUserMessages);
    bucket.updatedAt = this.now();
    this.users.set(userKey, bucket);
    this.hydratedUsers.add(`${key}:${normalizedUserId}`);
    return importedEntries.length;
  }

  getChannelHistory(messageOrKey, { limit = this.maxChannelMessages } = {}) {
    const key = typeof messageOrKey === "string"
      ? normalizeKey(messageOrKey)
      : TemporaryConversationMemory.key(messageOrKey);
    if (!key) return [];
    this.#prune();
    const bucket = this.channels.get(key);
    const max = Number.isInteger(limit) && limit > 0 ? limit : this.maxChannelMessages;
    return (bucket?.entries || []).slice(-max).map(asHistoryEntry).filter(Boolean);
  }

  getUserHistory(messageOrKey, userId, { limit = this.maxUserMessages } = {}) {
    const key = typeof messageOrKey === "string"
      ? normalizeKey(messageOrKey)
      : TemporaryConversationMemory.key(messageOrKey);
    const normalizedUserId = normalizeKey(userId);
    if (!key || !normalizedUserId) return [];
    this.#prune();
    const bucket = this.users.get(`${key}:${normalizedUserId}`);
    const max = Number.isInteger(limit) && limit > 0 ? limit : this.maxUserMessages;
    return (bucket?.entries || []).slice(-max).map(asHistoryEntry).filter(Boolean);
  }

  getRelevantHistory(
    messageOrKey,
    query,
    { userId = null, limit = DEFAULT_RELEVANT_MEMORY_LIMIT, excludeLatest = true } = {},
  ) {
    const key = typeof messageOrKey === "string"
      ? normalizeKey(messageOrKey)
      : TemporaryConversationMemory.key(messageOrKey);
    if (!key) return [];
    const channelHistory = this.getChannelHistory(key, { limit: this.maxChannelMessages });
    const userHistory = userId
      ? this.getUserHistory(key, userId, { limit: this.maxUserMessages })
      : [];
    const seen = new Set();
    const combinedHistory = [...channelHistory, ...userHistory].filter((entry) => {
      const entryKey = `${entry.role}:${entry.content}`;
      if (seen.has(entryKey)) return false;
      seen.add(entryKey);
      return true;
    });
    const ranked = rankRelevantConversation(query, combinedHistory, {
      limit,
      excludeLast: excludeLatest,
    });
    if (ranked.length > 0 || combinedHistory.length === 0) return ranked;

    const normalizedQuery = normalizeText(
      typeof query === "string" ? query.normalize("NFKC") : query,
    );
    const fallbackEntry = [...combinedHistory]
      .reverse()
      .find((entry) => stripTemporaryEntryLabel(entry.content) !== normalizedQuery);
    return fallbackEntry
      ? [{ entry: fallbackEntry, score: 0, sharedTokens: [], index: -1 }]
      : [];
  }

  hasChannelHistory(key) {
    return this.hydratedChannels.has(normalizeKey(key));
  }

  hasUserHistory(key, userId) {
    return this.hydratedUsers.has(`${normalizeKey(key)}:${normalizeKey(userId)}`);
  }

  clear(messageOrKey) {
    const key = typeof messageOrKey === "string"
      ? normalizeKey(messageOrKey)
      : TemporaryConversationMemory.key(messageOrKey);
    if (!key) return false;
    this.channels.delete(key);
    this.hydratedChannels.delete(key);
    for (const userKey of this.users.keys()) {
      if (userKey.startsWith(`${key}:`)) {
        this.users.delete(userKey);
        this.hydratedUsers.delete(userKey);
      }
    }
    return true;
  }

  get channelCount() {
    this.#prune();
    return this.channels.size;
  }
}

export {
  DEFAULT_MAX_CHANNEL_MESSAGES,
  DEFAULT_MAX_USER_MESSAGES,
  DEFAULT_RELEVANT_MEMORY_LIMIT,
  DEFAULT_TTL_MS,
  MAX_TEMPORARY_MESSAGE_LENGTH,
  TemporaryConversationMemory,
  rankRelevantConversation,
};
