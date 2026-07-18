import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

const SPOTIFY_AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_API_URL = "https://api.spotify.com/v1";
const SPOTIFY_SCOPE = "user-read-recently-played";
const DEFAULT_HISTORY_LIMIT = 10;
const MAX_HISTORY_LIMIT = 50;
const STATE_TTL_MS = 10 * 60 * 1000;

class SpotifyError extends Error {
  constructor(message, { status = null, code = null } = {}) {
    super(message);
    this.name = "SpotifyError";
    this.status = status;
    this.code = code;
  }
}

class SpotifyNotConfiguredError extends SpotifyError {}

class SpotifyAuthorizationRequiredError extends SpotifyError {}

function clampHistoryLimit(value) {
  const parsed = Number.parseInt(String(value ?? DEFAULT_HISTORY_LIMIT), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_HISTORY_LIMIT;
  return Math.min(MAX_HISTORY_LIMIT, Math.max(1, parsed));
}

function loadTokenStore(tokenPath) {
  if (!tokenPath || !existsSync(tokenPath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(tokenPath, "utf8"));
    return parsed && typeof parsed === "object" && parsed.users && typeof parsed.users === "object"
      ? parsed.users
      : {};
  } catch {
    return {};
  }
}

function saveTokenStore(tokenPath, users) {
  if (!tokenPath) return;
  mkdirSync(dirname(tokenPath), { recursive: true });
  writeFileSync(
    tokenPath,
    `${JSON.stringify({ users }, null, 2)}\n`,
    "utf8",
  );
}

function createBasicAuth(clientId, clientSecret) {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

function getApiError(data, fallback) {
  if (typeof data?.error === "string") {
    return data.error_description ? `${data.error}: ${data.error_description}` : data.error;
  }
  if (typeof data?.error?.message === "string") return data.error.message;
  if (typeof data?.message === "string") return data.message;
  return fallback;
}

function escapeDiscordText(value) {
  return String(value ?? "")
    .replaceAll("\\", "\\\\")
    .replaceAll("`", "\\`")
    .replaceAll("*", "\\*")
    .replaceAll("_", "\\_")
    .replaceAll("~", "\\~")
    .replaceAll("|", "\\|");
}

function truncateText(value, maxLength) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function formatSpotifyHistory(items, startIndex = 0) {
  const lines = items.map((item, index) => {
    const track = item?.track ?? {};
    const title = escapeDiscordText(track.name || "不明な曲");
    const artists = escapeDiscordText(
      Array.isArray(track.artists) && track.artists.length > 0
        ? track.artists.map((artist) => artist.name).filter(Boolean).join(", ")
        : "不明なアーティスト",
    );
    const spotifyUrl = track.external_urls?.spotify ??
      (track.id ? `https://open.spotify.com/track/${encodeURIComponent(track.id)}` : null);
    const link = spotifyUrl ? ` <${spotifyUrl}>` : "";
    const playedAt = Date.parse(item?.played_at ?? "");
    const relativeTime = Number.isFinite(playedAt)
      ? ` · <t:${Math.floor(playedAt / 1000)}:R>`
      : "";
    return `${startIndex + index + 1}. **${title}** — ${artists}${relativeTime}${link}`;
  });

  return truncateText(
    lines.length > 0 ? lines.join("\n") : "最近の再生履歴は見つかりませんでした。",
    3900,
  );
}

class SpotifyService {
  constructor({
    clientId,
    clientSecret,
    redirectUri,
    tokenPath = null,
    fetchImpl = globalThis.fetch,
    now = () => Date.now(),
    stateTtlMs = STATE_TTL_MS,
  } = {}) {
    this.clientId = clientId?.trim() ?? "";
    this.clientSecret = clientSecret?.trim() ?? "";
    this.redirectUri = redirectUri?.trim() ?? "";
    this.tokenPath = tokenPath;
    this.fetch = fetchImpl;
    this.now = now;
    this.stateTtlMs = stateTtlMs;
    this.users = loadTokenStore(tokenPath);
    this.pendingStates = new Map();
    this.callbackServer = null;
  }

  isConfigured() {
    return Boolean(this.clientId && this.clientSecret && this.redirectUri && this.fetch);
  }

  ensureConfigured() {
    if (!this.isConfigured()) {
      throw new SpotifyNotConfiguredError(
        "Spotify is not configured. Set SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, and SPOTIFY_REDIRECT_URI.",
      );
    }
  }

  createAuthorizationUrl(discordUserId) {
    this.ensureConfigured();
    const state = randomBytes(24).toString("hex");
    this.pendingStates.set(state, {
      discordUserId,
      expiresAt: this.now() + this.stateTtlMs,
    });

    const url = new URL(SPOTIFY_AUTHORIZE_URL);
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: this.clientId,
      scope: SPOTIFY_SCOPE,
      redirect_uri: this.redirectUri,
      state,
    }).toString();
    return url.toString();
  }

  async handleCallback(requestUrl) {
    this.ensureConfigured();
    const url = new URL(requestUrl, this.redirectUri);
    const state = url.searchParams.get("state");
    const pending = state ? this.pendingStates.get(state) : null;
    if (state) this.pendingStates.delete(state);

    if (!pending || pending.expiresAt < this.now()) {
      throw new SpotifyError("Spotify authorization state is invalid or expired.", { status: 400 });
    }
    if (url.searchParams.get("error")) {
      throw new SpotifyError("Spotify authorization was cancelled.", { status: 400 });
    }

    const code = url.searchParams.get("code");
    if (!code) throw new SpotifyError("Spotify authorization code is missing.", { status: 400 });

    const token = await this.exchangeCode(code);
    const profile = await this.fetchProfile(token.access_token);
    const previous = this.users[pending.discordUserId];
    const refreshToken = token.refresh_token || previous?.refreshToken;
    if (!refreshToken) {
      throw new SpotifyError("Spotify did not return a refresh token.", { status: 502 });
    }

    this.users[pending.discordUserId] = {
      refreshToken,
      accessToken: token.access_token,
      expiresAt: this.now() + (Number(token.expires_in) || 3600) * 1000,
      spotifyUserId: profile.id,
      displayName: profile.display_name || profile.id || "Spotify user",
      connectedAt: new Date(this.now()).toISOString(),
    };
    this.save();
    return {
      discordUserId: pending.discordUserId,
      displayName: this.users[pending.discordUserId].displayName,
    };
  }

  async exchangeCode(code) {
    const response = await this.fetch(SPOTIFY_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: createBasicAuth(this.clientId, this.clientSecret),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: this.redirectUri,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new SpotifyError(getApiError(data, "Spotify token exchange failed."), {
        status: response.status,
        code: data?.error,
      });
    }
    return data;
  }

  async refreshAccessToken(discordUserId, record) {
    const response = await this.fetch(SPOTIFY_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: createBasicAuth(this.clientId, this.clientSecret),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: record.refreshToken,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      if (data?.error === "invalid_grant") {
        this.disconnect(discordUserId);
        throw new SpotifyAuthorizationRequiredError(
          "Spotify authorization has expired and must be renewed.",
          { status: response.status, code: data.error },
        );
      }
      throw new SpotifyError(getApiError(data, "Spotify token refresh failed."), {
        status: response.status,
        code: data?.error,
      });
    }

    const updated = {
      ...record,
      accessToken: data.access_token,
      expiresAt: this.now() + (Number(data.expires_in) || 3600) * 1000,
      refreshToken: data.refresh_token || record.refreshToken,
    };
    this.users[discordUserId] = updated;
    this.save();
    return updated;
  }

  async getAccessToken(discordUserId, { forceRefresh = false } = {}) {
    this.ensureConfigured();
    const record = this.users[discordUserId];
    if (!record?.refreshToken) {
      throw new SpotifyAuthorizationRequiredError("Spotify account is not connected.", { status: 401 });
    }
    if (!forceRefresh && record.accessToken && record.expiresAt > this.now() + 60_000) {
      return record.accessToken;
    }
    const updated = await this.refreshAccessToken(discordUserId, record);
    return updated.accessToken;
  }

  async fetchProfile(accessToken) {
    const response = await this.fetch(`${SPOTIFY_API_URL}/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await response.json();
    if (!response.ok) {
      throw new SpotifyError(getApiError(data, "Spotify profile request failed."), {
        status: response.status,
        code: data?.error?.status,
      });
    }
    return data;
  }

  async getRecentlyPlayed(discordUserId, limit = DEFAULT_HISTORY_LIMIT) {
    const safeLimit = clampHistoryLimit(limit);
    let accessToken = await this.getAccessToken(discordUserId);
    const request = () => this.fetch(
      `${SPOTIFY_API_URL}/me/player/recently-played?limit=${safeLimit}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    let response = await request();
    if (response.status === 401) {
      accessToken = await this.getAccessToken(discordUserId, { forceRefresh: true });
      response = await request();
    }
    const data = await response.json();
    if (!response.ok) {
      throw new SpotifyError(getApiError(data, "Spotify history request failed."), {
        status: response.status,
        code: data?.error?.status,
      });
    }
    return data.items ?? [];
  }

  getConnection(discordUserId) {
    const record = this.users[discordUserId];
    if (!record) return null;
    return {
      displayName: record.displayName,
      spotifyUserId: record.spotifyUserId,
      connectedAt: record.connectedAt,
    };
  }

  disconnect(discordUserId) {
    if (!this.users[discordUserId]) return false;
    delete this.users[discordUserId];
    this.save();
    return true;
  }

  save() {
    saveTokenStore(this.tokenPath, this.users);
  }

  async startCallbackServer({ host = "127.0.0.1", port = null } = {}) {
    this.ensureConfigured();
    if (this.callbackServer) return this.callbackServer;
    const redirect = new URL(this.redirectUri);
    const callbackPath = redirect.pathname || "/";
    const listenPort = port || Number.parseInt(redirect.port, 10) || 8787;

    const server = createServer((request, response) => {
      const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      if (requestUrl.pathname !== callbackPath) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Not found");
        return;
      }

      void this.handleCallback(requestUrl.toString())
        .then(({ displayName }) => {
          response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          response.end(
            `<html><meta charset="utf-8"><title>Spotify連携完了</title><body><h1>Spotify連携が完了しました</h1><p>${escapeHtml(displayName)} のアカウントをDiscord botに連携しました。Discordに戻って <code>/spotify history</code> を実行してください。</p></body></html>`,
          );
        })
        .catch((error) => {
          const status = error.status && error.status >= 400 && error.status < 600 ? error.status : 500;
          response.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
          response.end(
            `<html><meta charset="utf-8"><title>Spotify連携エラー</title><body><h1>Spotify連携に失敗しました</h1><p>${escapeHtml(error.message)}</p><p>Discordに戻って、もう一度 <code>/spotify connect</code> を実行してください。</p></body></html>`,
          );
        });
    });

    await new Promise((resolve, reject) => {
      const onError = (error) => {
        server.removeListener("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.removeListener("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(listenPort, host);
    });
    this.callbackServer = server;
    return server;
  }

  close() {
    this.callbackServer?.close();
    this.callbackServer = null;
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export {
  DEFAULT_HISTORY_LIMIT,
  MAX_HISTORY_LIMIT,
  SPOTIFY_SCOPE,
  SpotifyAuthorizationRequiredError,
  SpotifyError,
  SpotifyNotConfiguredError,
  SpotifyService,
  clampHistoryLimit,
  formatSpotifyHistory,
};
