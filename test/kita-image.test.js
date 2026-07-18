import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_KITA_IMAGE_INTERVAL_MS,
  KITA_SEARCH_TIMEOUT_MS,
  downloadKitaImage,
  findKitaImagePost,
  isAllowedKitaImageUrl,
  normalizeKitaXPostUrl,
  parseKitaImageIntervalMs,
  sendKitaImagePost,
} from "../src/kita-image.js";

test("normalizes X search results to an attributed FxTwitter post", () => {
  assert.equal(
    normalizeKitaXPostUrl("result: https://x.com/artist/status/12345"),
    "https://fxtwitter.com/artist/status/12345",
  );
  assert.equal(normalizeKitaXPostUrl("https://example.test/status/12345"), null);
});

test("allows only HTTPS X image hosts", () => {
  assert.equal(isAllowedKitaImageUrl("https://pbs.twimg.com/media/test.jpg"), true);
  assert.equal(isAllowedKitaImageUrl("http://pbs.twimg.com/media/test.jpg"), false);
  assert.equal(isAllowedKitaImageUrl("https://example.test/media/test.jpg"), false);
});

test("parses a safe periodic posting interval", () => {
  assert.equal(parseKitaImageIntervalMs(), DEFAULT_KITA_IMAGE_INTERVAL_MS);
  assert.equal(parseKitaImageIntervalMs("2"), 2 * 60 * 60 * 1000);
  assert.equal(parseKitaImageIntervalMs("0.1"), 30 * 60 * 1000);
  assert.equal(parseKitaImageIntervalMs("nope"), DEFAULT_KITA_IMAGE_INTERVAL_MS);
});

test("searches X and selects a downloadable image", async () => {
  let receivedOptions;
  const result = await findKitaImagePost({
    searchImpl: async (_prompt, options) => {
      receivedOptions = options;
      return "https://x.com/artist/status/12345";
    },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        code: 200,
        tweet: { media: { photos: [{ url: "https://pbs.twimg.com/media/test.jpg" }] } },
      }),
    }),
  });
  assert.deepEqual(result, {
    postUrl: "https://fxtwitter.com/artist/status/12345",
    imageUrl: "https://pbs.twimg.com/media/test.jpg",
  });
  assert.equal(receivedOptions.timeoutMs, KITA_SEARCH_TIMEOUT_MS);
});

test("rejects an X search result without a downloadable image", async () => {
  await assert.rejects(
    findKitaImagePost({
      searchImpl: async () => "https://x.com/artist/status/12345",
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ code: 200, tweet: { media: {} } }),
      }),
    }),
    /no downloadable image/,
  );
});

test("downloads an X image with a Discord-safe file name", async () => {
  const result = await downloadKitaImage(
    "https://pbs.twimg.com/media/test.jpg",
    async () => ({
      ok: true,
      headers: { get: () => "image/jpeg" },
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }),
  );
  assert.deepEqual(result, { image: Buffer.from([1, 2, 3]), fileName: "kitachan.jpg" });
});

test("uploads the searched image and keeps the source post link", async () => {
  const sent = [];
  const client = {
    channels: {
      fetch: async () => ({
        isTextBased: () => true,
        send: async (payload) => sent.push(payload),
      }),
    },
  };
  const fetchImpl = async (url) => {
    if (url.startsWith("https://api.fxtwitter.com/")) {
      return {
        ok: true,
        json: async () => ({
          code: 200,
          tweet: { media: { all: [{ type: "photo", url: "https://pbs.twimg.com/media/test.jpg" }] } },
        }),
      };
    }
    return {
      ok: true,
      headers: { get: () => "image/jpeg" },
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    };
  };

  const url = await sendKitaImagePost(client, {
    searchImpl: async () => "https://twitter.com/artist/status/12345",
    fetchImpl,
  });

  assert.equal(url, "https://fxtwitter.com/artist/status/12345");
  assert.match(sent[0].content, /fxtwitter\.com\/artist\/status\/12345/);
  assert.deepEqual(sent[0].files[0], {
    attachment: Buffer.from([1, 2, 3]),
    name: "kitachan.jpg",
  });
});
