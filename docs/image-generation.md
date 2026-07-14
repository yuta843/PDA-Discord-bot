# Discord image generation

The `/image prompt:<text>` command generates one PNG with the selected image provider.

The admin can select it with `/model provider image:<provider>`:

- `cloudflare`: Cloudflare Workers AI using the low-cost `@cf/black-forest-labs/flux-1-schnell` model.
- `codex`: Codex OAuth built-in image generation using GPT Image 2. This consumes the signed-in Codex account's usage limits.

Each Discord user can generate up to 5 images per day in Japan time. User ID `1068329268397998161` is unlimited. Usage for limited users is persisted in `image-generation-usage.json`, which is ignored by Git. Failed requests refund the reserved daily slot.

## Environment variables

Create a Cloudflare API token with Workers AI access and set:

```dotenv
CLOUDFLARE_ACCOUNT_ID=your_cloudflare_account_id
CLOUDFLARE_API_TOKEN=your_cloudflare_api_token
```

The bot keeps the token server-side and sends generated images directly to Discord. The bot must be restarted by the operator after adding the variables so Discord can register `/image` and load the settings.

Codex image generation requires the bot host to be logged in with `codex login` using ChatGPT/Codex OAuth. The bot invokes the local Codex CLI with only the image-generation capability enabled and collects the generated PNG; it does not use an OpenAI API key for this provider.

The free Cloudflare allocation is account-wide, so the per-user limit does not prevent the provider's own daily quota from being reached when many users generate images at once.
