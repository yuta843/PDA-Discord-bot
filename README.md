# Make it a Quote image relay bot

## 公開リポジトリの範囲

このリポジトリにはBot本体、Discord Activity、テスト、ドキュメント、サンプル設定、画像・3Dアセットを含めています。APIキー、Bot Token、OAuth Secret、セッションSecret、OAuthトークン、Discordの実行時データは公開しません。

ローカルの`.env`と実行時JSON、ロックファイル、ログ、ビルド成果物、Playwrightの作業データ、X分析レポートは`.gitignore`で除外しています。公開前に`.env.example`をコピーし、各自の環境でSecretを設定してください。SecretをREADME、ソースコード、Issue、ログへ貼り付けないでください。

## Discord Activity: Pachinko Party

このリポジトリには、既存Botと分離した無料アーケードミニゲームを追加しています。ゲーム内で扱うのはスコアだけで、現金、課金通貨、換金可能な景品、賭博要素はありません。

### 構成

```text
apps/activity-client   Vite + React + Phaser 3 + Embedded App SDK
apps/activity-server   Fastify + Socket.IO + OAuth + SQLite
packages/shared        Zodスキーマ、ゲームルール、Socket.IOイベント型
```

ActivityサーバーはNode.js組み込みの`node:sqlite`を利用するため、Node.js 22.5以上が必要です。

### 起動

1. `.env.example` を `.env` にコピーし、最低でも `SESSION_SECRET`（32文字以上）を設定します。Discord外のブラウザで動作確認する場合は `VITE_DEV_MODE=true` と `DEV_AUTH_ENABLED=true` を使えます。
2. `pnpm install` を実行します。
3. ターミナル1で `pnpm --filter @miq/pachinko-server dev`、ターミナル2で `pnpm --filter @miq/pachinko-client dev` を起動します。
4. 通常のブラウザ確認は `http://localhost:5173`、Discord内確認は `cloudflared tunnel --url http://localhost:5173` などで公開URLを作ります。

本番は `pnpm activity:build` 後に `pnpm --filter @miq/pachinko-server start` を起動すると、ビルド済みクライアントも同じFastifyサーバーから配信できます。

### Discord Developer Portal設定

