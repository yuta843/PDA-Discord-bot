# Oracle Cloud で Discord bot を動かす

この手順は Discord bot 本体用です。`npm start` は `package.json` がある
プロジェクトディレクトリで実行してください。`/home/ubuntu` で実行すると、
今回のように `ENOENT: ... /home/ubuntu/package.json` になります。

## 初回セットアップ

GitHub から取得する場合は、現在使いたいブランチを指定します。

```bash
cd /home/ubuntu
git clone --branch agent/pda-discord-bot-pr https://github.com/yuta843/PDA-Discord-bot.git PDA-Discord-bot
cd /home/ubuntu/PDA-Discord-bot
```

すでに clone 済みなら、clone は繰り返さず次だけ実行します。

```bash
cd /home/ubuntu/PDA-Discord-bot
git status
```

Node.js は 22.12 以上が必要です。Oracle VM では Node.js 22 系を使用してください。

```bash
node -v
npm -v
```

Node.js が未導入または古い場合:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

依存関係と環境変数を準備します。

```bash
cd /home/ubuntu/PDA-Discord-bot
npm ci --omit=dev
cp deploy/oracle-cloud/bot.env.example .env
chmod 600 .env
nano .env
```

最低限、`.env` の次の2つは実値に置き換えます。

```env
DISCORD_TOKEN=Discord bot token
TARGET_CHANNEL_ID=転送先チャンネルID
```

AI返信を使う場合は `GEMINI_API_KEY` または `GROQ_API_KEY` も設定します。
Oracle のヘッドレス環境では、ローカル PC の Codex OAuth 状態をコピーするより、
API キー方式を使う方が運用しやすいです。

## 起動確認

まず一度だけ前景で起動し、Discord にログインできることを確認します。

```bash
cd /home/ubuntu/PDA-Discord-bot
npm start
```

成功時はログに `[ready] Logged in as ...` と
`[ready] Slash commands synchronized for guild ...` が出ます。
停止は `Ctrl+C` です。

## systemd で常駐させる

このリポジトリのサービス定義を登録します。

```bash
sudo cp /home/ubuntu/PDA-Discord-bot/deploy/oracle-cloud/miq-isou.service /etc/systemd/system/miq-isou.service
command -v node
```

`command -v node` の結果が `/usr/bin/node` でなければ、サービス定義の
`ExecStart=` をその絶対パスに変更してから登録し直してください。

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now miq-isou
sudo systemctl status miq-isou --no-pager
```

ログを見るには:

```bash
sudo journalctl -u miq-isou -f
```

更新時は次の順で再起動します。

```bash
cd /home/ubuntu/PDA-Discord-bot
git pull
npm ci --omit=dev
sudo systemctl restart miq-isou
```

`DISCORD_TOKEN` などを変更した場合も、`sudo systemctl restart miq-isou` が必要です。

## Oracle のネットワーク設定

Discord Gateway への接続は VM から外向きに行うため、bot だけなら HTTP 用の
受信ポートを開ける必要はありません。SSH の 22 番だけを自分の接続元に制限し、
不要な受信ルールは追加しない構成で動きます。

Spotify の `/spotify connect` を Oracle 上で使う場合だけ、別途公開 HTTPS の
callback URI、リバースプロキシ、Spotify 側の Redirect URI 登録が必要です。

## GitHub push で自動デプロイする

`.github/workflows/deploy-oracle.yml` は、`agent/pda-discord-bot-pr` または
`main` への push を検知し、Oracle VM へ SSH 接続して次を実行します。

1. 対象ブランチを fast-forward で更新
2. `npm ci --omit=dev`
3. `miq-isou` systemd サービスを再起動
4. サービスが active であることを確認

### Oracle VM で一度だけ行う設定

`ubuntu` ユーザーが、パスワード入力なしで bot の再起動だけを実行できるようにします。

```bash
sudo visudo -f /etc/sudoers.d/miq-isou-deploy
```

次の1行を保存します。

```text
ubuntu ALL=(root) NOPASSWD: /usr/bin/systemctl restart miq-isou, /usr/bin/systemctl is-active miq-isou
```

GitHub Actions 用の SSH 公開鍵を `/home/ubuntu/.ssh/authorized_keys` に追加します。
秘密鍵は VM やリポジトリに置かず、GitHub Secret `ORACLE_SSH_KEY` に登録します。

### GitHub Secrets

リポジトリの **Settings → Secrets and variables → Actions** に次を登録します。

- `ORACLE_HOST`: Oracle VM のパブリックIPまたはホスト名
- `ORACLE_USER`: `ubuntu`
- `ORACLE_PORT`: SSHポート。通常は `22`
- `ORACLE_SSH_KEY`: Actions 用秘密鍵の全文
- `ORACLE_KNOWN_HOSTS`: `ssh-keyscan -H <VMのIP>` の出力。未設定でも動きますが、設定を推奨します

以後、対象ブランチへ push するだけで VM 側の更新と bot 再起動まで自動で行われます。
