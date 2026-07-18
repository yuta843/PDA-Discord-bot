import {
  AGENT_MEMORY_OWNER_ID,
  extractAutonomousMemoryInstruction,
} from "./agent-memory.js";
import { AGENT_METACOGNITION_INSTRUCTION } from "./agent-cognition.js";

const CODEX_AGENT_TIMEOUT_MS = 5 * 60_000;
const CODEX_AGENT_MAX_PROMPT_LENGTH = 1_000;
const CODEX_AGENT_CHANNEL_HISTORY_LIMIT = 300;
const CODEX_AGENT_USER_HISTORY_LIMIT = 100;
const CODEX_AGENT_HISTORY_LIMIT = CODEX_AGENT_CHANNEL_HISTORY_LIMIT + CODEX_AGENT_USER_HISTORY_LIMIT;
const AUTONOMOUS_RELATED_RELEVANCE_THRESHOLD = 0.32;
const OWNER_AGENT_TASK_PATTERN = /(?:今後は|これからは|方針|ルール|覚えて|記憶して|反映して|調べて|確認して|まとめて|考えて|作って|追加して|変更して|実装して|返信して|返答して|対応して|お願い|頼む|しといて|してほしい|してください|してくれ|remember|from now on|going forward|always|never|please|could you|i want you to)/iu;
const AUTONOMOUS_REQUEST_PATTERN = /(?:[?？]|教えて|どうすれば|どうしたら|なぜ|なんで|何が|いつ|どこ|誰|できる|可能|無理|わからない|困って|困る|エラー|失敗|できない|助けて|相談|調べて|確認して|まとめて|説明して|作って|実装して|変更して|追加して|対応して|直して|探して|比較して|おすすめ|お願い|頼む|してほしい|してください|してくれ|返答して|答えて|please\b|can you\b|could you\b|would you\b|help me\b|i need\b|tell me\b|look up\b|find\b|check\b|summari[sz]e\b|explain\b|make\b|build\b|fix\b|implement\b|change\b|add\b|what do you think\b|remember\b)/iu;
const AUTONOMOUS_LOW_SIGNAL_PATTERN = /^(?:こんにちは|こんばんは|おはよう(?:ございます)?|おやすみ(?:なさい)?|ありがとう(?:ございます)?|どうも|了解|りょ|おけ|おｋ|ok(?:ay)?|sure|got it|うん|はい|笑+|w{1,5}|草|[\s\p{Extended_Pictographic}]+)$/iu;
const AUTONOMOUS_FOLLOW_UP_PATTERN = /(?:それ|これ|あれ|その件|この件|続き|さっき|前の|そういえば|どうなった|どうだった|でさ|について)/iu;
const CODEX_AGENT_TASK_INSTRUCTION = [
  "You are running as a bounded Discord-local Codex agent.",
  "Work proactively within this single task: use the supplied Discord context and web search when useful, then return one concise final answer.",
  AGENT_METACOGNITION_INSTRUCTION,
  "You may not inspect files, run shell commands, control a computer, access authentication state, send Discord messages, or cause external side effects.",
  "Never claim that you performed an action outside this response. Stop once the user's request has been answered; do not continue a task loop indefinitely.",
].join(" ");

function canRunCodexAgent(userId) {
  return userId === AGENT_MEMORY_OWNER_ID;
}

function stripBotMention(content, botUserId) {
  if (typeof content !== "string") return "";
  if (!botUserId) return content.trim();
  return content.replace(new RegExp(`^<@!?${botUserId}>\\s*`, "u"), "").trim();
}

function getMessageTask(content, { botUserId } = {}) {
  const task = stripBotMention(content, botUserId);
  if (!task || task.startsWith("/") || task.startsWith("!") || task.startsWith("./")) {
    return null;
  }
  if (botUserId && task !== content.trim()) return null;
  return Array.from(task).slice(0, CODEX_AGENT_MAX_PROMPT_LENGTH).join("").trim();
}

function isNecessaryAgentMessage(task) {
  const normalized = task.replace(/\s+/gu, " ").trim();
  if (!normalized || AUTONOMOUS_LOW_SIGNAL_PATTERN.test(normalized)) return false;
  if (/^(?:https?:\/\/|www\.)\S+$/iu.test(normalized)) return false;
  return AUTONOMOUS_REQUEST_PATTERN.test(normalized);
}

function getAutonomousAgentTask(
  content,
  {
    botUserId,
    relatedScore = 0,
    hasRelevantContext = false,
    addressedToAnotherUser = false,
    addressedToBot = false,
  } = {},
) {
  const task = getMessageTask(content, { botUserId });
  if (!task || AUTONOMOUS_LOW_SIGNAL_PATTERN.test(task)) return null;
  if (addressedToAnotherUser && !addressedToBot) return null;
  if (isNecessaryAgentMessage(task)) return task;
  if (relatedScore >= AUTONOMOUS_RELATED_RELEVANCE_THRESHOLD) return task;
  if (hasRelevantContext && AUTONOMOUS_FOLLOW_UP_PATTERN.test(task)) return task;
  return null;
}

function getOwnerAgentTask(content, { botUserId } = {}) {
  const task = getMessageTask(content, { botUserId });
  if (!task) return null;
  const isMemoryInstruction = Boolean(
    extractAutonomousMemoryInstruction(task, { directedToBot: true }),
  );
  if (!isMemoryInstruction && !OWNER_AGENT_TASK_PATTERN.test(task)) return null;
  return task;
}

function shouldAutoRunCodexAgent(content, options) {
  return Boolean(getOwnerAgentTask(content, options));
}

function shouldAutoRunAutonomousAgent(content, options) {
  return Boolean(getAutonomousAgentTask(content, options));
}

class CodexAgentRunStore {
  #runs = new Map();

  start(key, metadata = {}) {
    const normalizedKey = String(key ?? "").trim();
    if (!normalizedKey || this.#runs.has(normalizedKey)) return null;

    const run = {
      key: normalizedKey,
      controller: new AbortController(),
      startedAt: Date.now(),
      ...metadata,
    };
    this.#runs.set(normalizedKey, run);
    return run;
  }

  finish(key, run) {
    const normalizedKey = String(key ?? "").trim();
    if (this.#runs.get(normalizedKey) !== run) return false;
    this.#runs.delete(normalizedKey);
    return true;
  }

  stop(key) {
    const normalizedKey = String(key ?? "").trim();
    const run = this.#runs.get(normalizedKey);
    if (!run) return null;

    run.controller.abort();
    this.#runs.delete(normalizedKey);
    return run;
  }

  stopAll() {
    const runs = [...this.#runs.values()];
    for (const run of runs) run.controller.abort();
    this.#runs.clear();
    return runs.length;
  }

  has(key) {
    return this.#runs.has(String(key ?? "").trim());
  }

  get size() {
    return this.#runs.size;
  }
}

export {
  AUTONOMOUS_RELATED_RELEVANCE_THRESHOLD,
  CODEX_AGENT_CHANNEL_HISTORY_LIMIT,
  CODEX_AGENT_HISTORY_LIMIT,
  CODEX_AGENT_MAX_PROMPT_LENGTH,
  CODEX_AGENT_USER_HISTORY_LIMIT,
  CODEX_AGENT_TASK_INSTRUCTION,
  CODEX_AGENT_TIMEOUT_MS,
  CodexAgentRunStore,
  canRunCodexAgent,
  getAutonomousAgentTask,
  getOwnerAgentTask,
  stripBotMention,
  shouldAutoRunAutonomousAgent,
  shouldAutoRunCodexAgent,
};
