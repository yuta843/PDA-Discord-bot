import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  Partials,
  PermissionFlagsBits,
} from "discord.js";
import {
  extractChannelId,
  normalizeChannelQuery,
  parseTargetCommand,
  slashCommands,
} from "./commands.js";
import {
  DEFAULT_GEMINI_MODEL,
  extractAiPrompt,
  isGeminiLimitError,
  isGeminiSafetyError,
  isGeminiUnavailableError,
  moderatePrompt,
} from "./gemini.js";
import { GeminiUsageTracker, generateAiReply } from "./ai-router.js";
import { DEFAULT_GROQ_MODEL, isGroqLimitError } from "./groq.js";
import {
  DEFAULT_OPENAI_MODEL,
  isOpenAiLimitError,
  isOpenAiUnavailableError,
} from "./openai.js";
import { DEFAULT_CODEX_MODEL, isCodexOAuthAvailable } from "./codex-oauth.js";
import { ImageAccessLimiter } from "./image-access.js";
import { enrichPromptWithTweets } from "./tweet-context.js";
import { enrichPromptWithWebPages } from "./web-fetch.js";
import {
  AiBattleStore,
  BATTLE_START_USER_ID,
  BATTLE_TARGET_BOT_ID,
  buildBattlePrompt,
} from "./ai-battle.js";
import {
  AI_MODEL_LABELS,
  canSelectModel,
  loadSelectedProvider,
  saveSelectedProvider,
} from "./model-selection.js";
import { buildServerInviteUrl } from "./invite.js";
import { getImageAssets, isQuoteBotAuthor, shouldRelay } from "./relay.js";
import { launchWindowsSleepHelper, scheduleSystemSleep } from "./system-sleep.js";
import { ConversationHistory } from "./conversation-history.js";
import {
  DEFAULT_CHANNEL_HISTORY_LIMIT,
  fetchChannelMessageHistory,
} from "./channel-history.js";
import { AI_SETTING_LABELS, AiSettingsStore } from "./ai-settings.js";
import {
  canChangeAiSettings,
  parseAiSettingsAllowedUserIds,
} from "./ai-settings-access.js";
import { AnkSessionStore, parseAnkCommand } from "./ank.js";
import { formatGachaResult, parseGachaCommand, rollGacha } from "./gacha.js";
import { buildHelpMessage } from "./help.js";
import { buildAhooNewsPrompt, formatAhooNewsReply } from "./ahoo-news.js";
import { parsePersonaSwitchCommand } from "./personas.js";
import {
  cleanKimazuMessageText,
  createKimazuImage,
  downloadImage,
  isKimazuMentionCommand,
} from "./kimazu.js";
import { AHOO_NEWS_TASK_INSTRUCTION, SUMMARY_TASK_INSTRUCTION } from "./ai-task-instructions.js";
import { CommunityStore } from "./community-store.js";
import {
  castPollVote,
  closePoll,
  createPoll,
  formatPollContent,
  isPollExpired,
} from "./poll.js";
import {
  MAX_ACTIVE_REMINDERS_PER_USER,
  createReminder,
  parseReminderMinutes,
  sortReminders,
} from "./reminders.js";
import {
  buildSummaryPrompt,
  DEFAULT_SUMMARY_COUNT,
  parseSummaryCount,
} from "./summary.js";

