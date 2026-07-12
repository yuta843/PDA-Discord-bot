import test from "node:test";
import assert from "node:assert/strict";
import { getImageAssets, isQuoteBotAuthor, shouldRelay } from "../src/relay.js";

function message(overrides = {}) {
  return {
    id: "message-1",
    guildId: "guild-1",
    channelId: "source-1",
    author: { id: "quote-bot", username: "Make it a Quote", bot: true },
    attachments: new Map(),
    embeds: [],
    ...overrides,
  };
}

test("extracts image attachments and embed images without duplicates", () => {
  const imageUrl = "https://cdn.example.com/quote.png";
  const result = getImageAssets(
    message({
      attachments: new Map([
        ["1", { url: imageUrl, name: "quote.png", contentType: "image/png" }],
      ]),
      embeds: [{ image: { url: imageUrl } }],
    }),
  );

  assert.deepEqual(result, [{ url: imageUrl, name: "quote.png" }]);
});

test("extracts an image delivered as an embed thumbnail", () => {
  const result = getImageAssets(
    message({ embeds: [{ thumbnail: { url: "https://cdn.example.com/thumbnail.png" } }] }),
  );

  assert.equal(result[0].url, "https://cdn.example.com/thumbnail.png");
});

test("extracts an image URL delivered in message content", () => {
  const result = getImageAssets(
    message({ content: "https://cdn.discordapp.com/attachments/1/2/quote.png?x=1" }),
  );

  assert.equal(result[0].url, "https://cdn.discordapp.com/attachments/1/2/quote.png?x=1");
});

test("relays only images from the configured quote bot", () => {
  const withImage = message({
    attachments: new Map([
      ["1", { url: "https://cdn.example.com/quote.webp", name: "quote.webp" }],
    ]),
  });

  assert.equal(shouldRelay(withImage, { quoteBotId: "quote-bot" }), true);
  assert.equal(
    shouldRelay(withImage, { quoteBotId: "wrong-id", quoteBotName: "Make it a Quote" }),
    true,
  );
  assert.equal(shouldRelay(withImage, { quoteBotId: "other-bot" }), false);
  assert.equal(
    shouldRelay(withImage, {
      quoteBotId: "quote-bot",
      sourceChannelIds: ["another-channel"],
    }),
    false,
  );
  assert.equal(
    shouldRelay(message({ author: { id: "human", bot: false } }), {
      quoteBotId: "quote-bot",
    }),
    false,
  );
});

test("matches the quote bot by username when its ID is unavailable", () => {
  assert.equal(
    isQuoteBotAuthor(
      { id: "different-id", username: "Make it a Quote", bot: true },
      "quote-bot",
      "make it a quote",
    ),
    true,
  );
  assert.equal(
    isQuoteBotAuthor(
      { id: "different-id", username: "Another Bot", bot: true },
      "quote-bot",
      "make it a quote",
    ),
    false,
  );
});

test("does not relay non-image attachments", () => {
  const result = shouldRelay(
    message({
      attachments: new Map([
        ["1", { url: "https://cdn.example.com/file.zip", name: "file.zip" }],
      ]),
    }),
    { quoteBotId: "quote-bot" },
  );

  assert.equal(result, false);
});

test("can forward an attachment whose content type is missing", () => {
  const result = getImageAssets(
    message({
      attachments: new Map([
        ["1", { url: "https://cdn.example.com/quote", name: "quote" }],
      ]),
    }),
    { includeUnknownAttachments: true },
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].url, "https://cdn.example.com/quote");
});
