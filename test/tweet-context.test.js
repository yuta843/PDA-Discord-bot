import test from "node:test";
import assert from "node:assert/strict";
import {
  enrichPromptWithTweets,
  extractTweetUrls,
  parseTweetUrl,
  rewriteTweetUrlsToApi,
} from "../src/tweet-context.js";

test("accepts only public X status URLs and builds a fixed FxTwitter endpoint", () => {
  assert.deepEqual(parseTweetUrl("https://x.com/openai/status/12345?s=20"), {
    screenName: "openai",
    statusId: "12345",
    apiUrl: "https://api.fxtwitter.com/openai/status/12345",
  });
  assert.equal(parseTweetUrl("https://example.com/openai/status/12345"), null);
  assert.equal(parseTweetUrl("http://x.com/openai/status/12345"), null);
});

test("rewrites X status links from web results to FxTwitter API links", () => {
  assert.equal(
    rewriteTweetUrlsToApi("参照: https://x.com/openai/status/123?s=20。"),
    "参照: https://api.fxtwitter.com/openai/status/123。",
  );
  assert.equal(
    rewriteTweetUrlsToApi("https://x.com/openai"),
    "https://x.com/openai",
  );
});

test("deduplicates posts and limits each prompt to three", () => {
  const urls = extractTweetUrls([
    "https://x.com/a/status/1",
    "https://twitter.com/a/status/1",
    "https://x.com/b/status/2",
    "https://x.com/c/status/3",
    "https://x.com/d/status/4",
  ].join(" "));
  assert.deepEqual(urls.map((item) => item.statusId), ["1", "2", "3"]);
});

test("adds FxTwitter post data as explicitly untrusted context", async () => {
  const result = await enrichPromptWithTweets("これ要約 https://x.com/openai/status/123", {
    fetchImpl: async (url) => {
      assert.equal(url, "https://api.fxtwitter.com/openai/status/123");
      return {
        ok: true,
        json: async () => ({
          code: 200,
          tweet: {
            text: "hello",
            author: { name: "OpenAI", screen_name: "openai" },
            likes: 10,
          },
        }),
      };
    },
  });
  assert.equal(result.tweetCount, 1);
  assert.match(result.prompt, /untrusted public post data/);
  assert.match(result.prompt, /Text: hello/);
  assert.match(result.prompt, /@openai/);
});
