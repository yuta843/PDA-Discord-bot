import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  XFollowStore, buildXAccountPostMessages, buildXSelectionPrompt, comparePostIds, listXUserPosts,
  normalizeXUsername, parseXSelection, removeLinks, searchXPosts,
} from "../src/x-twitter.js";

const post = (id, username = "example") => ({
  type: "status", id: String(id), text: `post ${id}`, created_at: "2026-07-15T00:00:00Z",
  likes: 1, reposts: 2, quotes: 3, replies: 4,
  author: { name: "Example", screen_name: username, avatar_url: "https://example.com/a.png" },
  media: { photos: [{ url: "https://pbs.twimg.com/media/test.jpg" }] },
});

test("search uses the documented q parameter and normalizes results", async () => {
  let requested;
  const results = await searchXPosts("OpenAI", { limit: 3, feed: "top", fetchImpl: async (url) => {
    requested = new URL(url);
    return { ok: true, json: async () => ({ code: 200, results: [post("1945000000000000000")] }) };
  }});
  assert.equal(requested.pathname, "/2/search");
  assert.equal(requested.searchParams.get("q"), "OpenAI");
  assert.equal(requested.searchParams.get("count"), "3");
  assert.equal(requested.searchParams.get("feed"), "top");
  assert.equal(results[0].id, "1945000000000000000");
  assert.match(results[0].url, /^https:\/\/fxtwitter\.com\/example\/status\//);
});

test("user timeline excludes replies by default and keeps ids as strings", async () => {
  let requested;
  const results = await listXUserPosts("@example", { fetchImpl: async (url) => {
    requested = new URL(url);
    return { ok: true, json: async () => ({ code: 200, results: [
      { ...post("9007199254740994"), replying_to: { status: "1", screen_name: "other" } },
      post("9007199254740993"),
    ] }) };
  }});
  assert.equal(requested.pathname, "/2/profile/example/statuses");
  assert.equal(requested.searchParams.has("with_replies"), false);
  assert.equal(results[0].id, "9007199254740993");
  assert.equal(results.length, 1);
});

test("snowflake comparison is precise and AI selection marks external data untrusted", () => {
  assert.equal(comparePostIds("9007199254740993", "9007199254740992"), 1);
  assert.match(buildXSelectionPrompt("test", [{ ...post("1"), author: { username: "x" }, url: "https://x" }]), /未信頼/);
  assert.deepEqual(parseXSelection('{"selected":2,"reason":"最も具体的"}', 3), {
    index: 1,
    reason: "最も具体的",
  });
  assert.throws(() => parseXSelection('{"selected":4}', 3));
  assert.equal(normalizeXUsername("@OpenAI"), "OpenAI");
  assert.throws(() => normalizeXUsername("bad-name"));
});

test("follow store persists latest post ids as strings", () => {
  const filePath = join(mkdtempSync(join(tmpdir(), "x-follow-")), "state.json");
  const store = new XFollowStore({ filePath });
  const entry = store.upsert({ guildId: "1", channelId: "2", username: "example", latestPostId: "9007199254740993", createdBy: "3" });
  store.updateLatest(entry, "9007199254740994");
  assert.equal(JSON.parse(readFileSync(filePath, "utf8")).follows["1:2:example"].latestPostId, "9007199254740994");
  store.upsert({ guildId: "1", channelId: "2", username: "other", latestPostId: "2", createdBy: "3" });
  store.upsert({ guildId: "1", channelId: "9", username: "keep", latestPostId: "3", createdBy: "3" });
  assert.equal(store.removeByChannel("1", "2"), 2);
  assert.deepEqual(store.list().map((follow) => follow.username), ["keep"]);
});

test("account post output copies three bodies and removes links without AI rewriting", () => {
  const posts = [post("3"), post("2"), post("1")].map((item) => ({
    ...item,
    author: { username: "example" },
    createdAt: "2026-07-15T00:00:00Z",
    text: item.text,
  }));
  posts[0].text = "本文そのまま https://x.com/example/status/3";
  const messages = buildXAccountPostMessages("@example", posts);
  assert.equal(messages.length, 3);
  assert.match(messages[0], /本文そのまま/);
  assert.doesNotMatch(messages.join("\n"), /https?:\/\//);
  assert.equal(removeLinks("[投稿](https://x.com/a) https://example.com www.example.com"), "投稿");
});