const DEFAULT_QUOTE_BOT_ID = "949479338275913799";
const QWEN_GROQ_MODEL = "qwen/qwen3.6-27b";

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required. Check your .env file.`);
  return value;
}

function parseIdList(value) {
  return (value ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

const token = requiredEnv("DISCORD_TOKEN");
const defaultTargetChannelId = requiredEnv("TARGET_CHANNEL_ID");
const quoteBotId = process.env.QUOTE_BOT_ID?.trim() || DEFAULT_QUOTE_BOT_ID;
const quoteBotName = process.env.QUOTE_BOT_NAME?.trim() || "Make it a Quote";
const sourceChannelIds = parseIdList(process.env.SOURCE_CHANNEL_IDS);
const debugBotMessages = process.env.DEBUG_BOT_MESSAGES === "1";
const geminiApiKey = process.env.GEMINI_API_KEY?.trim();
const geminiModel = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
const groqApiKey = process.env.GROQ_API_KEY?.trim();
const groqModel = process.env.GROQ_MODEL?.trim() || DEFAULT_GROQ_MODEL;
const openaiApiKey = process.env.OPENAI_API_KEY?.trim();
const codexOAuthAvailable = isCodexOAuthAvailable();
const openaiModel = codexOAuthAvailable
  ? process.env.CODEX_MODEL?.trim() || DEFAULT_CODEX_MODEL
  : process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
const configuredAiProvider = ["gemini", "groq", "openai"].includes(
  process.env.AI_PROVIDER?.trim().toLowerCase(),
)
  ? process.env.AI_PROVIDER.trim().toLowerCase()
  : "gemini";
const aiSettingsAllowedUserIds = parseAiSettingsAllowedUserIds(
  process.env.AI_SETTINGS_ALLOWED_USER_IDS,
);
const geminiSoftRpm = Number.parseInt(process.env.GEMINI_SOFT_RPM ?? "8", 10);
const geminiSoftTpm = Number.parseInt(process.env.GEMINI_SOFT_TPM ?? "", 10);
const geminiDailyRequestLimit = Number.parseInt(
  process.env.GEMINI_DAILY_REQUEST_LIMIT ?? "",
  10,
);
const geminiDailyTokenLimit = Number.parseInt(process.env.GEMINI_DAILY_TOKEN_LIMIT ?? "", 10);
const geminiFallbackMinutes = Number.parseInt(
  process.env.GEMINI_FALLBACK_MINUTES ?? "15",
  10,
);
const systemSleepEnabled = process.env.SYSTEM_SLEEP_ENABLED === "true";
const systemSleepTime = process.env.SYSTEM_SLEEP_TIME?.trim() || "01:00";
const targetOverridesPath = new URL("../target-overrides.json", import.meta.url);
const communityDataPath = fileURLToPath(new URL("../community-data.json", import.meta.url));
const modelSelectionPath = fileURLToPath(new URL("../ai-model-selection.json", import.meta.url));
let activeAiProvider = loadSelectedProvider(modelSelectionPath, configuredAiProvider);

function isProviderAvailable(provider) {
  return {
    gemini: Boolean(geminiApiKey),
    groq: Boolean(groqApiKey),
    qwen: Boolean(groqApiKey),
    openai: codexOAuthAvailable || Boolean(openaiApiKey),
  }[provider] ?? false;
}

function getActiveProvider() {
  return activeAiProvider === "qwen" ? "groq" : activeAiProvider;
}

function getActiveGroqModel() {
  return activeAiProvider === "qwen" ? QWEN_GROQ_MODEL : groqModel;
}

function loadTargetOverrides() {
  try {
    const parsed = JSON.parse(readFileSync(targetOverridesPath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveTargetOverrides() {
  writeFileSync(targetOverridesPath, `${JSON.stringify(targetOverrides, null, 2)}\n`, "utf8");
}

const targetOverrides = loadTargetOverrides();
const communityStore = new CommunityStore({ filePath: communityDataPath });

function getTargetChannelId(guildId) {
  return targetOverrides[guildId] ?? defaultTargetChannelId;
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message],
});

const processedMessages = new Set();
const geminiCooldowns = new Map();
const imageAccessLimiter = new ImageAccessLimiter();
const aiConversationHistory = new ConversationHistory({ maxTurns: 5 });
const aiSettingsStore = new AiSettingsStore();
const ankSessions = new AnkSessionStore();
const aiBattles = new AiBattleStore();
const geminiUsageTracker = new GeminiUsageTracker({
  softRequestsPerMinute: Number.isFinite(geminiSoftRpm) && geminiSoftRpm > 0 ? geminiSoftRpm : 8,
  softTokensPerMinute:
    Number.isFinite(geminiSoftTpm) && geminiSoftTpm > 0 ? geminiSoftTpm : null,
  dailyRequestLimit:
    Number.isFinite(geminiDailyRequestLimit) && geminiDailyRequestLimit > 0
      ? geminiDailyRequestLimit
      : null,
  dailyTokenLimit:
    Number.isFinite(geminiDailyTokenLimit) && geminiDailyTokenLimit > 0
      ? geminiDailyTokenLimit
      : null,
  fallbackMinutes:
    Number.isFinite(geminiFallbackMinutes) && geminiFallbackMinutes > 0
      ? geminiFallbackMinutes
      : 15,
});

const DEFAULT_POLL_DURATION_MINUTES = 60;
const COMMUNITY_TIMER_INTERVAL_MS = 15_000;
let communityTimer = null;

function getAiConversationKey({ guildId, channelId, userId }) {
  return [guildId ?? "dm", channelId, userId].join(":");
}

function getAiSettingsKey({ guildId }) {
  return guildId ?? "dm";
}

function getInteractionConversationKey(interaction) {
  return getAiConversationKey({
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    userId: interaction.user.id,
  });
}

function truncateForDiscord(text, maxLength = 160) {
  const compact = text.replace(/\s+/g, " ").trim();
  const characters = [...compact];
  return characters.length <= maxLength
    ? compact
    : `${characters.slice(0, maxLength - 3).join("")}...`;
}

function formatContext(key) {
  const turns = aiConversationHistory.getTurns(key);
  if (!turns.length) return "現在、保持中のAIコンテキストはありません。";

  const entries = turns.map(
    ({ user, assistant }, index) =>
      `**${index + 1}往復目**\nユーザー: ${truncateForDiscord(user)}\nAI: ${truncateForDiscord(assistant)}`,
  );
  return `保持中のコンテキスト（${turns.length}/5往復）\n\n${entries.join("\n\n")}`.slice(
    0,
    1900,
  );
}

function formatSettings(settings) {
  return [
    `長さ: ${AI_SETTING_LABELS.length[settings.length]}`,
    `言語: ${AI_SETTING_LABELS.language[settings.language]}`,
    `文体: ${AI_SETTING_LABELS.style[settings.style]}`,
  ].join(" / ");
}

async function handlePersonaSwitchCommand(message, persona) {
  if (
    !canChangeAiSettings(message.author.id, aiSettingsAllowedUserIds, {
      canManageGuild: message.member?.permissions.has(PermissionFlagsBits.ManageGuild) ?? false,
    })
  ) {
    await message.reply({
      content: "AI設定を変更する権限がありません。",
      allowedMentions: { repliedUser: false, parse: [] },
    });
    return true;
  }

  const settings = aiSettingsStore.set(getAiSettingsKey(message), "style", persona);
  await message.reply({
    content: `このサーバーのAI文体を ${AI_SETTING_LABELS.style[settings.style]} に切り替えました。` +
      " 次回のAI応答から適用します。",
    allowedMentions: { repliedUser: false, parse: [] },
  });
  return true;
}

function formatStatus(interaction) {
  const key = getInteractionConversationKey(interaction);
  const usage = geminiUsageTracker.getRateLimitStatus();
  const settings = aiSettingsStore.get(getAiSettingsKey(interaction));
  const provider = activeAiProvider === "qwen" && groqApiKey
    ? `Groq（${QWEN_GROQ_MODEL}）`
    : activeAiProvider === "openai" && (codexOAuthAvailable || openaiApiKey)
    ? `OpenAI（${codexOAuthAvailable ? "ChatGPT/Codex OAuth" : openaiModel ?? DEFAULT_OPENAI_MODEL}）`
    : activeAiProvider === "groq" && groqApiKey
    ? `Groq（${groqModel}）`
    : usage.fallbackActive
    ? "Groq（Geminiフォールバック中）"
    : geminiApiKey
      ? `Gemini（${geminiModel}）`
      : groqApiKey
        ? `Groq（${groqModel}）`
        : "未設定";

  return [
    `AI状態: ${geminiApiKey || groqApiKey || codexOAuthAvailable || openaiApiKey ? "利用可能" : "認証未設定"}`,
    `使用プロバイダー: ${provider}`,
    `コンテキスト: ${aiConversationHistory.getTurnCount(key)}/5往復`,
    `設定: ${formatSettings(settings)}`,
    `Gemini RPM: ${usage.remaining}/${usage.limit}回 残り`,
    usage.tokenLimit === null
      ? `Gemini TPM: ${usage.tokensUsedThisMinute.toLocaleString("ja-JP")} token 使用（上限未設定）`
      : `Gemini TPM: ${usage.tokensRemaining.toLocaleString("ja-JP")}/${usage.tokenLimit.toLocaleString("ja-JP")} token 残り`,
    usage.dailyRequestLimit === null
      ? `Gemini RPD: ${usage.dailyRequestsUsed}回 使用（上限未設定）`
      : `Gemini RPD: ${usage.dailyRequestsRemaining}/${usage.dailyRequestLimit}回 残り`,
  ].join("\n");
}

function buildPollComponents(poll, disabled = false) {
  return [
    new ActionRowBuilder().addComponents(
      poll.options.map((_, index) =>
        new ButtonBuilder()
          .setCustomId(`poll:${poll.id}:${index}`)
          .setLabel(String(index + 1))
          .setStyle(ButtonStyle.Primary)
          .setDisabled(disabled),
      ),
    ),
  ];
}

async function updatePollMessage(poll) {
  const channel = await client.channels.fetch(poll.channelId);
  if (!channel?.isTextBased?.() || typeof channel.messages?.fetch !== "function") {
    throw new Error(`Poll channel is not readable: ${poll.channelId}`);
  }
  const message = await channel.messages.fetch(poll.messageId);
  await message.edit({
    content: formatPollContent(poll),
    components: buildPollComponents(poll, poll.status !== "active"),
  });
}

function formatCounter(value) {
  return Number(value ?? 0).toLocaleString("ja-JP");
}

function formatCommunityStats(stats, { isUser = false, activePolls = 0 } = {}) {
  const counters = stats.user ?? stats.totals;
  return [
    `📈 ${isUser ? "あなたの統計" : "サーバー統計"}`,
    `メッセージ: ${formatCounter(counters.messages)}`,
    `画像リレー: ${formatCounter(counters.relays)}回 / ${formatCounter(counters.relayedImages)}枚`,
    `AI回答: ${formatCounter(counters.aiReplies)}回`,
    `ガチャ: ${formatCounter(counters.gachaPulls)}回`,
    `投票: ${formatCounter(counters.pollVotes)}票`,
    `リマインダー作成: ${formatCounter(counters.remindersCreated)}件`,
    ...(isUser ? [] : [`進行中の投票: ${formatCounter(activePolls)}件`]),
  ].join("\n");
}

function formatReminderList(reminders) {
  const sorted = sortReminders(reminders);
  if (!sorted.length) return "リマインダーはありません。";
  return [
    "⏰ あなたのリマインダー",
    ...sorted.map(
      (reminder) =>
        `・\`${reminder.id}\` <t:${Math.floor(reminder.dueAt / 1000)}:R> ${reminder.text}`,
    ),
  ].join("\n").slice(0, 1900);
}

