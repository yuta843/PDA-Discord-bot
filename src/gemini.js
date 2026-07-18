const DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite";
const MAX_REPLY_LENGTH = 80;

import { buildAiSystemInstruction, getAiLengthConfig } from "./ai-settings.js";
import {
  buildUntrustedHistory,
  buildUntrustedUserPrompt,
  isPersonaOverridePrompt,
  PERSONA_OVERRIDE_MESSAGE,
} from "./prompt-guard.js";

class GeminiApiError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.name = "GeminiApiError";
    this.status = status;
    this.code = code;
  }
}

class GeminiSafetyError extends Error {
  constructor(message = "Gemini blocked the content for safety reasons.") {
    super(message);
    this.name = "GeminiSafetyError";
    this.code = "SAFETY";
  }
}

const CHILD_SEXUAL_PATTERN =
  /(?:csam|児童ポルノ|児ポ|未成年.{0,12}(?:性的|性行為|性交|ポルノ|ヌード)|(?:小学生|中学生|高校生|幼児|ロリ|ショタ).{0,12}(?:エロ|裸|性的|性行為)|(?:child|minor|underage).{0,12}(?:porn|nude|sex|sexual))/i;
const EXPLICIT_SEXUAL_PATTERN =
  /(?:ポルノ|エロ画像|エロ小説|性的描写|露骨な下ネタ|性行為.{0,12}(?:描写|書いて|作って)|(?:porn|hentai|explicit sex|sexual roleplay|write.{0,12}sex))/i;

function moderatePrompt(prompt) {
  if (isPersonaOverridePrompt(prompt)) {
    return { allowed: false, code: "PERSONA_OVERRIDE", message: PERSONA_OVERRIDE_MESSAGE };
  }
  if (CHILD_SEXUAL_PATTERN.test(prompt)) {
    return { allowed: false, message: "未成年の性的内容には対応できません。" };
  }
  if (EXPLICIT_SEXUAL_PATTERN.test(prompt)) {
    return { allowed: false, message: "露骨な性的内容には対応できません。" };
  }
  return { allowed: true, message: null };
}

function isGeminiLimitError(error) {
  return error?.status === 429 || error?.code === "RESOURCE_EXHAUSTED";
}

function isGeminiUnavailableError(error) {
  return error?.status === 503 || error?.code === "UNAVAILABLE";
}

function isGeminiSafetyError(error) {
  return error?.code === "SAFETY" || error instanceof GeminiSafetyError;
}

function getGeminiSafetySettings(settings = {}) {
  if (settings?.style === "cold") {
    return [
      {
        category: "HARM_CATEGORY_HARASSMENT",
        threshold: "BLOCK_NONE",
      },
      {
        category: "HARM_CATEGORY_HATE_SPEECH",
        threshold: "BLOCK_ONLY_HIGH",
      },
      {
        category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
        threshold: "BLOCK_MEDIUM_AND_ABOVE",
      },
    ];
  }

  return [
    {
      category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
      threshold: "BLOCK_MEDIUM_AND_ABOVE",
    },
  ];
}

function extractMentionPrompt(content, botUserId) {
  if (!content || !/^\d+$/.test(botUserId)) return null;
  const match = content.match(new RegExp(`^<@!?${botUserId}>\\s*([\\s\\S]*)$`));
  return match ? match[1].trim() : null;
}

async function extractAiPrompt(message, botUserId) {
  const mentionedPrompt = extractMentionPrompt(message.content, botUserId);
  if (mentionedPrompt !== null) return mentionedPrompt;

  if (!message.reference?.messageId || typeof message.fetchReference !== "function") return null;

  try {
    const referencedMessage = await message.fetchReference();
    if (referencedMessage.author?.id !== botUserId) return null;
    return message.content?.trim() ?? "";
  } catch {
    return null;
  }
}

function shortenReply(text, maxLength = MAX_REPLY_LENGTH, { preserveLineBreaks = false } = {}) {
  const compact = text?.trim().replace(preserveLineBreaks ? /[ \t]+/g : /\s+/g, " ") ?? "";
  const characters = [...compact];
  if (characters.length <= maxLength) return compact;
  return `${characters.slice(0, maxLength - 3).join("")}...`;
}

async function generateShortReply(
  prompt,
  {
    apiKey,
    model = DEFAULT_GEMINI_MODEL,
    history = [],
    onUsage,
    settings = {},
    taskInstruction = "",
    agentSkillContext = "",
    fetchImpl = fetch,
  } = {},
) {
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");
  if (!prompt?.trim()) return "質問を書いて。";
  const lengthConfig = getAiLengthConfig(settings);

  const response = await fetchImpl(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text: buildAiSystemInstruction(settings, { taskInstruction }),
            },
          ],
        },
        contents: [
          ...buildUntrustedHistory(history).map(({ role, content }) => ({
            role: role === "assistant" ? "model" : "user",
            parts: [{ text: content }],
          })),
          {
            role: "user",
            parts: [{
              text: [buildUntrustedUserPrompt(prompt), agentSkillContext]
                .filter(Boolean)
                .join("\n"),
            }],
          },
        ],
        generationConfig: {
          temperature: 0.6,
          maxOutputTokens: lengthConfig.maxOutputTokens,
        },
        safetySettings: getGeminiSafetySettings(settings),
      }),
      signal: AbortSignal.timeout(20_000),
    },
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new GeminiApiError(
      data.error?.message ?? `Gemini API request failed (${response.status}).`,
      { status: response.status, code: data.error?.status },
    );
  }

  if (
    data.promptFeedback?.blockReason ||
    data.candidates?.some((candidate) => candidate.finishReason === "SAFETY")
  ) {
    const usage = getGeminiUsage(data);
    if (usage) onUsage?.(usage);
    throw new GeminiSafetyError();
  }

  const usage = getGeminiUsage(data);
  if (usage) onUsage?.(usage);

  const text = data.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("");
  const reply = shortenReply(text, lengthConfig.maxReplyLength, {
    preserveLineBreaks: settings?.style === "bullet",
  });
  if (!reply) throw new Error("Gemini returned an empty response.");
  return reply;
}

function getGeminiUsage(data) {
  const usage = data?.usageMetadata;
  if (!usage) return null;

  const promptTokens = Number(usage.promptTokenCount) || 0;
  const candidateTokens = Number(usage.candidatesTokenCount) || 0;
  const totalTokens = Number(usage.totalTokenCount) || promptTokens + candidateTokens;
  if (totalTokens <= 0) return null;

  return { promptTokens, candidateTokens, totalTokens };
}

export {
  DEFAULT_GEMINI_MODEL,
  GeminiApiError,
  GeminiSafetyError,
  extractAiPrompt,
  extractMentionPrompt,
  getGeminiUsage,
  generateShortReply,
  getGeminiSafetySettings,
  isGeminiLimitError,
  isGeminiSafetyError,
  isGeminiUnavailableError,
  moderatePrompt,
  shortenReply,
};
