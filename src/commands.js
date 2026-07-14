import { SlashCommandBuilder } from "discord.js";
import { AI_SETTING_CHOICES } from "./ai-settings.js";
import { AI_MODEL_CHOICES, IMAGE_PROVIDER_CHOICES } from "./model-selection.js";
import {
  MAX_SUMMARY_COUNT,
  MIN_SUMMARY_COUNT,
} from "./summary.js";
import {
  MAX_POLL_DURATION_MINUTES,
  MAX_POLL_OPTION_LENGTH,
  MAX_POLL_QUESTION_LENGTH,
  MIN_POLL_DURATION_MINUTES,
} from "./poll.js";
import {
  MAX_REMINDER_MINUTES,
  MIN_REMINDER_MINUTES,
} from "./reminders.js";
import { MAX_ROULETTE_BET, MAX_TRANSFER_AMOUNT } from "./economy.js";
import { MAX_HISTORY_LIMIT } from "./spotify.js";
import { MAX_IMAGE_PROMPT_LENGTH } from "./cloudflare-image.js";

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

const ahooCommand = new SlashCommandBuilder()
  .setName("ahoo")
  .setDescription("AIで架空のコンテンツを作成します")
  .addSubcommand((subcommand) =>
    subcommand
      .setName("news")
      .setDescription("架空のニュースを作成します")
      .addStringOption((option) =>
        option
          .setName("topic")
          .setDescription("ニュースの創作テーマ（任意）")
          .setMaxLength(120)
          .setRequired(false),
      ),
  );

const helpCommand = new SlashCommandBuilder()
  .setName("help")
  .setDescription("Botの全機能と使い方を表示します");

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

const modelCommand = new SlashCommandBuilder()
  .setName("model")
  .setDescription("使用するAIプロバイダーを変更します")
  .addSubcommand((subcommand) =>
    subcommand
      .setName("provider")
      .setDescription("使用するAIプロバイダーを変更します")
      .addStringOption((option) =>
        option
          .setName("name")
          .setDescription("使用するAIプロバイダー")
          .setRequired(false)
          .addChoices(...AI_MODEL_CHOICES),
      )
      .addStringOption((option) =>
        option
          .setName("image")
          .setDescription("Image generation provider")
          .setRequired(false)
          .addChoices(...IMAGE_PROVIDER_CHOICES),
      ),
  );

const aiCommand = new SlashCommandBuilder()
  .setName("ai")
  .setDescription("AI同士の機能を操作します")
  .addSubcommandGroup((group) =>
    group
      .setName("battle")
      .setDescription("指定Botとの討論を操作します")
      .addSubcommand((subcommand) =>
        subcommand.setName("st").setDescription("指定Botへメンションして討論を開始します"),
      )
      .addSubcommand((subcommand) =>
        subcommand.setName("stop").setDescription("このチャンネルの討論を停止します"),
      ),
  );

const summarizeCommand = new SlashCommandBuilder()
  .setName("summarize")
  .setDescription("直近のメッセージをAIで要約します")
  .addIntegerOption((option) =>
    option
      .setName("count")
      .setDescription("要約するメッセージ数")
      .setMinValue(MIN_SUMMARY_COUNT)
      .setMaxValue(MAX_SUMMARY_COUNT)
      .setRequired(false),
  );

const pollCommand = new SlashCommandBuilder()
  .setName("poll")
  .setDescription("ボタン式の投票を作成します")
  .addStringOption((option) =>
    option
      .setName("question")
      .setDescription("投票の質問")
      .setMaxLength(MAX_POLL_QUESTION_LENGTH)
      .setRequired(true),
  )
  .addStringOption((option) =>
    option
      .setName("option1")
      .setDescription("選択肢1")
      .setMaxLength(MAX_POLL_OPTION_LENGTH)
      .setRequired(true),
  )
  .addStringOption((option) =>
    option
      .setName("option2")
      .setDescription("選択肢2")
      .setMaxLength(MAX_POLL_OPTION_LENGTH)
      .setRequired(true),
  )
  .addStringOption((option) =>
    option
      .setName("option3")
      .setDescription("選択肢3")
      .setMaxLength(MAX_POLL_OPTION_LENGTH)
      .setRequired(false),
  )
  .addStringOption((option) =>
    option
      .setName("option4")
      .setDescription("選択肢4")
      .setMaxLength(MAX_POLL_OPTION_LENGTH)
      .setRequired(false),
  )
  .addStringOption((option) =>
    option
      .setName("option5")
      .setDescription("選択肢5")
      .setMaxLength(MAX_POLL_OPTION_LENGTH)
      .setRequired(false),
  )
  .addIntegerOption((option) =>
    option
      .setName("duration")
      .setDescription("期限（分、未指定時は60分）")
      .setMinValue(MIN_POLL_DURATION_MINUTES)
      .setMaxValue(MAX_POLL_DURATION_MINUTES)
      .setRequired(false),
  );

