import assert from "node:assert/strict";
import test from "node:test";
import {
  SPOTIFY_OEMBED_URL,
  SpotifyLinkError,
  extractSpotifyTrackUrl,
  fetchSpotifyTrackMetadata,
  isSpotifyImageUrl,
} from "../src/spotify-link.js";

test("extractSpotifyTrackUrl finds a track URL inside a message", () => {
  assert.equal(
    extractSpotifyTrackUrl(
      "この曲どう？ https://open.spotify.com/track/abc123?si=share-token",
    ),
    "https://open.spotify.com/track/abc123",
  );
});

test("extractSpotifyTrackUrl ignores non-track Spotify links", () => {
  assert.equal(
    extractSpotifyTrackUrl("https://open.spotify.com/album/album123"),
    null,
  );
  assert.equal(extractSpotifyTrackUrl("https://example.com/track/abc123"), null);
});

test("isSpotifyImageUrl allows Spotify CDN artwork only", () => {
  assert.equal(isSpotifyImageUrl("https://i.scdn.co/image/cover"), true);
  assert.equal(isSpotifyImageUrl("https://image-cdn-ak.spotifycdn.com/image/cover"), true);
  assert.equal(isSpotifyImageUrl("https://example.com/cover.jpg"), false);
});

test("fetchSpotifyTrackMetadata reads oEmbed track information", async () => {
  const calls = [];
  const metadata = await fetchSpotifyTrackMetadata(
    "https://open.spotify.com/track/abc123?si=share-token",
    async (url, options) => {
      calls.push({ url: url.toString(), options });
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            title: "Song title",
            author_name: "Artist name",
            thumbnail_url: "https://i.scdn.co/image/cover",
          };
        },
      };
    },
  );

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    `${SPOTIFY_OEMBED_URL}?url=https%3A%2F%2Fopen.spotify.com%2Ftrack%2Fabc123`,
  );
  assert.equal(calls[0].options.headers.accept, "application/json");
  assert.deepEqual(metadata, {
    title: "Song title",
    authorName: "Artist name",
    thumbnailUrl: "https://i.scdn.co/image/cover",
    providerUrl: "https://open.spotify.com/track/abc123",
  });
});

test("fetchSpotifyTrackMetadata reports Spotify request failures", async () => {
  await assert.rejects(
    fetchSpotifyTrackMetadata(
      "https://open.spotify.com/track/abc123",
      async () => ({ ok: false, status: 404 }),
    ),
    SpotifyLinkError,
  );
});
