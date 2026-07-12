import { SlashCommandBuilder } from "discord.js";
import { AI_SETTING_CHOICES } from "./ai-settings.js";

function parseTargetCommand(content) {
  const match = content?.trim().match(/^\.\/(?:chanel|channel)\s+tensousaki(?:\s+(.+))?$/i);
  if (!match) return null;
  return { channelQuery: match[1]?.trim() ?? "" };
}

function normalizeChannelQuery(query) {
  return query.trim().replace(/^#/, "").toLowerCase();
}

function extractChannelId(query) {
  const mention = query.trim().match(/^<#(\d+)>$/);
  if (mention) return mention[1];
  if (/^\d+$/.test(query.trim())) return query.trim();
  return null;
}

function createTargetCommand(name) {
  return new SlashCommandBuilder()
    .setName(name)
    .setDescription("転送先チャンネルを変更します")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("tensousaki")
        .setDescription("画像の転送先を変更します")
        .addStringOption((option) =>
          option
            .setName("channel")
            .setDescription("チャンネル名、チャンネルメンション、またはチャンネルID")
            .setRequired(true),
        ),
    );
}

const targetCommands = [createTargetCommand("chanel"), createTargetCommand("channel")];

const rateCommand = new SlashCommandBuilder()
  .setName("rate")
  .setDescription("AIの使用量を確認します")
  .addSubcommand((subcommand) =>
    subcommand.setName("limit").setDescription("AIの残り使用量を確認します"),
  );

const resetCommand = new SlashCommandBuilder()
  .setName("reset")
  .setDescription("AIの会話コンテキストをリセットします");

const statusCommand = new SlashCommandBuilder()
  .setName("status")
  .setDescription("AIの接続状態と設定を確認します");

const contextCommand = new SlashCommandBuilder()
  .setName("context")
  .setDescription("保持中のAIコンテキストを確認します");

const settingsCommand = new SlashCommandBuilder()
  .setName("settings")
  .setDescription("AIの回答設定を変更します")
  .addSubcommand((subcommand) =>
    subcommand
      .setName("length")
      .setDescription("回答の長さを変更します")
      .addStringOption((option) =>
        option
          .setName("value")
          .setDescription("短め・標準・詳しく")
          .setRequired(true)
          .addChoices(...AI_SETTING_CHOICES.length),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("language")
      .setDescription("回答言語を変更します")
      .addStringOption((option) =>
        option
          .setName("value")
          .setDescription("自動・日本語・英語")
          .setRequired(true)
          .addChoices(...AI_SETTING_CHOICES.language),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("style")
      .setDescription("回答の文体を変更します")
      .addStringOption((option) =>
        option
          .setName("value")
          .setDescription("カジュアル・丁寧・箇条書き・冷笑・レスバ・煽り")
          .setRequired(true)
          .addChoices(...AI_SETTING_CHOICES.style),
      ),
  );

const slashCommands = [
  ...targetCommands,
  rateCommand,
  resetCommand,
  statusCommand,
  contextCommand,
  settingsCommand,
];

export {
  extractChannelId,
  normalizeChannelQuery,
  parseTargetCommand,
  slashCommands,
  targetCommands,
};