function formatQuoteHistory(quotes) {
  if (!quotes.length) return "最近の画像リレー履歴はありません。";
  const lines = quotes.map((quote, index) => {
    const timestamp = quote.relayedAt ? `<t:${Math.floor(quote.relayedAt / 1000)}:R>` : "日時不明";
    const source = quote.sourceChannelId ? `<#${quote.sourceChannelId}>` : "元チャンネル";
    const original = quote.originalUrl ? `[元メッセージ](${quote.originalUrl})` : "元メッセージなし";
    const forwarded = quote.forwardedUrl ? `[転送先](${quote.forwardedUrl})` : "転送先なし";
    return `${index + 1}. ${timestamp} ${source} ${quote.imageCount ?? 0}枚\n${original} / ${forwarded}`;
  });
  return `🖼️ 最近の画像リレー\n${lines.join("\n")}`.slice(0, 1900);
}

async function fetchTargetChannel(channelId = defaultTargetChannelId) {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !channel.isTextBased() || typeof channel.send !== "function") {
    throw new Error(`Target channel is not writable: ${channelId}`);
  }
  return channel;
}

async function relayMessage(message) {
  const assets = getImageAssets(message, { includeUnknownAttachments: true }).slice(0, 10);
  if (!assets.length) return;

  const targetChannelId = getTargetChannelId(message.guildId);
  const targetChannel = await fetchTargetChannel(targetChannelId);
  const forwardedMessage = await targetChannel.send({
    files: assets.map(({ url, name }) => ({ attachment: url, name })),
    allowedMentions: { parse: [] },
  });

  communityStore.incrementStats({
    guildId: message.guildId,
    event: "relays",
  });
  communityStore.incrementStats({
    guildId: message.guildId,
    event: "relayedImages",
    amount: assets.length,
  });
  communityStore.addQuote(message.guildId, {
    id: message.id,
    sourceChannelId: message.channelId,
    targetChannelId,
    originalUrl: message.url ?? null,
    forwardedUrl: forwardedMessage?.url ?? null,
    forwardedMessageId: forwardedMessage?.id ?? null,
    imageCount: assets.length,
    relayedAt: Date.now(),
  });

  console.log(
      `[relay] ${assets.length} image(s) forwarded from #${message.channelId} ` +
      `to #${targetChannelId} (message ${message.id})`,
  );
}

function logBotMessage(message, eventName, isQuoteBotMessage) {
  if (!((debugBotMessages && message.author?.bot) || isQuoteBotMessage)) return;

  const attachmentInfo = [...(message.attachments?.values?.() ?? [])]
    .map((attachment) => `${attachment.name ?? "(no-name)"}:${attachment.contentType ?? "unknown"}`)
    .join(", ");
  const embedInfo = (message.embeds ?? [])
    .map((embed) => (embed.image?.url ? "image" : embed.thumbnail?.url ? "thumbnail" : "no-image"))
    .join(", ");
  const stickerInfo = [...(message.stickers?.values?.() ?? [])]
    .map((sticker) => sticker.name ?? sticker.id)
    .join(", ");
  const contentPreview = (message.content ?? "").replace(/\s+/g, " ").slice(0, 180);
  console.log(
    `[watch:${eventName}] bot message author=${message.author?.id} username=${message.author?.username} ` +
      `channel=${message.channelId} attachments=${message.attachments?.size ?? 0} ` +
      `embeds=${message.embeds?.length ?? 0} ` +
      `stickers=${message.stickers?.size ?? 0} type=${message.type} ` +
      `applicationId=${message.applicationId ?? "-"} webhookId=${message.webhookId ?? "-"} ` +
      `attachmentInfo=[${attachmentInfo}] embedInfo=[${embedInfo}] stickersInfo=[${stickerInfo}] ` +
      `contentPreview=${JSON.stringify(contentPreview)} recognized=${isQuoteBotMessage}`,
  );
}

async function processQuoteMessage(message, eventName) {
  const isQuoteBotMessage = isQuoteBotAuthor(message.author, quoteBotId, quoteBotName);
  logBotMessage(message, eventName, isQuoteBotMessage);

  if (processedMessages.has(message.id)) return;
  if (!shouldRelay(message, { quoteBotId, quoteBotName, sourceChannelIds })) return;

  processedMessages.add(message.id);
  try {
    await relayMessage(message);
  } catch (error) {
    processedMessages.delete(message.id);
    console.error(`[relay] Failed for message ${message.id}:`, error);
  }
}

