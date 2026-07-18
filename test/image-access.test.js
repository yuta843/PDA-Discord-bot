import test from "node:test";
import assert from "node:assert/strict";
import {
  IMAGE_COOLDOWN_MS,
  IMAGE_UNLIMITED_USER_ID,
  ImageAccessLimiter,
} from "../src/image-access.js";

test("limits ordinary users to one image use every three minutes", () => {
  const limiter = new ImageAccessLimiter();
  assert.equal(limiter.checkAndRecord("user", 1000).allowed, true);
  assert.deepEqual(limiter.checkAndRecord("user", 2000), {
    allowed: false,
    retryAfterMs: IMAGE_COOLDOWN_MS - 1000,
  });
  assert.equal(limiter.checkAndRecord("user", 1000 + IMAGE_COOLDOWN_MS).allowed, true);
});

test("allows the configured owner to use images without a cooldown", () => {
  const limiter = new ImageAccessLimiter();
  assert.equal(limiter.checkAndRecord(IMAGE_UNLIMITED_USER_ID, 1000).allowed, true);
  assert.equal(limiter.checkAndRecord(IMAGE_UNLIMITED_USER_ID, 1001).allowed, true);
});
