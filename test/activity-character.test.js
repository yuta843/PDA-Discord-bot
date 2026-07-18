import assert from "node:assert/strict";
import test from "node:test";
import { ActivityCharacterPublisher } from "../src/activity-character.js";

test("activity character publisher stays disabled without a server secret", async () => {
  let called = false;
  const publisher = new ActivityCharacterPublisher({
    baseUrl: "http://127.0.0.1:3001",
    roomId: "room-1",
    fetchImpl: async () => { called = true; },
  });
  assert.equal(await publisher.publish("123456789012345678", { phase: "thinking" }), false);
  assert.equal(called, false);
});

test("activity character publisher normalizes and authenticates state", async () => {
  let request;
  const publisher = new ActivityCharacterPublisher({
    baseUrl: "http://127.0.0.1:3001/",
    roomId: "room-1",
    secret: "s".repeat(32),
    fetchImpl: async (url, options) => { request = { url, options }; return { ok: true }; },
  });
  assert.equal(await publisher.publish("123456789012345678", {
    phase: "speaking",
    emotion: "happy",
    text: " hello ",
  }), true);
  assert.equal(request.url, "http://127.0.0.1:3001/internal/character-state");
  assert.equal(request.options.headers.Authorization, `Bearer ${"s".repeat(32)}`);
  const body = JSON.parse(request.options.body);
  assert.equal(body.roomId, "room-1");
  assert.equal(body.state.phase, "speaking");
  assert.equal(body.state.emotion, "happy");
  assert.equal(body.state.text, "hello");
});

test("activity character publisher refuses secrets over remote HTTP", () => {
  const publisher = new ActivityCharacterPublisher({
    baseUrl: "http://activity.example.test",
    roomId: "room-1",
    secret: "s".repeat(32),
  });
  assert.equal(publisher.isConfigured(), false);
});
