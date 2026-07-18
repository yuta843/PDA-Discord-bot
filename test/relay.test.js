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
  const imageUrl = "https://cdn.discordapp.com/attachments/1/2/quote.png";
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
    message({ embeds: [{ thumbnail: { url: "https://media.discordapp.net/attachments/1/2/thumbnail.png" } }] }),
  );

  assert.equal(result[0].url, "https://media.discordapp.net/attachments/1/2/thumbnail.png");
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
      [
        "1",
        {
          url: "https://cdn.discordapp.com/attachments/1/2/quote.webp",
          name: "quote.webp",
        },
      ],
    ]),
  });

  assert.equal(shouldRelay(withImage, { quoteBotId: "quote-bot" }), true);
  assert.equal(
    shouldRelay(withImage, { quoteBotId: "wrong-id", quoteBotName: "Make it a Quote" }),
    false,
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

test("does not trust a bot with only a matching username", () => {
  assert.equal(
    isQuoteBotAuthor(
      { id: "different-id", username: "Make it a Quote", bot: true },
      "quote-bot",
      "make it a quote",
    ),
    false,
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
        ["1", { url: "https://cdn.discordapp.com/attachments/1/2/quote", name: "quote" }],
      ]),
    }),
    { includeUnknownAttachments: true },
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].url, "https://cdn.discordapp.com/attachments/1/2/quote");
});

test("can forward a Discord attachment reported as octet-stream", () => {
  const candidate = message({
      attachments: new Map([
        ["1", {
          url: "https://cdn.discordapp.com/attachments/1/2/quote",
          name: "quote",
          contentType: "application/octet-stream",
        }],
      ]),
    });
  const result = getImageAssets(
    candidate,
    { includeUnknownAttachments: true },
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].url, "https://cdn.discordapp.com/attachments/1/2/quote");
  assert.equal(shouldRelay(candidate, { quoteBotId: "quote-bot" }), true);
});

test("keeps the octet-stream fallback scoped to attachments while retaining embeds", () => {
  const attachmentUrl = "https://cdn.discordapp.com/attachments/1/2/quote";
  const embedUrl = "https://media.discordapp.net/attachments/1/2/quote.png";
  const candidate = message({
    attachments: new Map([
      ["1", {
        url: attachmentUrl,
        name: "quote",
        contentType: "application/octet-stream",
      }],
    ]),
    embeds: [{ image: { url: embedUrl } }],
  });

  assert.deepEqual(getImageAssets(candidate), [{ url: embedUrl, name: "quote.png" }]);
  assert.deepEqual(
    getImageAssets(candidate, { includeUnknownAttachments: true }),
    [
      { url: attachmentUrl, name: "quote" },
      { url: embedUrl, name: "quote.png" },
    ],
  );
});

test("does not let a non-image content type masquerade as an image by filename", () => {
  const candidate = message({
    attachments: new Map([
      ["1", {
        url: "https://cdn.discordapp.com/attachments/1/2/not-an-image.png",
        name: "not-an-image.png",
        contentType: "application/pdf",
      }],
    ]),
  });

  assert.deepEqual(getImageAssets(candidate, { includeUnknownAttachments: true }), []);
  assert.equal(shouldRelay(candidate, { quoteBotId: "quote-bot" }), false);
});

test("rejects non-Discord, insecure, and lookalike asset URLs", () => {
  const result = getImageAssets(
    message({
      attachments: new Map([
        ["1", { url: "https://example.com/quote.png", name: "quote.png", contentType: "image/png" }],
        ["2", { url: "http://cdn.discordapp.com/attachments/1/2/quote.png", name: "quote.png", contentType: "image/png" }],
        ["3", { url: "https://cdn.discordapp.com.example.test/quote.png", name: "quote.png", contentType: "image/png" }],
      ]),
      embeds: [{ image: { url: "http://127.0.0.1/private.png" } }],
      content: "https://169.254.169.254/latest/meta-data/credentials.png",
    }),
    { includeUnknownAttachments: true },
  );

  assert.deepEqual(result, []);
});