async function handleAiPrompt(
  message,
  prompt,
  { prefix = "", imageAssets = [], mentionUserIds = [], bypassCooldown = false } = {},
) {
  const tweetContext = await enrichPromptWithTweets(prompt).catch((error) => {
    console.warn(`[fxtwitter] Could not enrich message ${message.id}: ${error.message}`);
    return { prompt, tweetCount: 0, failedCount: 1 };
  });
  prompt = tweetContext.prompt;
  const webContext = await enrichPromptWithWebPages(prompt).catch((error) => {
    console.warn(`[web-fetch] Could not enrich message ${message.id}: ${error.message}`);
    return { prompt, pageCount: 0, failedCount: 1 };
  });
  prompt = webContext.prompt;
  const moderation = moderatePrompt(prompt);
  if (!moderation.allowed) {
    await message.reply({
      content: moderation.message,
      allowedMentions: { repliedUser: false, parse: [] },
    });
    return true;
  }

  if (!geminiApiKey && !groqApiKey && !codexOAuthAvailable && !openaiApiKey) {
    await message.reply({
      content: "AI APIキー未設定。",
      allowedMentions: { repliedUser: false, parse: [] },
    });
    return true;
  }

  const now = Date.now();
  if (imageAssets.length > 0) {
    if (getActiveProvider() !== "openai" || !codexOAuthAvailable) {
      await message.reply({
        content: "画像を読むには `/model provider name:openai` を選択してください。",
        allowedMentions: { repliedUser: false, parse: [] },
      });
      return true;
    }
    const imageAccess = imageAccessLimiter.checkAndRecord(message.author.id, now);
    if (!imageAccess.allowed) {
      await message.reply({
        content: `画像の読み込みは3分に1回です。あと${Math.ceil(imageAccess.retryAfterMs / 1000)}秒待ってください。`,
        allowedMentions: { repliedUser: false, parse: [] },
      });
      return true;
    }
  }
  const cooldownUntil = geminiCooldowns.get(message.author.id) ?? 0;
  if (!bypassCooldown && cooldownUntil > now) {
    await message.reply({
      content: "連投制限中。5秒待って。",
      allowedMentions: { repliedUser: false, parse: [] },
    });
    return true;
  }
  if (!bypassCooldown) geminiCooldowns.set(message.author.id, now + 5_000);
  const conversationKey = getAiConversationKey({
    guildId: message.guildId,
    channelId: message.channelId,
    userId: message.author.id,
  });
  const storedHistory = aiConversationHistory.get(conversationKey);
  let history = storedHistory;
  let channelHistoryCount = 0;
  try {
    const channelHistory = await fetchChannelMessageHistory(message, {
      limit: DEFAULT_CHANNEL_HISTORY_LIMIT,
    });
    if (channelHistory.length > 0) {
      history = channelHistory;
      channelHistoryCount = channelHistory.length;
    }
  } catch (error) {
    console.warn(`[ai] Could not load channel history for ${message.id}: ${error.message}`);
  }
  const settings = aiSettingsStore.get(getAiSettingsKey(message));

  try {
    await message.channel.sendTyping();
    const result = await generateAiReply(prompt, {
      geminiApiKey,
      geminiModel,
      groqApiKey,
      groqModel: getActiveGroqModel(),
      qwenModel: QWEN_GROQ_MODEL,
      groqFallbackModel: groqModel,
      openaiApiKey,
      openaiOAuthAvailable: codexOAuthAvailable,
      openaiModel,
      preferredProvider: getActiveProvider(),
      history,
      settings,
      imageAssets,
      onGeminiUsage: (usage) => geminiUsageTracker.recordGeminiUsage(usage),
      tracker: geminiUsageTracker,
    });
    aiConversationHistory.add(conversationKey, prompt, result.text);
    if (message.guildId) {
      communityStore.incrementStats({
        guildId: message.guildId,
        userId: message.author.id,
        event: "aiReplies",
      });
    }
    console.log(
      `[ai] provider=${result.provider} reason=${result.reason} ` +
        `contextMessages=${channelHistoryCount || history.length} ` +
        `tweets=${tweetContext.tweetCount} ` +
        `webPages=${webContext.pageCount} message=${message.id}`,
    );
    await message.reply({
      content: prefix ? `${prefix}\n${result.text}` : result.text,
      allowedMentions: { repliedUser: false, parse: [], users: mentionUserIds },
    });
  } catch (error) {
    console.error(`[ai] Failed for message ${message.id}:`, error);
    let errorMessage = "AI応答エラー。";
    if (isGeminiLimitError(error) || isGroqLimitError(error) || isOpenAiLimitError(error)) {
      errorMessage = "AIの利用上限です。後で試して。";
    } else if (isGeminiUnavailableError(error) || isOpenAiUnavailableError(error)) {
      errorMessage = "AIが混雑中。後で試して。";
    } else if (isGeminiSafetyError(error)) {
      errorMessage = "その内容には対応できません。";
    }
    await message.reply({
      content: errorMessage,
      allowedMentions: { repliedUser: false, parse: [] },
    });
  }
  return true;
}

async function handleGeminiMention(message) {
  if (message.author.bot || !client.user) return false;
  const prompt = await extractAiPrompt(message, client.user.id);
  if (prompt === null) return false;
  const imageAssets = getImageAssets(message);
  const effectivePrompt = prompt || (imageAssets.length ? "この画像を見て説明してください。" : prompt);
  return handleAiPrompt(message, effectivePrompt, { imageAssets });
}

async function handleBattleMessage(message) {
  if (!aiBattles.shouldReply(message)) return false;
  return handleAiPrompt(message, buildBattlePrompt(message.content), {
    prefix: `<@${BATTLE_TARGET_BOT_ID}>`,
    mentionUserIds: [BATTLE_TARGET_BOT_ID],
    bypassCooldown: true,
  });
}

async function handleAnkCommand(message, command) {
  if (command.type === "help") {
    await message.reply({
      content: "使い方: `!ank 3`（次の3件目を安価として採用） / `!ank stop` / `!ank status`",
      allowedMentions: { repliedUser: false, parse: [] },
    });
    return true;
  }

  if (command.type === "invalid") {
    await message.reply({
      content: "安価の数字は1〜100で指定してください。例: `!ank 3`",
      allowedMentions: { repliedUser: false, parse: [] },
    });
    return true;
  }

  if (command.type === "stop") {
    const stopped = ankSessions.stop(message.channelId);
    await message.reply({
      content: stopped ? "安価モードを終了しました。" : "このチャンネルで安価モードは動いていません。",
      allowedMentions: { repliedUser: false, parse: [] },
    });
    return true;
  }

  if (command.type === "status") {
    const session = ankSessions.get(message.channelId);
    await message.reply({
      content: session
        ? `安価モード中: ${session.collectedCount}/${session.targetCount}件、残り${session.targetCount - session.collectedCount}件`
        : "このチャンネルで安価モードは動いていません。",
      allowedMentions: { repliedUser: false, parse: [] },
    });
    return true;
  }

  const session = ankSessions.start(message.channelId, command.targetCount, message.author.id);
  await message.reply({
    content: `安価モード開始。次の${session.targetCount}件目のメッセージを採用します（10分間）。`,
    allowedMentions: { repliedUser: false, parse: [] },
  });
  return true;
}

async function handleAnkCandidate(message) {
  if (message.author.bot || !message.guild || !message.content?.trim()) return false;

  const result = ankSessions.accept(message.channelId);
  if (!result) return false;

  if (!result.complete) {
    await message.react("🔢").catch(() => {});
    return true;
  }

  await message.react("👉").catch((error) => {
    console.error(`[ank] Could not react to selected message ${message.id}:`, error.message);
  });
  await message.reply({
    content: `安価成立（${result.targetCount}件目）。${message.author} さん、お願いします。`,
    allowedMentions: { repliedUser: false, users: [message.author.id] },
  });
  return true;
}

async function handleGachaCommand(message) {
  if (message.author.bot || !message.guild) return false;
  if (!parseGachaCommand(message.content)) return false;

  communityStore.incrementStats({
    guildId: message.guildId,
    userId: message.author.id,
    event: "gachaPulls",
  });
  await message.reply({
    content: formatGachaResult(rollGacha()),
    allowedMentions: { repliedUser: false, parse: [] },
  });
  return true;
}

