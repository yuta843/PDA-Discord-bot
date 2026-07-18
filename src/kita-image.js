import { generateCodexOAuthShortReply } from "./codex-oauth.js";
import { GENERATED_IMAGE_FORWARD_CHANNEL_ID } from "./generated-image-forward.js";

const DEFAULT_KITA_IMAGE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MIN_KITA_IMAGE_INTERVAL_MS = 30 * 60 * 1000;
const KITA_SEARCH_TIMEOUT_MS = 120_000;
const MAX_KITA_IMAGE_BYTES = 10 * 1024 * 1024;
const X_STATUS_PATTERN = /https?:\/\/(?:api\.)?(?:fx)?(?:twitter\.com|x\.com)\/([A-Za-z0-9_]+)\/status\/(\d+)/i;
const KITA_IMAGE_HOSTS = new Set(["pbs.twimg.com"]);

function parseKitaImageIntervalMs(value) {
  if (value == null || String(value).trim() === "") return DEFAULT_KITA_IMAGE_INTERVAL_MS;
  const hours = Number(value);
  if (!Number.isFinite(hours) || hours <= 0) return DEFAULT_KITA_IMAGE_INTERVAL_MS;
  return Math.max(MIN_KITA_IMAGE_INTERVAL_MS, Math.round(hours * 60 * 60 * 1000));
}

function normalizeKitaXPostUrl(value) {
  const match = String(value ?? "").match(X_STATUS_PATTERN);
  return match ? `https://fxtwitter.com/${match[1]}/status/${match[2]}` : null;
}

function isAllowedKitaImageUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && KITA_IMAGE_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

async function findKitaImagePost({
  previousUrl = null,
  searchImpl = generateCodexOAuthShortReply,
  fetchImpl = fetch,
} = {}) {
  const result = await searchImpl(
    [
      "Search the current public web for one X (Twitter) post containing a cute Bokita (Bocchi Gotoh and Ikuyo Kita) fan-art image.",
      "Use the Japanese search terms ぼ喜多 and ぼっち・ざ・ろっく.",
      "Choose a safe-for-work post that has an actual image and preserve attribution to the original artist.",
      previousUrl ? `Do not return this previously used post: ${previousUrl}` : "",
      "Return exactly one x.com or twitter.com status URL and no other text.",
    ].filter(Boolean).join("\n"),
    {
      taskInstruction: "Find one current, public, safe-for-work X image post matching the requested fandom search.",
      settings: { length: "short", language: "en", style: "casual" },
      timeoutMs: KITA_SEARCH_TIMEOUT_MS,
    },
  );
  const postUrl = normalizeKitaXPostUrl(result);
  if (!postUrl || postUrl === previousUrl) throw new Error("X search returned no new valid status URL.");

  const apiUrl = postUrl.replace("https://fxtwitter.com/", "https://api.fxtwitter.com/");
  const response = await fetchImpl(apiUrl, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`FxTwitter verification failed: HTTP ${response.status}`);
  const data = await response.json();
  const media = data?.tweet?.media;
  const imageUrl = [...(media?.photos ?? []), ...(media?.all ?? [])]
    .map((item) => item?.url)
    .find(isAllowedKitaImageUrl);
  if (data?.code !== 200 || !imageUrl) throw new Error("The searched X post has no downloadable image.");
  return { postUrl, imageUrl };
}

async function findKitaImagePostUrl(options = {}) {
  return (await findKitaImagePost(options)).postUrl;
}

async function downloadKitaImage(imageUrl, fetchImpl = fetch) {
  if (!isAllowedKitaImageUrl(imageUrl)) throw new Error("The X image URL is not allowed.");
  const response = await fetchImpl(imageUrl, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`X image download failed: HTTP ${response.status}`);
  const contentType = response.headers?.get?.("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("image/")) throw new Error("The X media response is not an image.");
  const image = Buffer.from(await response.arrayBuffer());
  if (image.length === 0 || image.length > MAX_KITA_IMAGE_BYTES) {
    throw new Error("The X image is empty or larger than 10 MB.");
  }
  const extension = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
  return { image, fileName: `kitachan.${extension}` };
}

async function sendKitaImagePost(
  client,
  {
    channelId = GENERATED_IMAGE_FORWARD_CHANNEL_ID,
    previousUrl = null,
    searchImpl = generateCodexOAuthShortReply,
    fetchImpl = fetch,
  } = {},
) {
  const { postUrl, imageUrl } = await findKitaImagePost({ previousUrl, searchImpl, fetchImpl });
  const { image, fileName } = await downloadKitaImage(imageUrl, fetchImpl);
  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased?.() || typeof channel.send !== "function") {
    throw new Error(`Kita-image target channel is not writable: ${channelId}`);
  }
  await channel.send({
    content: `X検索で見つけた、かわいいぼ喜多です 🎸✨\n${postUrl}`,
    files: [{ attachment: image, name: fileName }],
    allowedMentions: { parse: [] },
  });
  return postUrl;
}

export {
  DEFAULT_KITA_IMAGE_INTERVAL_MS,
  KITA_SEARCH_TIMEOUT_MS,
  downloadKitaImage,
  findKitaImagePost,
  findKitaImagePostUrl,
  isAllowedKitaImageUrl,
  normalizeKitaXPostUrl,
  parseKitaImageIntervalMs,
  sendKitaImagePost,
};
