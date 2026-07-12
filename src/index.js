import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import {
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
import { buildServerInviteUrl } from "./invite.js";
import { getImageAssets, isQuoteBotAuthor, shouldRelay } from "./relay.js";
import { launchWindowsSleepHelper, scheduleSystemSleep } from "./system-sleep.js";
import { ConversationHistory } from "./conversation-history.js";
import { AI_SETTING_LABELS, AiSettingsStore } from "./ai-settings.js";
import { AnkSessionStore, parseAnkCommand } from "./ank.js";
import { formatGachaResult, parseGachaCommand, rollGacha } from "./gacha.js";
import { selectActiveMessages } from "./auto-reaction.js";

const DEFAULT_QUOTE_BOT_ID = "949479338275913799";

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
const autoReactionEnabled = process.env.AUTO_REACTION_ENABLED !== "false";
const autoReactionIntervalMs = Math.max(
  Number.parseInt(process.env.AUTO_REACTION_INTERVAL_SECONDS ?? "120", 10) || 120,
  120,
) * 1000;
const autoReactionActivityWindowMs = Math.max(
  Number.parseInt(process.env.AUTO_REACTION_ACTIVITY_WINDOW_SECONDS ?? "60", 10) || 60,
  1,
) * 1000;
const autoReactionMinActivity = Math.max(
  Number.parseInt(process.env.AUTO_REACTION_MIN_ACTIVITY ?? "5", 10) || 5,
  1,
);
const autoReactionBatchSize = Math.max(
  Number.parseInt(process.env.AUTO_REACTION_BATCH_SIZE ?? "3", 10) || 3,
  1,
);
const autoReactionEmojis = parseIdList(
  process.env.AUTO_REACTION_EMOJIS ?? "👍,😂,😮,🤔,🔥",
);

const targetOverridesPath = new URL("../target-overrides.json", import.meta.url);

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
const aiConversationHistory = new ConversationHistory({ maxTurns: 5 });
const aiSettingsStore = new AiSettingsStore();
const ankSessions = new AnkSessionStore();
const autoReactionMessages = new Map();
let autoReactionTimer = null;
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

function getAiConversationKey({ guildId, channelId, userId }) {
  return [guildId ?? "dm", channelId, userId].join(":");
}

function getAiSettingsKey({ guildId }) {
  return guildId ?? "dm";
}

function rememberAutoReactionMessage(message) {
  if (
    !autoReactionEnabled ||
    message.author?.bot ||
    !message.guild ||
    !message.channel?.isTextBased?.() ||
    !message.content?.trim()
  ) {
    return;
  }

  autoReactionMessages.set(message.id, {
    message,
    createdAt: Date.now(),
  });
  while (autoReactionMessages.size > 300) {
    autoReactionMessages.delete(autoReactionMessages.keys().next().value);
  }
}

async function autoReactToRandomMessage() {
  if (!autoReactionEnabled || !autoReactionEmojis.length) return;

  const now = Date.now();
  const cutoff = now - autoReactionActivityWindowMs;
  for (const [messageId, entry] of autoReactionMessages) {
    if (entry.createdAt < cutoff) {
      autoReactionMessages.delete(messageId);
    }
  }

  const selectedMessages = selectActiveMessages(autoReactionMessages, {
    count: autoReactionBatchSize,
    now,
    windowMs: autoReactionActivityWindowMs,
    minActivity: autoReactionMinActivity,
  });
  for (const selected of selectedMessages) {
    const emoji = autoReactionEmojis[Math.floor(Math.random() * autoReactionEmojis.length)];
    try {
      await selected.message.react(emoji);
      console.log(`[reaction] emoji=${emoji} message=${selected.message.id}`);
    } catch (error) {
      console.error(`[reaction] Failed for message ${selected.message.id}:`, error.message);
    } finally {
      autoReactionMessages.delete(selected.message.id);
    }
  }
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

function formatStatus(interaction) {
  const key = getInteractionConversationKey(interaction);
  const usage = geminiUsageTracker.getRateLimitStatus();
  const settings = aiSettingsStore.get(getAiSettingsKey(interaction));
  const provider = usage.fallbackActive
    ? "Groq（Geminiフォールバック中）"
    : geminiApiKey
      ? `Gemini（${geminiModel}）`
      : groqApiKey
        ? `Groq（${groqModel}）`
        : "未設定";

  return [
    `AI状態: ${geminiApiKey || groqApiKey ? "利用可能" : "APIキー未設定"}`,
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
  await targetChannel.send({
    files: assets.map(({ url, name }) => ({ attachment: url, name })),
    allowedMentions: { parse: [] },
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

async function handleAiPrompt(message, prompt, { prefix = "" } = {}) {
  const moderation = moderatePrompt(prompt);
  if (!moderation.allowed) {
    await message.reply({
      content: moderation.message,
      allowedMentions: { repliedUser: false, parse: [] },
    });
    return true;
  }

  if (!geminiApiKey && !groqApiKey) {
    await message.reply({
      content: "AI APIキー未設定。",
      allowedMentions: { repliedUser: false, parse: [] },
    });
    return true;
  }

  const now = Date.now();
  const cooldownUntil = geminiCooldowns.get(message.author.id) ?? 0;
  if (cooldownUntil > now) {
    await message.reply({
      content: "連投制限中。5秒待って。",
      allowedMentions: { repliedUser: false, parse: [] },
    });
    return true;
  }
  geminiCooldowns.set(message.author.id, now + 5_000);
  const conversationKey = getAiConversationKey({
    guildId: message.guildId,
    channelId: message.channelId,
    userId: message.author.id,
  });
  const history = aiConversationHistory.get(conversationKey);
  const settings = aiSettingsStore.get(getAiSettingsKey(message));

  try {
    await message.channel.sendTyping();
    const result = await generateAiReply(prompt, {
      geminiApiKey,
      geminiModel,
      groqApiKey,
      groqModel,
      history,
      settings,
      onGeminiUsage: (usage) => geminiUsageTracker.recordGeminiUsage(usage),
      tracker: geminiUsageTracker,
    });
    aiConversationHistory.add(conversationKey, prompt, result.text);
    console.log(
      `[ai] provider=${result.provider} reason=${result.reason} ` +
        `contextTurns=${history.length / 2} message=${message.id}`,
    );
    await message.reply({
      content: prefix ? `${prefix}\n${result.text}` : result.text,
      allowedMentions: { repliedUser: false, parse: [] },
    });
  } catch (error) {
    console.error(`[ai] Failed for message ${message.id}:`, error);
    let errorMessage = "AI応答エラー。";
    if (isGeminiLimitError(error) || isGroqLimitError(error)) {
      errorMessage = "AIの利用上限です。後で試して。";
    } else if (isGeminiUnavailableError(error)) {
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
  return handleAiPrompt(message, prompt);
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

  await message.reply({
    content: formatGachaResult(rollGacha()),
    allowedMentions: { repliedUser: false, parse: [] },
  });
  return true;
}

async function stopBotAndSleep() {
  console.log(`[sleep] ${systemSleepTime} reached. Stopping bot and suspending Windows.`);
  try {
    if (autoReactionTimer) clearInterval(autoReactionTimer);
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
    for (const commandBuilder of slashCommands) {
      const commandData = commandBuilder.toJSON();
      const existing = await guild.commands.fetch();
      const existingCommand = existing.find((command) => command.name === commandData.name);
      if (existingCommand) {
        await existingCommand.edit(commandData);
      } else {
        await guild.commands.create(commandData);
      }
    }
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
  if (autoReactionEnabled) {
    autoReactionTimer = setInterval(autoReactToRandomMessage, autoReactionIntervalMs);
    autoReactionTimer.unref?.();
    console.log(
      `[ready] Auto reactions: every ${autoReactionIntervalMs / 1000}s; ` +
        `up to ${autoReactionBatchSize} reactions; ` +
        `${autoReactionMinActivity}+ messages/${autoReactionActivityWindowMs / 1000}s ` +
        `(${autoReactionEmojis.join(", ")})`,
    );
  } else {
    console.log("[ready] Auto reactions: disabled");
  }
  console.log(`[ready] Forwarding images to channel ${defaultTargetChannelId}`);
  if (sourceChannelIds.length) {
    console.log(`[ready] Source channel filter: ${sourceChannelIds.join(", ")}`);
  }

  try {
    await registerSlashCommands(readyClient);
    console.log(
      "[ready] Slash commands registered: /chanel, /channel, /rate limit, /reset, /status, /context, /settings",
    );
    console.log("[ready] Prefix commands: !ank N / !ank status / !ank stop / !gacha");
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
  if (!interaction.isChatInputCommand()) return;

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

  if (interaction.commandName === "settings") {
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
  if (!message.author.bot && message.guild) {
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

    rememberAutoReactionMessage(message);
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

process.on("unhandledRejection", (error) => {
  console.error("[process] Unhandled rejection:", error);
});

client.login(token).catch((error) => {
  console.error("[login] Could not log in to Discord:", error);
  process.exitCode = 1;
});
