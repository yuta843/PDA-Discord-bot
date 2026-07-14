const HELP_SECTIONS = Object.freeze([
  {
    title: "画像生成",
    lines: [
      "`@Bot名 kimazui`: 誰かのメッセージに返信して送ると、その人のアイコンと本文を気まずい画像に合成",
      "`@Bot名 hakusihika`: 返信先をDiscord風に白紙画像へ合成（アイコン・名前・時刻・絵文字・静止画スタンプ対応）",
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
      "`/reset`: このチャンネルの会話コンテキストを消去",
      "`/context`: 保存中の会話コンテキストを確認",
      "`/settings length|language|style`: AI回答設定を変更（安全な討論・会話モードあり）",
      "`ペルソナ切り替え: pda_founder`: サーバー全体のAI文体をpda_founderに切り替え",
      "`/status`: AI接続・設定・コンテキスト状態を確認",
      "`/ai battle st` / `/ai battle stop`: 指定Botとのメンション付き討論を開始・停止",
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
      "`/image prompt`: Generate an image (5 images per user per day; owner ID 1068329268397998161 is unlimited)",
      "Paste a Spotify track URL: Show a large cover-art card with track information",
    ],
  },
]);

function buildHelpMessage() {
  return [
    "# miq bot ヘルプ",
    "使いたい機能のコマンドを選んでください。詳細な引数はDiscordの入力候補で確認できます。",
    ...HELP_SECTIONS.flatMap(({ title, lines }) => [`\n## ${title}`, ...lines]),
  ].join("\n");
}

export { HELP_SECTIONS, buildHelpMessage };