1. [Discord Developer Portal](https://discord.com/developers/applications) でApplicationを作成し、Application IDを `DISCORD_CLIENT_ID` と `VITE_DISCORD_CLIENT_ID` に設定します。`DISCORD_CLIENT_SECRET` はサーバー側の `.env` だけに保存します。
2. `Activities` の設定で **Enable Activities** を有効にし、Entry Point command（Launch）を作成します。Guild InstallとUser Installを必要に応じて有効にします。
3. `OAuth2` のRedirectsに `https://127.0.0.1` を登録します。Embedded App SDKがActivity内のauthorize後の戻り先を処理します。
4. `Activities > URL Mappings` のPrefix `/` に、Viteまたは本番サーバーの公開ホストを登録します。ローカル開発ではトンネルのホスト名を登録します。
5. `.env` の `CLIENT_ORIGIN` をクライアントの公開オリジンに合わせ、`DISCORD_REDIRECT_URI=https://127.0.0.1` を設定します。本番では `NODE_ENV=production`、`DEV_AUTH_ENABLED=false` にします。
6. ActivityをDiscordのApp Launcherから起動します。同じActivity instanceの参加者はSDKの `instanceId` をルームIDとして同じSocket.IOルームに参加します。本番では `DISCORD_BOT_TOKEN` が必須で、サーバーがDiscord Activity Instance APIでもinstanceIdを照合します。

### VCキャラクター状態同期

Activityは起動時にEmbedded App SDKでDiscord OAuthを完了してからSocket.IOへ接続します。Bot側のVC状態（`idle` / `listening` / `thinking` / `speaking`）を表示するには、BotとActivityサーバーの両方に同じ `ACTIVITY_BOT_API_SECRET` を設定し、Bot側の `ACTIVITY_SERVER_URL` と現在の `ACTIVITY_INSTANCE_ID` を設定します。リモートのActivityサーバーへ接続する場合、`ACTIVITY_SERVER_URL` はHTTPS必須です。

現在のキャラクター描画は、ユーザー提供のSTLを40,000面へ軽量化した静的3Dモデルです。正面資料の画像をXY平面へ投影する疑似UVテクスチャを使い、破綻を抑えるため左右回転を小さく制限しています。`listening` / `thinking` / `speaking` に応じてモデル全体が動きますが、STLにはボーンや口のモーフがないため口パクではありません。状態同期は描画から分離しており、後からVRMへ差し替えられます。LLM、Codex OAuth、VOICEVOXの秘密情報や音声処理はBot側に残り、Activityブラウザへ渡しません。

STLを再生成する場合は `scripts/requirements-stl.txt` のPython依存を入れ、`scripts/prepare-stl.py <source.stl> <destination.stl>` を実行します。既定の出力上限は40,000面です。生成元とハッシュはモデルフォルダーの `ASSET_PROVENANCE.md` に記録しています。

OAuthの認可コード交換とDiscordユーザー取得はバックエンドだけで実施し、アクセストークンはブラウザへ返しません。フロントエンドはHttpOnlyセッションCookieで `/api` とSocket.IOを利用します。Discord SDKのiframe/READY/authorizeの仕様は [Activitiesの公式ガイド](https://docs.discord.com/developers/activities/building-an-activity) と [マルチプレイヤーガイド](https://docs.discord.com/developers/activities/development-guides/multiplayer-experience) を参照してください。

### 検証コマンド

```powershell
pnpm activity:typecheck
pnpm activity:lint
pnpm activity:test
pnpm activity:build
```

`Make it a Quote` が生成した画像を、指定したDiscordチャンネルへ自動転送するBotです。Botが参加している別サーバーから、共通の転送先チャンネルへ集約することもできます。

## セットアップ

Oracle Cloud の Ubuntu VM で常駐させる場合は、[Oracle Cloud 配置手順](docs/oracle-cloud.md)を参照してください。

1. [Discord Developer Portal](https://discord.com/developers/applications)でBotを作り、Tokenを取得する。
2. Botを対象サーバーへ招待する。必要な権限は次の通り。
   - 転送元: View Channel / Read Message History
   - 転送先: View Channel / Send Messages / Attach Files
   - Botの設定で「Message Content Intent」を有効にする。
3. Discordのユーザー設定からDeveloper Modeを有効にし、転送先チャンネルを右クリックして「チャンネルIDをコピー」する。
4. `.env`を開いて、`DISCORD_TOKEN`と`TARGET_CHANNEL_ID`を設定する。
5. 依存関係をインストールして起動する。

```powershell
npm.cmd install
npm.cmd start
```

起動後、コンソールの`[ready] Server invite URL:`に表示されるURLを開くと、Botを別のサーバーへ追加できます。

## サーバーへ追加できない場合

Discord Developer Portalの対象Applicationで、次を確認してください。

1. `Installation` → `Installation Contexts`で`Guild Install`を有効にする。
2. `Guild Install`のScopesに`bot`と`applications.commands`を追加する。
3. `Bot` → `Public Bot`を有効にする（他のユーザーも追加する場合）。
4. `Bot` → `Requires OAuth2 Code Grant`を無効にする。
5. 追加するユーザーが対象サーバーの「サーバー管理」権限を持っていることを確認する。

設定変更後はBotを再起動し、新しく表示された`Server invite URL`を使用してください。

## 使い方

転送元のチャンネルで、対象メッセージへの返信として`@Make it a Quote`を実行します。Make it a Quoteが画像を投稿すると、このBotがその画像を`TARGET_CHANNEL_ID`へ転送します。

`SOURCE_CHANNEL_IDS`にチャンネルIDをカンマ区切りで指定すると、指定したチャンネルだけを監視できます。空欄なら、このBotが読めるサーバー内の全チャンネルを監視します。

### 白紙画像への書き込み

書き込みたいメッセージへの返信として、`@Bot名 hakusihika` と送ると、返信元のアイコン・表示名・時刻・本文をDiscord風に白紙の画像へ合成して返します。カスタム絵文字と静止画スタンプにも対応し、長い本文は紙に収まるように自動で折り返し・省略します。

## Gemini超短文応答

[Google AI Studio](https://aistudio.google.com/apikey)でAPIキーを作り、`.env`の`GEMINI_API_KEY`に設定します。Botを再起動後、DiscordでBotを直接メンションします。

```text
@pengin 今日の天気どう？
```

## Discord参加時のXアカウント確認

`X_VERIFICATION_*` を設定すると、対象サーバーへの参加時にBotがX OAuth 2.0（Authorization Code + PKCE）の確認リンクをDMします。管理者が`/verify`を実行したチャンネルには、誰でも見られる常設の認証パネルが投稿されます。パネルの`認証へGO`を押すと、個別のOAuth URLは押した本人にだけ非公開表示されます。確認完了後、管理者用チャンネルへ通知し、管理者が「Approve and grant role」を押したときだけ指定ロールを付与します。これはXアカウントを操作できることの確認であり、法的な身元確認ではありません。

GitHub Pagesは静的ホスティングなので、`home.penginkun.net` を案内ページとして使うことはできますが、XのClient SecretをGitHub Pagesへ置いたり、そこで認可コードを交換したりはできません。推奨構成は `auth.penginkun.net/x/callback` をCloudflare TunnelやリバースプロキシでBotの `127.0.0.1:8788` へ転送する構成です。`home.penginkun.net/x/callback` を使う場合も、そのパスが同じBotバックエンドへ転送される必要があります。

X Developer Portalには、`.env` の `X_VERIFICATION_REDIRECT_URI` と完全一致するHTTPS Callback URIを登録し、`users.read` スコープを有効にしてください。Bot側にはServer Members Intent、Manage Roles権限、Botの最高ロールより下にある管理権限を持たない付与対象ロールが必要です。管理者が`/verify`でパネルを投稿するにはManage Roles権限が必要で、投稿先は`@everyone`から見えるチャンネルにしてください。管理者通知チャンネルは`@everyone`と一般ロールから見えないプライベートチャンネルにし、BotにView Channel / Send Messages / Embed Links権限を与えてください。アクセストークンは保存しません。

最小設定例:

```env
X_VERIFICATION_CLIENT_ID=...
X_VERIFICATION_CLIENT_SECRET=...
X_VERIFICATION_REDIRECT_URI=https://auth.penginkun.net/x/callback
X_VERIFICATION_GUILD_ID=対象サーバーID
X_VERIFICATION_ROLE_ID=付与するロールID
X_VERIFICATION_NOTIFICATION_CHANNEL_ID=管理者通知チャンネルID
X_VERIFICATION_GUIDE_CHANNEL_ID=DM失敗時の案内チャンネルID
X_VERIFICATION_CALLBACK_HOST=127.0.0.1
X_VERIFICATION_CALLBACK_PORT=8788
```

## Discord VC音声会話

Botがいるサーバーのボイスチャンネルで、参加者が`/vc join`を実行すると、Botがそのチャンネルへ参加します。発話が終わると、Discord音声をGeminiで文字起こしし、既存のAIルーター（Codex OAuthが利用可能なら優先）で短く応答を生成し、VOICEVOXで読み上げます。`/vc channel #channel`でテキスト入力チャンネルを1つ選ぶと、そのチャンネルの発言だけをAIが認識し、テキスト返信とVC読み上げを行います。`/vc leave`で退出します。

事前にBot側の`.env`へ`GEMINI_API_KEY`を設定し、同じPCでVOICEVOX Engineを起動してください。VOICEVOXのURLは`VOICEVOX_URL`（既定値`http://127.0.0.1:50021`）、話者は`VOICEVOX_SPEAKER_ID`（既定値`3`）、VC用STTモデルは任意で`VC_TRANSCRIBE_MODEL`から変更できます。BotにはGuild Voice States intentと、対象VCのConnect / Speak権限が必要です。

VC機能はDiscordのDAVE/E2EE対応のためNode.js 22.12以上が必要です。`@discordjs/voice`がDAVE対応の音声接続を処理します。

最初の実装は、発話区間を無音約850msで区切り、同時には1人ずつ処理します。音声受信はDiscord側の仕様上、ネットワークやクライアント状態によって不安定になり得るため、失敗時はBot全体を停止せず、その発話だけをログに記録します。

Geminiが同じ言語で一文だけ、短く返信します。ユーザーごとに5秒の連続実行制限があります。

AIがチャンネルで応答するときは、現在のメッセージより前にある同一チャンネルの直近30件（発言者を問わず）を会話コンテキストとして参照します。履歴を取得できない場合は、従来の保存済みコンテキストを使用します。

ユーザーが`1068329268397998161の履歴を取得して傾向をまとめて`のように依頼すると、Botは現在のguild内で閲覧権限とメッセージ履歴の読み取り権限があるチャンネルを最大12個調べ、対象ユーザーの発言だけをAIの参考情報として渡します。1チャンネル最大50件、回答に渡す発言は最大30件です。履歴検索は全ユーザーが利用できますが、権限のないチャンネルや別guildの履歴は取得しません。

- 5秒以内の連投: `連投制限中。5秒待って。`
- Gemini APIの利用上限: `Geminiの利用上限です。後で試して。`
- Gemini APIの混雑: `Geminiが混雑中。後で試して。`
- 未成年を含む性的内容や露骨な性的要求: 専用メッセージで拒否

通常の性教育・医療に関する質問は拒否対象にせず、Gemini APIの安全フィルターも併用します。

## Groqへの自動切り替え

[Groq Console](https://console.groq.com/keys)でAPIキーを作り、`.env`へ設定します。

```env
GROQ_API_KEY=取得したGroq APIキー
GROQ_MODEL=openai/gpt-oss-20b
AI_PROVIDER=groq
GEMINI_SOFT_RPM=8
GEMINI_FALLBACK_MINUTES=15
```

`AI_PROVIDER=groq`にすると、Geminiの上限を待たずGroqを主プロバイダーとして使用します。`gemini`または未設定の場合はGeminiを主に使い、上限時のみGroqへ自動切り替えします。

Geminiへのリクエストが直近1分で8回に達すると、上限へ近づいたものとしてGroqを優先します。Geminiが429または503を返した場合は、その質問を即座にGroqで再実行し、その後15分間はGroqを優先します。切り替え状況は`[ai] provider=... reason=...`ログで確認できます。

## 転送先の変更

サーバー管理権限を持つユーザーが、Discord内で次のコマンドを実行します。

```text
/chanel tensousaki channel: チャンネル名
```

このスラッシュコマンドはBot起動後、サーバー内のコマンド候補に表示されます。

```text
./chanel tensousaki チャンネル名
```

`./channel tensousaki チャンネル名`も使えます。チャンネルメンション（`#channel`）やチャンネルIDでの指定にも対応しています。変更内容はサーバーごとに保存され、再起動後も維持されます。

スラッシュコマンドが表示されない場合は、Botが正常にログインできていることを確認し、招待URLに`applications.commands`スコープを含めてBotを再招待してください。

転送されない場合は、`DEBUG_BOT_MESSAGES=1`にして再起動すると、Botが受け取ったBotメッセージの送信者ID・添付数・埋め込み数を確認できます。

## 確認

```powershell
npm.cmd test
```

Botを動かしている間、コンソールに`[relay] ... image(s) forwarded`が表示されれば転送成功です。

## コミュニティ機能

サーバー内では次のslash commandを利用できます。

```text
/help
/ahoo news [topic]
/poll question option1 option2 [option3] [option4] [option5] [duration]
/remind set minutes text
/remind list
/remind cancel id
/stats server
/stats me
/quotes [count]
/summarize [count]
/model provider name
/ai battle st
/ai battle stop
/stop
/open
/relay channel channel_id
/memory remember text
/memory list
/memory forget id
  Only Discord user `1068329268397998161` can use the `/memory` commands.
  ペルソナ切り替え: pda_founder
  ペルソナ切り替え: danjo_towa
  ペルソナ切り替え: 壇上十和
```

- `/poll` はボタン式投票を作成し、期限が来ると自動終了します。
- `/remind` は指定した分数後に元のチャンネルへ通知します。送信できない場合はDMを試します。
- `/stats` はサーバーまたは自分の活動統計を表示します。
- `/quotes` は最近成功した画像リレーへのリンクを表示します。
- `/stop` と `/open` はユーザーID `1068329268397998161` だけが実行できます。`/stop` はAIの自動返信だけを`/open`まで停止します。メンション返信、スラッシュコマンド、メディア処理、MIQ画像転送などは継続し、`/open` で自動返信を即時に再開します。
- `/relay channel channel_id` はユーザーID `1068329268397998161` だけが実行でき、現在のguildの転送先チャンネルをDiscordチャンネルIDで変更します。対象チャンネルの実在性・送信権限はBot側で検証されます。
- `/ai battle st` はユーザーID `1068329268397998161` だけが開始でき、Bot `1526014470806048839` を必ずメンションして討論します。`/ai battle stop` は誰でも停止できます。
- OpenAIは、このPCで`codex login`済みならChatGPT/Codex OAuthを優先します。APIキーをDiscordへ投稿する必要はありません。
- OAuthで使うモデルは`CODEX_MODEL`で変更できます（未設定時は`gpt-5.6-luna`、推論強度は`low`）。従来の`OPENAI_MODEL`はAPIキー利用時だけ参照します。
- Codex OAuth経由ではWeb検索だけを許可し、ファイル操作・コマンド実行・書き込みは禁止します。
- Codex Agentは所有者以外の質問・依頼・困りごと・調査/要約指示にも自動返信します。挨拶や雑談は無視し、雑談でも揮発性メモリ内の直近会話と関連度が高い場合だけ反応します。会話コンテキストはBot稼働中だけの揮発性メモリに保持し、ファイルへ保存しません。
- Agentの履歴はチャンネル全体の履歴に加えて、現在の発言者本人の履歴を別枠で取得します。Discord APIの1回100件制限はページングして処理します。
- 所有者がBotへのメンションで `save skill 名前 | 説明 | 手順` と送ると、再利用可能なAgent Skillとして自動保存します。保存済みSkillは依頼との関連度が高い場合だけ参照データとしてAIへ渡されます。管理は `/skill save`、`/skill list`、`/skill delete` で行えます。
- BotへのメンションまたはBotへの返信に音声・動画ファイルを1つ添付すると、`mp3`、`mp4`、`gif`、`info`、`trim <開始秒> <継続秒>` の固定メディアタスクを自律実行します。処理は90秒、入力25MB、出力8MBまでです。
- メディアタスクはDiscord CDNの添付だけを対象にし、任意URLや任意シェルコマンドは実行しません。`ffmpeg` / `ffprobe` がPATHにない場合は `.env` の `FFMPEG_BIN` / `FFPROBE_BIN` に実行ファイルのパスを設定してください。
- AIの画像コンテキストはDiscordの画像添付だけを読み込みます。一般ユーザーは3分に1回、ユーザーID `1068329268397998161` は無制限です。音声・動画は、上記の明示的なメディアタスクでのみ処理します。
- Botへのメンションに公開XポストのURLを含めると、`api.fxtwitter.com`から本文・投稿者・日時・反応数・引用ポストを取得してAIへ渡します（1回最大3件、X側の画像ファイルは読み込みません）。
- Web検索結果で`x.com`または`twitter.com`の投稿URLを見つけた場合も、対応する`api.fxtwitter.com`のJSON URLへ置換して読み込みます。
- Botへのメンションに一般のHTTPS URLを含めるとWeb Fetchで本文を取得します。公開IPのHTML・JSON・プレーンテキストだけを対象にし、JavaScript、画像、実行ファイル、ローカル／プライベートIP、1MB超のページは拒否します（最大3ページ）。
- 投票、リマインダー、統計、リレー履歴は `community-data.json` に保存されます。

## 注意

- `DISCORD_TOKEN`は他人に共有しないでください。
- 別サーバーへ転送する場合も、Botが転送先サーバーに参加し、対象チャンネルの閲覧・送信・ファイル添付権限を持っている必要があります。
- Make it a Quote側のBot IDが変わった場合は`QUOTE_BOT_ID`を更新してください。
