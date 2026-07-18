import assert from "node:assert/strict";
import test from "node:test";
import {
  SpotifyAuthorizationRequiredError,
  SpotifyService,
  clampHistoryLimit,
  formatSpotifyHistory,
} from "../src/spotify.js";

function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  };
}

test("clampHistoryLimit keeps requests within Spotify's supported range", () => {
  assert.equal(clampHistoryLimit(undefined), 10);
  assert.equal(clampHistoryLimit(0), 1);
  assert.equal(clampHistoryLimit(12), 12);
  assert.equal(clampHistoryLimit(999), 50);
  assert.equal(clampHistoryLimit("not a number"), 10);
});

test("formatSpotifyHistory creates safe, clickable Discord history text", () => {
  const description = formatSpotifyHistory([
    {
      played_at: "2026-07-14T00:00:00.000Z",
      track: {
        id: "track-1",
        name: "A *song*",
        artists: [{ name: "An_artist" }],
        external_urls: { spotify: "https://open.spotify.com/track/track-1" },
      },
    },
  ]);

  assert.match(description, /A \\\*song\\\*/);
  assert.match(description, /An\\_artist/);
  assert.match(description, /https:\/\/open\.spotify\.com\/track\/track-1/);
  assert.match(description, /<t:\d+:R>/);
  assert.match(
    formatSpotifyHistory([{ track: { name: "Page two" } }], 5),
    /^6\./,
  );
});

test("SpotifyService exchanges OAuth code and fetches a user's history", async () => {
  const calls = [];
  const service = new SpotifyService({
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectUri: "http://127.0.0.1:8787/spotify/callback",
    now: () => Date.parse("2026-07-14T00:00:00.000Z"),
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (url === "https://accounts.spotify.com/api/token") {
        return jsonResponse({
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: 3600,
        });
      }
      if (url === "https://api.spotify.com/v1/me") {
        return jsonResponse({ id: "spotify-user", display_name: "Miq" });
      }
      if (url.startsWith("https://api.spotify.com/v1/me/player/recently-played")) {
        return jsonResponse({ items: [{ track: { name: "Test song" } }] });
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  });

  const authorizationUrl = new URL(service.createAuthorizationUrl("discord-user"));
  const result = await service.handleCallback(
    `http://127.0.0.1:8787/spotify/callback?code=auth-code&state=${authorizationUrl.searchParams.get("state")}`,
  );

  assert.deepEqual(result, { discordUserId: "discord-user", displayName: "Miq" });
  assert.deepEqual(service.getConnection("discord-user"), {
    displayName: "Miq",
    spotifyUserId: "spotify-user",
    connectedAt: "2026-07-14T00:00:00.000Z",
  });

  const history = await service.getRecentlyPlayed("discord-user", 5);
  assert.deepEqual(history, [{ track: { name: "Test song" } }]);
  assert.equal(calls.at(-1).options.headers.Authorization, "Bearer access-token");
});

test("SpotifyService asks users to reconnect after an invalid refresh token", async () => {
  let now = 0;
  const service = new SpotifyService({
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectUri: "http://127.0.0.1:8787/spotify/callback",
    now: () => now,
    fetchImpl: async () => jsonResponse({ error: "invalid_grant" }, 400),
  });

  service.users["discord-user"] = {
    refreshToken: "expired-refresh-token",
    accessToken: "expired-access-token",
    expiresAt: 0,
  };
  now = 120_000;

  await assert.rejects(
    () => service.getRecentlyPlayed("discord-user"),
    SpotifyAuthorizationRequiredError,
  );
  assert.equal(service.getConnection("discord-user"), null);
});
