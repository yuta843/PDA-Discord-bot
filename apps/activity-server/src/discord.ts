import type { AppConfig } from './config.js';

const instanceCache = new Map<string, { valid: boolean; expiresAt: number }>();

export async function exchangeDiscordCode(code: string, config: AppConfig) {
  const body = new URLSearchParams({
    client_id: config.DISCORD_CLIENT_ID,
    client_secret: config.DISCORD_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.DISCORD_REDIRECT_URI,
  });
  const response = await fetch(`${config.DISCORD_API_BASE_URL}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error('Discord OAuth token exchange failed');
  const json = (await response.json()) as { access_token?: unknown };
  if (typeof json.access_token !== 'string' || json.access_token.length < 10) {
    throw new Error('Discord OAuth response was invalid');
  }
  return json.access_token;
}
export async function fetchDiscordUser(accessToken: string, config: AppConfig) {
  const response = await fetch(`${config.DISCORD_API_BASE_URL}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error('Discord user lookup failed');
  const json = (await response.json()) as {
    id?: unknown;
    username?: unknown;
    global_name?: unknown;
    avatar?: unknown;
  };
  if (typeof json.id !== 'string' || typeof json.username !== 'string') {
    throw new Error('Discord user response was invalid');
  }
  return {
    id: json.id,
    username: json.username.slice(0, 100),
    displayName: (typeof json.global_name === 'string' && json.global_name.trim() ? json.global_name : json.username).slice(0, 100),
    avatar: typeof json.avatar === 'string' ? json.avatar.slice(0, 200) : null,
  };
}

export async function verifyActivityInstance(instanceId: string, config: AppConfig) {
  if (!config.DISCORD_BOT_TOKEN) return true;
  const cached = instanceCache.get(instanceId);
  if (cached && cached.expiresAt > Date.now()) return cached.valid;

  try {
    const response = await fetch(
      `${config.DISCORD_API_BASE_URL.replace(/\/api\/v10$/, '')}/api/applications/${config.DISCORD_CLIENT_ID}/activity-instances/${encodeURIComponent(instanceId)}`,
      {
        headers: { Authorization: `Bot ${config.DISCORD_BOT_TOKEN}` },
        signal: AbortSignal.timeout(5_000),
      },
    );
    const valid = response.ok;
    instanceCache.set(instanceId, { valid, expiresAt: Date.now() + 30_000 });
    return valid;
  } catch {
    return false;
  }
}
