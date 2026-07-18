import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  CLOUDFLARE_FLUX_MODEL,
  DEFAULT_IMAGE_DAILY_LIMIT,
  CloudflareImageError,
  CloudflareImageService,
  DailyImageUsageStore,
} from "../src/cloudflare-image.js";
import { IMAGE_UNLIMITED_USER_ID } from "../src/image-access.js";

test("DailyImageUsageStore allows five images and persists the daily limit", () => {
  const directory = mkdtempSync(join(tmpdir(), "miq-image-usage-"));
  const filePath = join(directory, "usage.json");
  const now = Date.parse("2026-07-14T12:00:00+09:00");

  try {
    const store = new DailyImageUsageStore({ filePath, limit: DEFAULT_IMAGE_DAILY_LIMIT });
    for (let index = 1; index <= DEFAULT_IMAGE_DAILY_LIMIT; index += 1) {
      const result = store.tryConsume("user-1", now);
      assert.equal(result.allowed, true);
      assert.equal(result.used, index);
      assert.equal(result.remaining, DEFAULT_IMAGE_DAILY_LIMIT - index);
    }
    assert.equal(store.tryConsume("user-1", now).allowed, false);

    const reloaded = new DailyImageUsageStore({ filePath, limit: DEFAULT_IMAGE_DAILY_LIMIT });
    assert.deepEqual(reloaded.getStatus("user-1", now), {
      allowed: false,
      dateKey: "2026-07-14",
      used: DEFAULT_IMAGE_DAILY_LIMIT,
      remaining: 0,
      limit: DEFAULT_IMAGE_DAILY_LIMIT,
    });
    assert.equal(reloaded.getStatus("user-1", Date.parse("2026-07-15T00:01:00+09:00")).allowed, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("DailyImageUsageStore can refund a failed reservation", () => {
  const directory = mkdtempSync(join(tmpdir(), "miq-image-usage-"));
  const filePath = join(directory, "usage.json");
  const now = Date.parse("2026-07-14T12:00:00+09:00");

  try {
    const store = new DailyImageUsageStore({ filePath, limit: DEFAULT_IMAGE_DAILY_LIMIT });
    const reservation = store.tryConsume("user-1", now);
    assert.equal(store.refund("user-1", reservation.dateKey), true);
    assert.equal(store.getStatus("user-1", now).used, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the configured owner bypasses the daily image limit", () => {
  const directory = mkdtempSync(join(tmpdir(), "miq-image-usage-"));
  const filePath = join(directory, "usage.json");
  const now = Date.parse("2026-07-14T12:00:00+09:00");

  try {
    const store = new DailyImageUsageStore({ filePath, limit: DEFAULT_IMAGE_DAILY_LIMIT });
    for (let index = 0; index < 20; index += 1) {
      const result = store.tryConsume(IMAGE_UNLIMITED_USER_ID, now);
      assert.equal(result.allowed, true);
      assert.equal(result.unlimited, true);
      assert.equal(result.remaining, null);
    }
    assert.equal(store.getStatus(IMAGE_UNLIMITED_USER_ID, now).used, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("CloudflareImageService calls the cheapest FLUX model and decodes the image", async () => {
  let request;
  const service = new CloudflareImageService({
    accountId: "account-1",
    apiToken: "token-1",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        async json() {
          return { success: true, result: Buffer.from("png-bytes").toString("base64") };
        },
      };
    },
  });

  const image = await service.generate("a tiny blue cat");

  assert.equal(request.url, `https://api.cloudflare.com/client/v4/accounts/account-1/ai/run/${CLOUDFLARE_FLUX_MODEL}`);
  assert.equal(request.options.headers.authorization, "Bearer token-1");
  assert.deepEqual(JSON.parse(request.options.body), {
    prompt: "a tiny blue cat",
    steps: 4,
  });
  assert.deepEqual(image, Buffer.from("png-bytes"));
});

test("CloudflareImageService surfaces provider failures", async () => {
  const service = new CloudflareImageService({
    accountId: "account-1",
    apiToken: "token-1",
    fetchImpl: async () => ({
      ok: false,
      status: 429,
      headers: { get: () => "application/json" },
      async json() {
        return { success: false, errors: [{ message: "quota" }] };
      },
    }),
  });

  await assert.rejects(service.generate("a cat"), (error) => {
    assert.equal(error instanceof CloudflareImageError, true);
    assert.equal(error.status, 429);
    assert.match(error.message, /quota/);
    return true;
  });
});