async function handleSummaryCommand(interaction) {
  if (!interaction.guild) {
    await interaction.reply({
      content: "サーバー内で実行してください。",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const channel = interaction.channel;
  if (!channel?.isTextBased?.() || typeof channel.messages?.fetch !== "function") {
    await interaction.reply({
      content: "このチャンネルのメッセージを取得できません。",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (!geminiApiKey && !groqApiKey && !codexOAuthAvailable && !openaiApiKey) {
    await interaction.reply({
      content: "AI APIキーが設定されていません。",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const cooldownUntil = geminiCooldowns.get(interaction.user.id) ?? 0;
  if (cooldownUntil > Date.now()) {
    await interaction.reply({
      content: "連続実行を防ぐため、少し待ってから試してください。",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const requestedCount = interaction.options.getInteger("count") ?? DEFAULT_SUMMARY_COUNT;
  const count = parseSummaryCount(requestedCount);

  try {
    await interaction.deferReply();
    const messages = await channel.messages.fetch({ limit: count });
    const prompt = buildSummaryPrompt(messages);
    if (!prompt) {
      await interaction.editReply({
        content: "要約できるテキストメッセージがありません。",
        allowedMentions: { parse: [] },
      });
      return true;
    }

    const moderation = moderatePrompt(prompt);
    if (!moderation.allowed) {
      await interaction.editReply({
        content: moderation.message,
        allowedMentions: { parse: [] },
      });
      return true;
    }

    geminiCooldowns.set(interaction.user.id, Date.now() + 5_000);
    const result = await generateAiReply(prompt, {
      geminiApiKey,
      geminiModel,
      groqApiKey,
      groqModel: getActiveGroqModel(),
      qwenModel: QWEN_GROQ_MODEL,
      groqFallbackModel: groqModel,
      openaiApiKey,
      openaiOAuthAvailable: codexOAuthAvailable,
      openaiModel,
      preferredProvider: getActiveProvider(),
      history: [],
      taskInstruction: SUMMARY_TASK_INSTRUCTION,
      settings: {
        ...aiSettingsStore.get(getAiSettingsKey(interaction)),
        length: "normal",
      },
      onGeminiUsage: (usage) => geminiUsageTracker.recordGeminiUsage(usage),
      tracker: geminiUsageTracker,
    });

    communityStore.incrementStats({
      guildId: interaction.guildId,
      userId: interaction.user.id,
      event: "aiReplies",
    });

    console.log(
      `[summary] provider=${result.provider} reason=${result.reason} ` +
        `messages=${count} channel=${interaction.channelId}`,
    );
    await interaction.editReply({
      content: `📝 ${result.text}`,
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    console.error(`[summary] Failed in channel ${interaction.channelId}:`, error);
    let errorMessage = "要約中にエラーが発生しました。";
    if (isGeminiLimitError(error) || isGroqLimitError(error) || isOpenAiLimitError(error)) {
      errorMessage = "AIの利用上限です。少し待ってから試してください。";
    } else if (isGeminiUnavailableError(error) || isOpenAiUnavailableError(error)) {
      errorMessage = "AIが混雑しています。少し待ってから試してください。";
    }
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({
        content: errorMessage,
        allowedMentions: { parse: [] },
      });
    } else {
      await interaction.reply({
        content: errorMessage,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
  return true;
}

async function handleAhooNewsCommand(interaction) {
  if (!interaction.guild) {
    await interaction.reply({
      content: "サーバー内で実行してください。",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (!geminiApiKey && !groqApiKey && !codexOAuthAvailable && !openaiApiKey) {
    await interaction.reply({
      content: "AI APIキーが設定されていません。",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const cooldownUntil = geminiCooldowns.get(interaction.user.id) ?? 0;
  if (cooldownUntil > Date.now()) {
    await interaction.reply({
      content: "連続実行を防ぐため、少し待ってから試してください。",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const topic = interaction.options.getString("topic") ?? "";
  const prompt = buildAhooNewsPrompt(topic);
  const moderation = moderatePrompt(prompt);
  if (!moderation.allowed) {
    await interaction.reply({
      content: moderation.message,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  try {
    await interaction.deferReply();
    geminiCooldowns.set(interaction.user.id, Date.now() + 5_000);
    const result = await generateAiReply(prompt, {
      geminiApiKey,
      geminiModel,
      groqApiKey,
      groqModel: getActiveGroqModel(),
      qwenModel: QWEN_GROQ_MODEL,
      groqFallbackModel: groqModel,
      openaiApiKey,
      openaiOAuthAvailable: codexOAuthAvailable,
      openaiModel,
      preferredProvider: getActiveProvider(),
      history: [],
      taskInstruction: AHOO_NEWS_TASK_INSTRUCTION,
      settings: {
        ...aiSettingsStore.get(getAiSettingsKey(interaction)),
        length: "normal",
      },
      onGeminiUsage: (usage) => geminiUsageTracker.recordGeminiUsage(usage),
      tracker: geminiUsageTracker,
    });

    communityStore.incrementStats({
      guildId: interaction.guildId,
      userId: interaction.user.id,
      event: "aiReplies",
    });
    console.log(
      `[ahoo] provider=${result.provider} reason=${result.reason} ` +
        `channel=${interaction.channelId} user=${interaction.user.id}`,
    );
    await interaction.editReply({
      content: formatAhooNewsReply(result.text),
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    console.error(`[ahoo] Failed in channel ${interaction.channelId}:`, error);
    let errorMessage = "架空ニュースの生成中にエラーが発生しました。";
    if (isGeminiLimitError(error) || isGroqLimitError(error) || isOpenAiLimitError(error)) {
      errorMessage = "AIの利用上限です。少し待ってから試してください。";
    } else if (isGeminiUnavailableError(error) || isOpenAiUnavailableError(error)) {
      errorMessage = "AIが混雑しています。少し待ってから試してください。";
    }
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({
        content: errorMessage,
        allowedMentions: { parse: [] },
      });
    } else {
      await interaction.reply({
        content: errorMessage,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
  return true;
}

async function handlePollCommand(interaction) {
  if (!interaction.guild || !interaction.channel?.isTextBased?.()) {
    await interaction.reply({
      content: "サーバーのテキストチャンネルで実行してください。",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const commandOptions = interaction.options;
  const options = ["option1", "option2", "option3", "option4", "option5"]
    .map((name) => commandOptions.getString(name))
    .filter((option) => option !== null);
  const durationMinutes = commandOptions.getInteger("duration") ?? DEFAULT_POLL_DURATION_MINUTES;
  const poll = createPoll({
    id: `p-${randomUUID().replaceAll("-", "").slice(0, 12)}`,
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    messageId: "pending",
    createdBy: interaction.user.id,
    question: commandOptions.getString("question", true),
    options,
    durationMinutes,
  });

  try {
    const sentMessage = await interaction.reply({
      content: formatPollContent(poll),
      components: buildPollComponents(poll),
      allowedMentions: { parse: [] },
      fetchReply: true,
    });
    poll.messageId = sentMessage.id;
    communityStore.setPoll(poll);
    communityStore.incrementStats({
      guildId: interaction.guildId,
      userId: interaction.user.id,
      event: "pollsCreated",
    });
  } catch (error) {
    console.error("[poll] Could not create poll:", error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "投票の作成に失敗しました。Botの送信権限を確認してください。",
        flags: MessageFlags.Ephemeral,
      });
    }
  }
  return true;
}

async function handlePollButton(interaction) {
  const match = interaction.customId.match(/^poll:([^:]+):(\d+)$/);
  if (!match) return false;

  const poll = communityStore.getPoll(match[1]);
  if (!poll) {
    await interaction.reply({
      content: "この投票は見つからないか、すでに削除されています。",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const optionIndex = Number.parseInt(match[2], 10);
  const result = castPollVote(poll, interaction.user.id, optionIndex);
  if (!result.ok && result.reason === "expired") {
    closePoll(poll);
    communityStore.setPoll(poll);
    await interaction.reply({
      content: "この投票は終了しています。",
      flags: MessageFlags.Ephemeral,
    });
    await updatePollMessage(poll).catch((error) =>
      console.error(`[poll] Could not close expired poll ${poll.id}:`, error.message),
    );
    return true;
  }
  if (!result.ok || poll.status !== "active") {
    await interaction.reply({
      content: "この投票は終了しています。",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (result.changed) {
    communityStore.setPoll(poll);
    communityStore.incrementStats({
      guildId: poll.guildId,
      userId: interaction.user.id,
      event: "pollVotes",
    });
  }
  await interaction.reply({
    content: result.changed ? "投票を受け付けました。" : "すでにこの選択肢へ投票しています。",
    flags: MessageFlags.Ephemeral,
  });
  if (result.changed) {
    await updatePollMessage(poll).catch((error) =>
      console.error(`[poll] Could not update poll ${poll.id}:`, error.message),
    );
  }
  return true;
}

async function handleRemindCommand(interaction) {
  if (!interaction.guild || !interaction.channel?.isTextBased?.()) {
    await interaction.reply({
      content: "サーバーのテキストチャンネルで実行してください。",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "set") {
    const activeCount = communityStore.countUserReminders(
      interaction.guildId,
      interaction.user.id,
    );
    if (activeCount >= MAX_ACTIVE_REMINDERS_PER_USER) {
      await interaction.reply({
        content: `登録できるリマインダーは${MAX_ACTIVE_REMINDERS_PER_USER}件までです。`,
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const minutes = parseReminderMinutes(interaction.options.getInteger("minutes"));
    const text = interaction.options.getString("text", true);
    if (!minutes) {
      await interaction.reply({
        content: "通知時間は1分後から7日後まで指定できます。",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const reminder = createReminder({
      id: `r-${randomUUID().replaceAll("-", "").slice(0, 8)}`,
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      userId: interaction.user.id,
      text,
      minutes,
    });
    communityStore.setReminder(reminder);
    communityStore.incrementStats({
      guildId: interaction.guildId,
      userId: interaction.user.id,
      event: "remindersCreated",
    });
    await interaction.reply({
      content: `リマインダーを登録しました（ID: \`${reminder.id}\`、<t:${Math.floor(reminder.dueAt / 1000)}:R>）。`,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    return true;
  }

  if (subcommand === "list") {
    await interaction.reply({
      content: formatReminderList(
        communityStore.listReminders({
          guildId: interaction.guildId,
          userId: interaction.user.id,
        }),
      ),
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    return true;
  }

  const id = interaction.options.getString("id", true);
  const reminder = communityStore.getReminder(id);
  if (
    !reminder ||
    reminder.guildId !== interaction.guildId ||
    reminder.userId !== interaction.user.id
  ) {
    await interaction.reply({
      content: "そのリマインダーは見つかりません。",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }
  communityStore.deleteReminder(id);
  await interaction.reply({
    content: `リマインダー \`${id}\` を取り消しました。`,
    flags: MessageFlags.Ephemeral,
  });
  return true;
}

async function handleStatsCommand(interaction) {
  if (!interaction.guild) {
    await interaction.reply({
      content: "サーバー内で実行してください。",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }
  const isUser = interaction.options.getSubcommand() === "me";
  const stats = communityStore.getStats(interaction.guildId, isUser ? interaction.user.id : null);
  const activePolls = communityStore.listPolls().filter(
    (poll) => poll.guildId === interaction.guildId && poll.status === "active",
  ).length;
  await interaction.reply({
    content: formatCommunityStats(stats, { isUser, activePolls }),
    ...(isUser ? { flags: MessageFlags.Ephemeral } : {}),
    allowedMentions: { parse: [] },
  });
  return true;
}

async function handleQuotesCommand(interaction) {
  if (!interaction.guild) {
    await interaction.reply({
      content: "サーバー内で実行してください。",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }
  const count = interaction.options.getInteger("count") ?? 10;
  await interaction.reply({
    content: formatQuoteHistory(communityStore.getQuotes(interaction.guildId, count)),
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  });
  return true;
}

async function processExpiredPolls(now = Date.now()) {
  for (const poll of communityStore.listPolls()) {
    if (poll.status !== "active" || !isPollExpired(poll, now)) continue;
    closePoll(poll, now);
    communityStore.setPoll(poll);
    await updatePollMessage(poll).catch((error) =>
      console.error(`[poll] Could not finalize poll ${poll.id}:`, error.message),
    );
  }
}

async function deliverReminder(reminder) {
  const content = `<@${reminder.userId}> ⏰ リマインダー: ${reminder.text}`;
  const payload = {
    content,
    allowedMentions: { parse: [], users: [reminder.userId] },
  };

  try {
    const channel = await client.channels.fetch(reminder.channelId);
    if (!channel?.isTextBased?.() || typeof channel.send !== "function") {
      throw new Error(`Reminder channel is not writable: ${reminder.channelId}`);
    }
    await channel.send(payload);
    return true;
  } catch (channelError) {
    try {
      const user = await client.users.fetch(reminder.userId);
      await user.send(payload);
      console.warn(`[remind] Delivered ${reminder.id} by DM after channel failure`);
      return true;
    } catch (dmError) {
      console.error(
        `[remind] Could not deliver ${reminder.id}: channel=${channelError.message}; dm=${dmError.message}`,
      );
      return false;
    }
  }
}

async function processDueReminders(now = Date.now()) {
  for (const reminder of communityStore.listDueReminders(now)) {
    const current = communityStore.getReminder(reminder.id);
    if (!current) continue;
    current.lastAttemptAt = now;
    communityStore.setReminder(current);
    if (await deliverReminder(current)) communityStore.deleteReminder(current.id);
  }
}

async function processCommunityJobs() {
  await processExpiredPolls();
  await processDueReminders();
}

function startCommunityScheduler() {
  if (communityTimer) return;
  communityTimer = setInterval(() => {
    processCommunityJobs().catch((error) => console.error("[community] Scheduled job failed:", error));
  }, COMMUNITY_TIMER_INTERVAL_MS);
  communityTimer.unref?.();
  processCommunityJobs().catch((error) => console.error("[community] Initial job failed:", error));
}

async function stopBotAndSleep() {
  console.log(`[sleep] ${systemSleepTime} reached. Stopping bot and suspending Windows.`);
  try {
    if (communityTimer) clearInterval(communityTimer);
    communityTimer = null;
    communityStore.close();
    launchWindowsSleepHelper();
    client.destroy();
    setTimeout(() => process.exit(0), 500).unref();
  } catch (error) {
    console.error("[sleep] Could not suspend Windows:", error);
  }
}

async function changeTargetChannel({ guild, canManageGuild, channelQuery, reply }) {
  if (!canManageGuild) {
    await reply("このコマンドはサーバー管理権限が必要です。");
    return;
  }

  if (!channelQuery) {
    await reply("使い方: `./chanel tensousaki チャンネル名`");
    return;
  }

  const channelId = extractChannelId(channelQuery);
  let matches = [];
  if (channelId) {
    const channel = guild.channels.cache.get(channelId);
    if (channel) matches = [channel];
  } else {
    const normalizedQuery = normalizeChannelQuery(channelQuery);
    matches = guild.channels.cache.filter(
      (channel) =>
        typeof channel.name === "string" &&
        channel.isTextBased() &&
        channel.name.toLowerCase() === normalizedQuery,
    ).toJSON();
  }

  if (matches.length === 0) {
    await reply(`チャンネル「${channelQuery}」が見つかりません。`);
    return;
  }

  if (matches.length > 1) {
    const candidates = matches.map((channel) => `<#${channel.id}>`).join(" ");
    await reply(`同名のチャンネルがあります。チャンネルメンションで指定してください: ${candidates}`);
    return;
  }

  const targetChannel = matches[0];
  const botMember = guild.members.me;
  const permissions = botMember ? targetChannel.permissionsFor(botMember) : null;
  const canSend = permissions?.has([
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.AttachFiles,
  ]);
  if (!canSend) {
    await reply(`#${targetChannel.name} に必要な権限がありません。`);
    return;
  }

  targetOverrides[guild.id] = targetChannel.id;
  saveTargetOverrides();
  await reply(`転送先を <#${targetChannel.id}> に変更しました。`);
  console.log(`[config] Target channel for guild ${guild.id}: ${targetChannel.id}`);
}

async function registerSlashCommands(readyClient) {
  for (const guild of readyClient.guilds.cache.values()) {
    await guild.commands.set(slashCommands.map((commandBuilder) => commandBuilder.toJSON()));
    console.log(`[ready] Slash commands synchronized for guild ${guild.id}`);
  }
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`[ready] Logged in as ${readyClient.user.tag}`);
  console.log(`[ready] Server invite URL: ${buildServerInviteUrl(readyClient.user.id)}`);
  console.log(`[ready] Watching Make it a Quote bot ${quoteBotId}`);
  console.log(`[ready] Bot name fallback: ${quoteBotName}`);
  console.log(`[ready] Gemini replies: ${geminiApiKey ? `enabled (${geminiModel})` : "disabled"}`);
  console.log(`[ready] Groq fallback: ${groqApiKey ? `enabled (${groqModel})` : "disabled"}`);
  console.log(
    `[ready] OpenAI replies: ${codexOAuthAvailable
      ? `enabled (ChatGPT/Codex OAuth${openaiModel ? `, ${openaiModel}` : ""})`
      : openaiApiKey
        ? `enabled (API key, ${openaiModel ?? DEFAULT_OPENAI_MODEL})`
        : "disabled"}`,
  );
  console.log(`[ready] Primary AI provider: ${activeAiProvider}`);
  console.log(
    `[ready] Gemini soft limit: ${geminiUsageTracker.softRequestsPerMinute} requests/minute; ` +
      `fallback circuit: ${geminiFallbackMinutes} minutes`,
  );
  if (systemSleepEnabled) {
    try {
      const { next } = scheduleSystemSleep(systemSleepTime, stopBotAndSleep);
      console.log(`[ready] Windows sleep scheduled: ${next.toLocaleString()}`);
    } catch (error) {
      console.error(`[ready] Windows sleep schedule is invalid: ${error.message}`);
    }
  } else {
    console.log("[ready] Windows sleep schedule: disabled");
  }
  console.log(`[ready] Forwarding images to channel ${defaultTargetChannelId}`);
  if (sourceChannelIds.length) {
    console.log(`[ready] Source channel filter: ${sourceChannelIds.join(", ")}`);
  }

  try {
    await registerSlashCommands(readyClient);
    console.log(
      "[ready] Slash commands registered: /chanel, /channel, /help, /ahoo news, /rate limit, /reset, /status, /context, /ai battle, /model, /summarize, /poll, /remind, /stats, /quotes, /settings",
    );
    console.log("[ready] Prefix commands: !ank N / !ank status / !ank stop / !gacha");
    startCommunityScheduler();
    console.log(`[ready] Community jobs: every ${COMMUNITY_TIMER_INTERVAL_MS / 1000}s`);
    await fetchTargetChannel(defaultTargetChannelId);
    console.log(`[ready] Default target channel is available: ${defaultTargetChannelId}`);
    if (Object.keys(targetOverrides).length > 0) {
      console.log(
        `[ready] Guild-specific target overrides loaded: ${Object.keys(targetOverrides).length}`,
      );
    }
  } catch (error) {
    console.error(`[ready] Default target channel check failed: ${error.message}`);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isButton()) {
    await handlePollButton(interaction);
    return;
  }
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "ai") {
    if (interaction.options.getSubcommandGroup() !== "battle") return;
    const action = interaction.options.getSubcommand();
    if (action === "st") {
      if (interaction.user.id !== BATTLE_START_USER_ID) {
        await interaction.reply({
          content: "討論を開始できるのは指定ユーザーだけです。",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (!interaction.guild || !interaction.channel?.isTextBased?.()) {
        await interaction.reply({
          content: "サーバーのテキストチャンネルで実行してください。",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      aiBattles.start(interaction.channelId, interaction.user.id);
      await interaction.reply({
        content: `<@${BATTLE_TARGET_BOT_ID}> 討論を始めよう。まず議題か主張を提示してください。`,
        allowedMentions: { parse: [], users: [BATTLE_TARGET_BOT_ID] },
      });
      return;
    }

    const stopped = aiBattles.stop(interaction.channelId);
    await interaction.reply({
      content: stopped ? "このチャンネルのAI討論を停止しました。" : "このチャンネルではAI討論は動いていません。",
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (interaction.commandName === "model") {
    if (!canSelectModel(interaction.user.id)) {
      await interaction.reply({
        content: "このコマンドを使用する権限がありません。",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.options.getSubcommand() !== "provider") return;

    const provider = interaction.options.getString("name", true);
    if (!isProviderAvailable(provider)) {
      await interaction.reply({
        content: `${AI_MODEL_LABELS[provider] ?? provider} はBot側で安全に設定されていません。管理者がサーバー環境変数を設定してください。APIキーをDiscordへ投稿しないでください。`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    activeAiProvider = saveSelectedProvider(modelSelectionPath, provider);
    const modelName = {
      gemini: geminiModel,
      groq: groqModel,
      qwen: QWEN_GROQ_MODEL,
      openai: codexOAuthAvailable
        ? `ChatGPT/Codex OAuth${openaiModel ? ` / ${openaiModel}` : ""}`
        : openaiModel ?? DEFAULT_OPENAI_MODEL,
    }[activeAiProvider];
    console.log(
      `[config] AI model changed by user ${interaction.user.id}: ` +
        `provider=${activeAiProvider} model=${modelName}`,
    );
    await interaction.reply({
      content: `AIプロバイダーを ${AI_MODEL_LABELS[activeAiProvider]}（${modelName}）へ変更しました。認証情報はDiscordには表示されません。`,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (interaction.commandName === "rate") {
    if (interaction.options.getSubcommand() !== "limit") return;

    const status = geminiUsageTracker.getRateLimitStatus();
    const formatNumber = (value) => value.toLocaleString("ja-JP");
    const formatLimit = (used, remaining, limit, unit) =>
      limit === null
        ? `${formatNumber(used)} ${unit}（上限未設定）`
        : `${formatNumber(used)}/${formatNumber(limit)} ${unit}（残り ${formatNumber(remaining)}）`;
    const geminiStatus = geminiApiKey
      ? [
          `RPM: ${formatLimit(status.used, status.remaining, status.limit, "回")}`,
          `TPM: ${formatLimit(status.tokensUsedThisMinute, status.tokensRemaining, status.tokenLimit, "token")}`,
          `RPD: ${formatLimit(status.dailyRequestsUsed, status.dailyRequestsRemaining, status.dailyRequestLimit, "回")}`,
          `リセット: <t:${Math.floor(status.resetAt / 1000)}:R>`,
          status.dailyTokenLimit === null
            ? `今日のトークン使用量: ${formatNumber(status.dailyTokensUsed)} token（上限未設定）`
            : `今日のトークン: ${formatLimit(status.dailyTokensUsed, status.dailyTokensRemaining, status.dailyTokenLimit, "token")}`,
        ].join("\n")
      : "Gemini: APIキー未設定";
    const fallbackStatus = status.fallbackActive
      ? `Groqフォールバック中（終了: <t:${Math.floor(status.fallbackUntil / 1000)}:R>）`
      : groqApiKey
        ? "Groqフォールバック: 待機中"
        : "Groq: APIキー未設定";

    await interaction.reply({
      content: `${geminiStatus}\n${fallbackStatus}\n※残り回数はGeminiの内部ソフト上限です。`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (interaction.commandName === "reset") {
    const conversationKey = getInteractionConversationKey(interaction);
    aiConversationHistory.clear(conversationKey);
    await interaction.reply({
      content: "このチャンネルのAIコンテキストをリセットしました。",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (interaction.commandName === "status") {
    await interaction.reply({
      content: formatStatus(interaction),
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (interaction.commandName === "context") {
    await interaction.reply({
      content: formatContext(getInteractionConversationKey(interaction)),
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (interaction.commandName === "help") {
    await interaction.reply({
      content: buildHelpMessage(),
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (interaction.commandName === "ahoo") {
    if (interaction.options.getSubcommand() === "news") {
      await handleAhooNewsCommand(interaction);
    }
    return;
  }

  if (interaction.commandName === "summarize") {
    await handleSummaryCommand(interaction);
    return;
  }

  if (interaction.commandName === "poll") {
    await handlePollCommand(interaction);
    return;
  }

  if (interaction.commandName === "remind") {
    await handleRemindCommand(interaction);
    return;
  }

  if (interaction.commandName === "stats") {
    await handleStatsCommand(interaction);
    return;
  }

  if (interaction.commandName === "quotes") {
    await handleQuotesCommand(interaction);
    return;
  }

  if (interaction.commandName === "settings") {
    if (
      !canChangeAiSettings(interaction.user.id, aiSettingsAllowedUserIds, {
        canManageGuild:
          interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false,
      })
    ) {
      await interaction.reply({
        content: "AI設定を変更する権限がありません。",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const setting = interaction.options.getSubcommand();
    const value = interaction.options.getString("value", true);
    const settings = aiSettingsStore.set(
      getAiSettingsKey(interaction),
      setting,
      value,
    );
    await interaction.reply({
      content: `このサーバー全体のAI設定を更新しました。${formatSettings(settings)}`,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (!["chanel", "channel"].includes(interaction.commandName)) return;
  if (interaction.options.getSubcommand() !== "tensousaki") return;

  if (!interaction.guild) {
    await interaction.reply({
      content: "サーバー内で実行してください。",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    await changeTargetChannel({
      guild: interaction.guild,
      canManageGuild: interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false,
      channelQuery: interaction.options.getString("channel", true),
      reply: (content) =>
        interaction.reply({
          content,
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [] },
        }),
    });
  } catch (error) {
    console.error("[config] Slash command failed:", error);
    const payload = {
      content: "転送先の変更中にエラーが発生しました。Botの権限とチャンネル名を確認してください。",
      flags: MessageFlags.Ephemeral,
    };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (await handleBattleMessage(message)) return;
  if (!message.author.bot && message.guild) {
    communityStore.incrementStats({
      guildId: message.guildId,
      userId: message.author.id,
      event: "messages",
    });
    if (isKimazuMentionCommand(message.content, client.user?.id)) {
      if (!message.reference?.messageId) {
        await message.reply({
          content: "誰かのメッセージに返信しながら `@Bot名 kimazui` と送ってください。",
          allowedMentions: { repliedUser: false, parse: [] },
        });
        return;
      }

      try {
        const repliedMessage = await message.channel.messages.fetch(message.reference.messageId);
        const avatarUrl = repliedMessage.author.displayAvatarURL({
          extension: "png",
          forceStatic: true,
          size: 512,
        });
        const avatar = await downloadImage(avatarUrl);
        const botMember = message.guild.members.me;
        const image = await createKimazuImage(avatar, {
          messageText:
            cleanKimazuMessageText(repliedMessage.cleanContent, {
              botUserId: client.user.id,
              botNames: [client.user.username, botMember?.displayName],
            }) ||
            (repliedMessage.attachments.size > 0 ? "（画像・ファイル付きメッセージ）" : ""),
        });
        await message.reply({
          files: [{ attachment: image, name: "kimazu.jpg" }],
          allowedMentions: { repliedUser: false, parse: [] },
        });
      } catch (error) {
        console.error(`[kimazu] Failed for message ${message.id}:`, error);
        await message.reply({
          content: "画像を作れませんでした。少し待ってからもう一度試してください。",
          allowedMentions: { repliedUser: false, parse: [] },
        });
      }
      return;
    }
    const personaCommand = parsePersonaSwitchCommand(message.content);
    if (personaCommand) {
      await handlePersonaSwitchCommand(message, personaCommand.persona);
      return;
    }
    if (await handleGachaCommand(message)) return;

    const ankCommand = parseAnkCommand(message.content);
    if (ankCommand) {
      await handleAnkCommand(message, ankCommand);
      return;
    }

    const command = parseTargetCommand(message.content);
    if (command) {
      try {
        await changeTargetChannel({
          guild: message.guild,
          canManageGuild: message.member?.permissions.has(PermissionFlagsBits.ManageGuild) ?? false,
          channelQuery: command.channelQuery,
          reply: (content) =>
            message.reply({
              content,
              allowedMentions: { repliedUser: false, parse: [] },
            }),
        });
      } catch (error) {
        console.error(`[config] Failed to change target channel:`, error);
        await message.reply({
          content: "転送先の変更中にエラーが発生しました。Botの権限とチャンネル名を確認してください。",
          allowedMentions: { repliedUser: false },
        });
      }
      return;
    }

    if (await handleAnkCandidate(message)) return;
  }

  if (await handleGeminiMention(message)) return;

  await processQuoteMessage(message, "create");
});

client.on(Events.MessageUpdate, async (_oldMessage, newMessage) => {
  let message = newMessage;
  try {
    if (message.partial) message = await message.fetch();
  } catch (error) {
    console.error(`[watch:update] Could not fetch updated message ${message.id}:`, error);
    return;
  }

  await processQuoteMessage(message, "update");
});

client.on(Events.Error, (error) => {
  console.error("[discord] Client error:", error);
});

process.on("exit", () => {
  communityStore.close();
});

process.on("unhandledRejection", (error) => {
  console.error("[process] Unhandled rejection:", error);
});

client.login(token).catch((error) => {
  console.error("[login] Could not log in to Discord:", error);
  process.exitCode = 1;
});
