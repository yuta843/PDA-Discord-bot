import { shortenReply } from "./gemini.js";
import { buildAiSystemInstruction, getAiLengthConfig } from "./ai-settings.js";

const DEFAULT_GROQ_MODEL = "openai/gpt-oss-20b";

class GroqApiError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.name = "GroqApiError";
    this.status = status;
    this.code = code;
  }
}

function isGroqLimitError(error) {
  return error?.status === 429 || error?.code === "rate_limit_exceeded";
}

async function generateGroqShortReply(
  prompt,
  {
    apiKey,
    model = DEFAULT_GROQ_MODEL,
    history = [],
    settings = {},
    fetchImpl = fetch,
  } = {},
) {
  if (!apiKey) throw new Error("GROQ_API_KEY is not configured.");
  const lengthConfig = getAiLengthConfig(settings);

  const response = await fetchImpl("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: buildAiSystemInstruction(settings),
        },
        ...history
          .filter(({ content }) => content?.trim())
          .map(({ role, content }) => ({
            role: role === "assistant" ? "assistant" : "user",
            content: content.trim().slice(0, 2000),
          })),
        { role: "user", content: prompt.trim().slice(0, 2000) },
      ],
      temperature: 0.6,
      max_tokens: lengthConfig.maxOutputTokens,
    }),
    signal: AbortSignal.timeout(20_000),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new GroqApiError(data.error?.message ?? `Groq API request failed (${response.status}).`, {
      status: response.status,
      code: data.error?.code,
    });
  }

  const reply = shortenReply(data.choices?.[0]?.message?.content, lengthConfig.maxReplyLength, {
    preserveLineBreaks: settings?.style === "bullet",
  });
  if (!reply) throw new Error("Groq returned an empty response.");
  return reply;
}

export {
  DEFAULT_GROQ_MODEL,
  GroqApiError,
  generateGroqShortReply,
  isGroqLimitError,
};
