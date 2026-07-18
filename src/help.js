import { IMAGE_COMMAND_ALLOWED_USER_ID } from "./image-command-access.js";

const HELP_SECTIONS = Object.freeze([
  {
    title: "画像生成",
    lines: [
      "`@Bot名 kimazui`: 誰かのメッセージに返信して送ると、その人のアイコンと本文を気まずい画像に合成",
      "`@Bot名 hakusihika`: 返信先をDiscord風に白紙画像へ合成（アイコン・名前・時刻・絵文字・静止画スタンプ対応）",
      "`kimazui` / `hakusihika` の生成画像はチャンネル `1525816436625379458` にも自動転送",
      "`/kitachan`: Xで画像付きのかわいいぼ喜多投稿を検索し、名言資料チャンネルへ送信（6時間ごとの自動検索投稿もあり）",
    ],
  },
  {
    title: "AIモデル",
    lines: [
      "`/model provider name`: 使用するAIプロバイダーを変更（指定ユーザーのみ）",
      "`/model provider image`: 画像生成をCloudflareまたはCodex OAuthへ切り替え（指定ユーザーのみ）",
    ],
  },
  {
    title: "AI",
    lines: [
      "`/ahoo news [topic]`: AIで明確に架空のニュースを作成",
      "`/help`: このヘルプを表示",
      "`@Bot 質問` / Botへの返信: AIに質問",
      "`/summarize [count]`: 直近メッセージを要約（5〜50件）",
      "`/x-search query count order`: 1〜20件を新着順・話題順・メディア順で取得し、Codexが最良の1件を厳選",
      "`/x tuiseki username`: このチャンネルでXユーザーの新規投稿を5分おきに追跡",
      "`/ac search username`: 指定Xアカウントの直近3投稿本文をリンクなしでそのまま表示",
      "`/reset ai`: このチャンネルのAI会話コンテキストを消去",
      "`/reset x`: このチャンネルのX追跡をすべて停止",
      "`/context`: 保存中の会話コンテキストを確認",
      "ユーザーが`ユーザーIDの履歴を取得して傾向をまとめて`と依頼すると、読めるチャンネルから対象ユーザーの発言を参照",
      "`/settings length|language|style`: AI回答設定を変更（安全な討論・会話・プラナ口調・まぐろmode・壇上十和あり）",
      "`ペルソナ切り替え: pda_founder`: サーバー全体のAI文体をpda_founderに切り替え",
      "`ペルソナ切り替え: danjo_towa` / `ペルソナ切り替え: 壇上十和`: サーバー全体のAI文体を壇上十和に切り替え",
      "`/status`: AI接続・設定・コンテキスト状態を確認",
      "`/ai battle st [topic] [max_turns]` / `/ai battle stop`: 制限を緩めたAI同士のレスバ実験を開始・停止（最大50ターン）",
      "`/res battle`: 指定Botのこのチャンネルでの最新発言へ強くしっかり反論",
      "`/stop`: AIの自動返信だけを`/open`まで停止（メンション返信・コマンド・画像転送は継続）",
      "`/open`: 停止中のAI自動返信をすぐに再開（指定ユーザーのみ）",
      "`/gay`: 過去5件から一番面白そうな投稿へ 🇬 🇦 🇾 とランダム絵文字をリアクション",
      "`/rate limit`: AI利用状況と残り枠を確認",
    ],
  },
  {
    title: "コミュニティ",
    lines: [
      "`/poll`: ボタン式投票を作成（選択肢2〜5個、期限指定可）",
      "`/remind set minutes text`: 指定分後のリマインダーを登録",
      "`/remind list` / `/remind cancel id`: 自分の通知を管理",
      "`/stats server` / `/stats me`: サーバー・自分の統計を確認",
      "`/quotes [count]`: 最近の画像リレー履歴を確認",
    ],
  },
  {
    title: "画像リレー・管理",
    lines: [
      "Make it a Quoteの画像は自動で転送",
      "`/chanel tensousaki channel` / `/channel tensousaki channel`: 転送先を変更（管理者）",
      "`/relay channel channel_id`: 転送先チャンネルをIDで変更（ユーザーID 1068329268397998161 のみ）",
    ],
  },
  {
    title: "ゲーム・自動機能",
    lines: [
      "`!gacha`: 10連ガチャ",
      "`!ank N`: 次のN件目のメッセージを安価として選出",
      "`!ank status` / `!ank stop`: 安価モードを確認・停止",
    ],
  },
  {
    title: "経済",
    lines: [
      "`/balance`: miq coinの残高を確認",
      "`/daily`: 1日1回の報酬を受け取る",
      "`/work`: cooldown付きの仕事報酬を受け取る",
      "`/quest`: デイリークエストを確認・報酬受取",
      "`/leaderboard`: miq coinランキングを表示",
      "`/pay user amount`: 他のユーザーへ送金",
      "`/roulette`: miq coinを赤・黒・数字に賭ける",
    ],
  },
  {
    title: "Spotify",
    lines: [
      "`/spotify connect`: Connect your Spotify account privately",
      "`/spotify history [count]`: Publish your recent tracks to the server",
      "`/spotify status` / `/spotify disconnect`: Manage your Spotify connection privately",
      `\`/image prompt\`: Generate an image (only Discord user ${IMAGE_COMMAND_ALLOWED_USER_ID} can use this command)`,
      "Paste a Spotify track URL: Show a large cover-art card with track information",
    ],
  },
]);

