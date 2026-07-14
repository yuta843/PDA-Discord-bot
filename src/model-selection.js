import { readFileSync, writeFileSync } from "node:fs";

const MODEL_ADMIN_USER_ID = "1068329268397998161";
const AI_MODEL_CHOICES = Object.freeze([
  Object.freeze({ name: "自動: Gemini → Qwen → GPT-OSS", value: "gemini" }),
  Object.freeze({ name: "Groq GPT-OSS 120B", value: "groq" }),
  Object.freeze({ name: "Groq Qwen 3.6 27B", value: "qwen" }),
  Object.freeze({ name: "OpenAI GPT-5.6 Luna（低・ChatGPT OAuth）", value: "openai" }),
]);
const AI_MODEL_LABELS = Object.freeze(
  Object.fromEntries(AI_MODEL_CHOICES.map(({ name, value }) => [value, name])),
);
const IMAGE_PROVIDER_CHOICES = Object.freeze([
  Object.freeze({ name: "Cloudflare FLUX", value: "cloudflare" }),
  Object.freeze({ name: "Codex OAuth (GPT Image 2)", value: "codex" }),
]);
const IMAGE_PROVIDER_LABELS = Object.freeze(
  Object.fromEntries(IMAGE_PROVIDER_CHOICES.map(({ name, value }) => [value, name])),
);

function normalizeProvider(value, fallback = "groq") {
  return AI_MODEL_CHOICES.some((choice) => choice.value === value) ? value : fallback;
}

function normalizeImageProvider(value, fallback = "cloudflare") {
  return IMAGE_PROVIDER_CHOICES.some((choice) => choice.value === value) ? value : fallback;
}

function loadSelectedProvider(filePath, fallback = "groq") {
  try {
    const data = JSON.parse(readFileSync(filePath, "utf8"));
    return normalizeProvider(data.provider, fallback);
  } catch {
    return normalizeProvider(fallback);
  }
}

function saveSelectedProvider(filePath, provider) {
  const normalized = normalizeProvider(provider);
  writeFileSync(filePath, `${JSON.stringify({ provider: normalized }, null, 2)}\n`, "utf8");
  return normalized;
}

function loadSelectedImageProvider(filePath, fallback = "cloudflare") {
  try {
    const data = JSON.parse(readFileSync(filePath, "utf8"));
    return normalizeImageProvider(data.imageProvider, fallback);
  } catch {
    return normalizeImageProvider(fallback);
  }
}

function saveSelectedImageProvider(filePath, provider) {
  const normalized = normalizeImageProvider(provider);
  writeFileSync(filePath, `${JSON.stringify({ imageProvider: normalized }, null, 2)}\n`, "utf8");
  return normalized;
}

function canSelectModel(userId) {
  return userId === MODEL_ADMIN_USER_ID;
}

export {
  AI_MODEL_CHOICES,
  AI_MODEL_LABELS,
  IMAGE_PROVIDER_CHOICES,
  IMAGE_PROVIDER_LABELS,
  MODEL_ADMIN_USER_ID,
  canSelectModel,
  loadSelectedProvider,
  loadSelectedImageProvider,
  normalizeProvider,
  normalizeImageProvider,
  saveSelectedProvider,
  saveSelectedImageProvider,
};
