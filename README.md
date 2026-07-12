# Make it a Quote image relay bot

`Make it a Quote` が生成した画像を、指定したDiscordチャンネルへ自動転送するBotです。Botが参加している別サーバーから、共通の転送先チャンネルへ集約することもできます。

## セットアップ

1. [Discord Developer Portal](https://discord.com/developers/applications)でBotを作り、Tokenを取得する。
2. Botを対象サーバーへ招待する。必要な権限は次の通り。
   - 転送元: View Channel / Read Message History
   - 転送先: View Channel / Send Messages / Attach Files
   - Botの設定で「Message Content Intent」を有効にする。
3. Discordのユーザー設定からDeveloper Modeを有効にし、転送先チャンネルを右クリックして「チャンネルIDをコピー」する。
4. `.env.example`を`.env`にコピーして、`DISCORD_TOKEN`と`TARGET_CHANNEL_ID`を設定する。
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

## Gemini超短文応答

[Google AI Studio](https://aistudio.google.com/apikey)でAPIキーを作り、`.env`の`GEMINI_API_KEY`に設定します。Botを再起動後、DiscordでBotを直接メンションします。

```text
@pengin 今日の天気どう？
```

Geminiが同じ言語で一文だけ、短く返信します。ユーザーごとに5秒の連続実行制限があります。

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
GEMINI_SOFT_RPM=8
GEMINI_FALLBACK_MINUTES=15
```

Geminiへのリクエストが直近1分で8回に達すると、上限へ近づいたものとしてGroqを優先します。Geminiが429または503を返した場合は、その質問を即座にGroqで再実行し、その後15分間はGroqを優先します。切り替え状況は`[ai] provider=... reason=...`ログで確認できます。

## 午前1時の自動スリープ

Windowsのローカル時刻で午前1時になったらBotを停止し、PCをスリープさせる設定です。

```env
SYSTEM_SLEEP_ENABLED=true
SYSTEM_SLEEP_TIME=01:00
```

起動ログの`[ready] Windows sleep scheduled:`で次回の実行日時を確認できます。スリープ解除後もBotは停止したままなので、再開する場合は`npm.cmd start`を実行してください。無効化する場合は`SYSTEM_SLEEP_ENABLED=false`に変更します。

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

## 注意

- `DISCORD_TOKEN`は他人に共有しないでください。
- 別サーバーへ転送する場合も、Botが転送先サーバーに参加し、対象チャンネルの閲覧・送信・ファイル添付権限を持っている必要があります。
- Make it a Quote側のBot IDが変わった場合は`QUOTE_BOT_ID`を更新してください。
