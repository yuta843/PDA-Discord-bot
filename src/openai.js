import { buildAiSystemInstruction, getAiLengthConfig } from "./ai-settings.js";
import { shortenReply } from "./gemini.js";
import { buildUntrustedHistory, buildUntrustedUserPrompt } from "./prompt-guard.js";

const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

class OpenAiApiError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.name = "OpenAiApiError";
    this.status = status;
    this.code = code;
  }
}

function isOpenAiLimitError(error) {
  return error?.status === 429 || error?.code === "rate_limit_exceeded";
}

function isOpenAiUnavailableError(error) {
  return error?.status === 503 || error?.code === "server_error";
}

function extractOpenAiText(data) {
  if (typeof data?.output_text === "string") return data.output_text;
  return (data?.output ?? [])
    .flatMap((item) => item?.content ?? [])
    .filter((part) => part?.type === "output_text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
}

async function generateOpenAiShortReply(
  prompt,
  {
    apiKey,
    model = DEFAULT_OPENAI_MODEL,
    history = [],
    settings = {},
    taskInstruction = "",
    agentSkillContext = "",
    fetchImpl = fetch,
  } = {},
) {
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");
  const lengthConfig = getAiLengthConfig(settings);
  const input = [
    ...buildUntrustedHistory(history),
    {
      role: "user",
      content: [buildUntrustedUserPrompt(prompt), agentSkillContext]
        .filter(Boolean)
        .join("\n"),
    },
  ];

  const requestResponse = async (maxOutputTokens) => {
    const response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        instructions: buildAiSystemInstruction(settings, { taskInstruction }),
        input,
        max_output_tokens: maxOutputTokens,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new OpenAiApiError(
        data.error?.message ?? `OpenAI API request failed (${response.status}).`,
        { status: response.status, code: data.error?.code },
      );
    }
    return data;
  };

  const initialMaxTokens = Math.max(lengthConfig.maxOutputTokens * 4, 512);
  let data = await requestResponse(initialMaxTokens);
  let text = extractOpenAiText(data);
  if (!text.trim() && data.status === "incomplete") {
    data = await requestResponse(Math.min(initialMaxTokens * 2, 4096));
    text = extractOpenAiText(data);
  }

  const reply = shortenReply(text, lengthConfig.maxReplyLength, {
    preserveLineBreaks: settings?.style === "bullet",
  });
  if (!reply) throw new Error("OpenAI returned an empty response.");
  return reply;
}

export {
  DEFAULT_OPENAI_MODEL,
  OpenAiApiError,
  extractOpenAiText,
  generateOpenAiShortReply,
  isOpenAiLimitError,
  isOpenAiUnavailableError,
};