const remindCommand = new SlashCommandBuilder()
  .setName("remind")
  .setDescription("自分用のリマインダーを設定します")
  .addSubcommand((subcommand) =>
    subcommand
      .setName("set")
      .setDescription("指定分後に通知します")
      .addIntegerOption((option) =>
        option
          .setName("minutes")
          .setDescription("何分後に通知するか")
          .setMinValue(MIN_REMINDER_MINUTES)
          .setMaxValue(MAX_REMINDER_MINUTES)
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("text")
          .setDescription("通知する内容")
          .setMaxLength(500)
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("list").setDescription("自分のリマインダー一覧を表示します"),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("cancel")
      .setDescription("自分のリマインダーを取り消します")
      .addStringOption((option) =>
        option.setName("id").setDescription("リマインダーID").setRequired(true),
      ),
  );

const statsCommand = new SlashCommandBuilder()
  .setName("stats")
  .setDescription("サーバーや自分の活動統計を表示します")
  .addSubcommand((subcommand) =>
    subcommand.setName("server").setDescription("サーバー全体の統計を表示します"),
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("me").setDescription("自分の統計を表示します"),
  );

const quotesCommand = new SlashCommandBuilder()
  .setName("quotes")
  .setDescription("最近リレーされた画像の履歴を表示します")
  .addIntegerOption((option) =>
    option
      .setName("count")
      .setDescription("表示件数")
      .setMinValue(1)
      .setMaxValue(20)
      .setRequired(false),
  );

const imageCommand = new SlashCommandBuilder()
  .setName("image")
  .setDescription("Generate an image with the free FLUX model")
  .addStringOption((option) =>
    option
      .setName("prompt")
      .setDescription("Describe the image to generate")
      .setMaxLength(MAX_IMAGE_PROMPT_LENGTH)
      .setRequired(true),
  );

const spotifyCommand = new SlashCommandBuilder()
  .setName("spotify")
  .setDescription("Spotifyの再生履歴を連携・表示します")
  .addSubcommand((subcommand) =>
    subcommand
      .setName("connect")
      .setDescription("Spotifyアカウントを連携します"),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("history")
      .setDescription("自分の最近の再生履歴をサーバーに表示します")
      .addIntegerOption((option) =>
        option
          .setName("count")
          .setDescription("表示件数")
          .setMinValue(1)
          .setMaxValue(MAX_HISTORY_LIMIT)
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("status")
      .setDescription("Spotifyの連携状態を確認します"),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("disconnect")
      .setDescription("Spotifyアカウントの連携を解除します"),
  );

const balanceCommand = new SlashCommandBuilder()
  .setName("balance")
  .setDescription("Check a miq coin balance")
  .addUserOption((option) =>
    option
      .setName("user")
      .setDescription("User to inspect")
      .setRequired(false),
  );

const dailyCommand = new SlashCommandBuilder()
  .setName("daily")
  .setDescription("Claim your daily miq coins");

const workCommand = new SlashCommandBuilder()
  .setName("work")
  .setDescription("Work for a random miq coin reward");

const questCommand = new SlashCommandBuilder()
  .setName("quest")
  .setDescription("View and claim daily quests");

const leaderboardCommand = new SlashCommandBuilder()
  .setName("leaderboard")
  .setDescription("Show the miq coin leaderboard");

const payCommand = new SlashCommandBuilder()
  .setName("pay")
  .setDescription("Send miq coins to another user")
  .addUserOption((option) =>
    option
      .setName("user")
      .setDescription("User to pay")
      .setRequired(true),
  )
  .addIntegerOption((option) =>
    option
      .setName("amount")
      .setDescription("Amount of miq coins")
      .setMinValue(1)
      .setMaxValue(MAX_TRANSFER_AMOUNT)
      .setRequired(true),
  );

const rouletteCommand = new SlashCommandBuilder()
  .setName("roulette")
  .setDescription("Bet miq coins on a roulette spin")
  .addIntegerOption((option) =>
    option
      .setName("amount")
      .setDescription("Amount to bet")
      .setMinValue(1)
      .setMaxValue(MAX_ROULETTE_BET)
      .setRequired(true),
  )
  .addStringOption((option) =>
    option
      .setName("choice")
      .setDescription("red, black, or number")
      .setRequired(true)
      .addChoices(
        { name: "Red", value: "red" },
        { name: "Black", value: "black" },
        { name: "Number", value: "number" },
      ),
  )
  .addIntegerOption((option) =>
    option
      .setName("number")
      .setDescription("Number from 0 to 36 when choice is number")
      .setMinValue(0)
      .setMaxValue(36)
      .setRequired(false),
  );

const settingsCommand = new SlashCommandBuilder()
  .setName("settings")
  // Explicitly clear an older administrator-only registration on Discord.
  .setDefaultMemberPermissions(null)
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
          .setDescription("カジュアル・丁寧・箇条書き・冷笑・レスバ・煽り・自称名探偵構文・pda_founder")
          .setRequired(true)
          .addChoices(...AI_SETTING_CHOICES.style),
      ),
  );

const slashCommands = [
  ...targetCommands,
  helpCommand,
  ahooCommand,
  rateCommand,
  resetCommand,
  statusCommand,
  contextCommand,
  aiCommand,
  modelCommand,
  summarizeCommand,
  pollCommand,
  remindCommand,
  statsCommand,
  quotesCommand,
  imageCommand,
  spotifyCommand,
  settingsCommand,
  balanceCommand,
  dailyCommand,
  workCommand,
  questCommand,
  leaderboardCommand,
  payCommand,
  rouletteCommand,
];

export {
  extractChannelId,
  normalizeChannelQuery,
  parseTargetCommand,
  slashCommands,
  targetCommands,
};
