import { shortenReply } from "./gemini.js";
import { buildAiSystemInstruction, getAiLengthConfig } from "./ai-settings.js";
import { buildUntrustedHistory, buildUntrustedUserPrompt } from "./prompt-guard.js";

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
    taskInstruction = "",
    agentSkillContext = "",
    fetchImpl = fetch,
  } = {},
) {
  if (!apiKey) throw new Error("GROQ_API_KEY is not configured.");
  const lengthConfig = getAiLengthConfig(settings);
  const isGptOss = model.startsWith("openai/gpt-oss-");
  const isQwen36 = model === "qwen/qwen3.6-27b";
  const messages = [
    {
      role: "system",
      content: buildAiSystemInstruction(settings, { taskInstruction }),
    },
    ...buildUntrustedHistory(history),
    {
      role: "user",
      content: [buildUntrustedUserPrompt(prompt), agentSkillContext]
        .filter(Boolean)
        .join("\n"),
    },
  ];

  const requestCompletion = async (maxCompletionTokens) => {
    const response = await fetchImpl("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
      model,
      messages,
      temperature: isQwen36 ? 0.7 : 0.6,
      max_completion_tokens: maxCompletionTokens,
      ...(isGptOss ? { reasoning_effort: "low" } : {}),
      ...(isQwen36 ? { reasoning_effort: "none", top_p: 0.8 } : {}),
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
    return data;
  };

  const initialMaxTokens = Math.max(lengthConfig.maxOutputTokens * 4, 512);
  let data = await requestCompletion(initialMaxTokens);
  let content = data.choices?.[0]?.message?.content;
  if (!content?.trim() && data.choices?.[0]?.finish_reason === "length") {
    data = await requestCompletion(Math.min(initialMaxTokens * 2, 4096));
    content = data.choices?.[0]?.message?.content;
  }

  const reply = shortenReply(content, lengthConfig.maxReplyLength, {
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