function buildHelpMessage() {
  return [
    "`/memory remember text` / `/memory list` / `/memory forget id`: Manage saved memories (only Discord user 1068329268397998161 can use these commands)",
    "`/skill save name instruction` / `/skill list` / `/skill delete id`: Manage reusable Agent Skills (owner only). The owner can also mention the bot with `save skill name | description | steps`; it is saved automatically and applied when relevant.",
    "`/agent task`: Run the bounded Codex Agent (owner only; no PC or auth-state control)",
    "Questions, requests, problems, and research/summary instructions can start the bounded Agent automatically; casual chat is answered only when it is relevant to recent temporary conversation context.",
    "AI context includes the current speaker, direct mentions, and the author/content of a referenced reply so it can distinguish who the reply is for.",
    "Autonomous turns use one bounded observe-decide-act-reflect cycle; requests addressed to another user are not intercepted.",
    "Relevant saved Skills are supplied as untrusted reference workflows; they never grant shell, computer, message-sending, or other tool permissions.",
    "Conversation context is kept in temporary memory only; it is not written to a file.",
    "Reply to the bot or mention it with one Discord video/audio attachment to run bounded media tasks: `mp3`, `mp4`, `gif`, `info`, or `trim <start> <duration>`.",
    "Media tasks accept Discord CDN attachments only, never arbitrary URLs or shell commands; input is limited to 25MB and output to 8MB.",
    "Set `FFMPEG_BIN` and `FFPROBE_BIN` when ffmpeg/ffprobe are not on PATH. `/stop` pauses only automatic AI replies; active tasks and other bot features continue.",
    "`/vc join`: Join your current voice channel for opt-in speech-to-AI-to-VOICEVOX replies. `/vc channel #channel`: Route only that text channel into the active VC session (reply in text and speech). `/vc leave`: Leave and stop listening.",
    "VC requires `@discordjs/voice`, `opusscript`, and a local VOICEVOX server (default `http://127.0.0.1:50021`).",
    "`/verify`: A server manager posts a persistent public X verification panel; members press `認証へGO` and receive their personal OAuth link privately. A server manager must approve the request before the verified role is granted.",
    "# miq bot ヘルプ",
    "使いたい機能のコマンドを選んでください。詳細な引数はDiscordの入力候補で確認できます。",
    ...HELP_SECTIONS.flatMap(({ title, lines }) => [`\n## ${title}`, ...lines]),
  ].join("\n");
}

export { HELP_SECTIONS, buildHelpMessage };
