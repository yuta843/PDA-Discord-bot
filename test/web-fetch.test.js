import test from "node:test";
import assert from "node:assert/strict";
import {
  enrichPromptWithWebPages,
  extractWebUrls,
  htmlToText,
  isPrivateIp,
  validatePublicHttpsUrl,
} from "../src/web-fetch.js";

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

test("blocks local and private network destinations", async () => {
  assert.equal(isPrivateIp("127.0.0.1"), true);
  assert.equal(isPrivateIp("192.168.1.1"), true);
  assert.equal(isPrivateIp("93.184.216.34"), false);
  await assert.rejects(validatePublicHttpsUrl("https://localhost/test"));
  await assert.rejects(
    validatePublicHttpsUrl("https://internal.example/test", {
      lookupImpl: async () => [{ address: "10.0.0.1", family: 4 }],
    }),
  );
  await assert.rejects(validatePublicHttpsUrl("http://example.com/test", { lookupImpl: publicLookup }));
});

test("extracts public web URLs but leaves X status URLs to FxTwitter", () => {
  assert.deepEqual(
    extractWebUrls("https://example.com/a https://x.com/openai/status/123"),
    ["https://example.com/a"],
  );
});

test("removes scripts and markup without executing JavaScript", () => {
  assert.equal(htmlToText("<h1>Hello</h1><script>evil()</script><p>World</p>"), "Hello World");
});

test("adds fetched HTML as explicitly untrusted page data", async () => {
  const result = await enrichPromptWithWebPages("要約 https://example.com/page", {
    lookupImpl: publicLookup,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
      arrayBuffer: async () => Buffer.from("<title>Example</title><p>Hello</p>"),
    }),
  });
  assert.equal(result.pageCount, 1);
  assert.match(result.prompt, /untrusted page data/);
  assert.match(result.prompt, /Example Hello/);
});
