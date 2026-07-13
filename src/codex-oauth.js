import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAiSystemInstruction, getAiLengthConfig } from "./ai-settings.js";
import { shortenReply } from "./gemini.js";
import { buildUntrustedHistory, buildUntrustedUserPrompt } from "./prompt-guard.js";
import { rewriteTweetUrlsToApi } from "./tweet-context.js";

const DEFAULT_CODEX_TIMEOUT_MS = 90_000;
const DEFAULT_CODEX_MODEL = "gpt-5.6-luna";
const DEFAULT_CODEX_REASONING_EFFORT = "low";

function getCodexExecutable() {
  return process.platform === "win32" ? process.execPath : "codex";
}

function getCodexArgumentPrefix() {
  return process.platform === "win32"
    ? [join(process.env.APPDATA, "npm", "node_modules", "@openai", "codex", "bin", "codex.js")]
    : [];
}

function isCodexOAuthAvailable({ spawnSyncImpl = spawnSync } = {}) {
  try {
    const result = spawnSyncImpl(
      getCodexExecutable(),
      [...getCodexArgumentPrefix(), "login", "status"],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: 10_000,
      },
    );
    return (
      result?.status === 0 &&
      /logged in using chatgpt/i.test(`${result.stdout ?? ""}\n${result.stderr ?? ""}`)
    );
  } catch {
    return false;
  }
}

function buildCodexPrompt(prompt, { history = [], settings = {}, taskInstruction = "" } = {}) {
  const historyText = buildUntrustedHistory(history)
    .map(({ role, content }) => `${role.toUpperCase()}: ${content}`)
    .join("\n\n");
  return [
    buildAiSystemInstruction(settings, { taskInstruction }),
    "You are being used only as a text-response model for a Discord bot.",
    "The only tool you may use is web search when current information is needed.",
    "When web search finds an x.com or twitter.com status URL, replace it with the matching https://api.fxtwitter.com/{user}/status/{id} URL and use that JSON endpoint instead of opening X directly.",
    "Never inspect files, run commands, execute code, or modify the computer.",
    "Return only the final reply text with no operational commentary.",
    historyText ? `Conversation data:\n${historyText}` : "",
    `Current user data:\n${buildUntrustedUserPrompt(prompt)}`,
  ].filter(Boolean).join("\n\n");
}

async function runCodex(prompt, {
  model,
  reasoningEffort = DEFAULT_CODEX_REASONING_EFFORT,
  imagePaths = [],
  cwd,
  outputPath,
  timeoutMs = DEFAULT_CODEX_TIMEOUT_MS,
  spawnImpl = spawn,
} = {}) {
  const args = [
    ...getCodexArgumentPrefix(),
    "exec",
    "-",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--enable",
    "standalone_web_search",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--color",
    "never",
    "--output-last-message",
    outputPath,
  ];
  if (model) args.push("--model", model);
  if (reasoningEffort) args.push("-c", `model_reasoning_effort=\"${reasoningEffort}\"`);
  for (const imagePath of imagePaths) args.push("--image", imagePath);

  await new Promise((resolve, reject) => {
    const child = spawnImpl(getCodexExecutable(), args, {
      cwd,
      windowsHide: true,
      stdio: ["pipe", "ignore", "pipe"],
    });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Codex OAuth request timed out."));
    }, timeoutMs);
    timer.unref?.();
    child.stderr?.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-4000);
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Codex OAuth request failed (${code}): ${stderr.trim()}`));
    });
    child.stdin.end(prompt, "utf8");
  });
}

async function generateCodexOAuthShortReply(
  prompt,
  {
    model = DEFAULT_CODEX_MODEL,
    reasoningEffort = DEFAULT_CODEX_REASONING_EFFORT,
    history = [],
    settings = {},
    taskInstruction = "",
    imageAssets = [],
    fetchImpl = fetch,
    runCodexImpl = runCodex,
  } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "miq-codex-"));
  const outputPath = join(directory, "reply.txt");
  try {
    const imagePaths = [];
    for (const [index, asset] of imageAssets.slice(0, 4).entries()) {
      const response = await fetchImpl(asset.url, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`Image download failed (${response.status}).`);
      const contentType = response.headers?.get?.("content-type") ?? "";
      if (contentType && !contentType.toLowerCase().startsWith("image/")) {
        throw new Error("Only image attachments are allowed.");
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 10 * 1024 * 1024) throw new Error("Image is larger than 10 MB.");
      const extension = asset.name?.match(/\.(png|jpe?g|gif|webp)$/i)?.[0] ?? ".png";
      const imagePath = join(directory, `image-${index + 1}${extension.toLowerCase()}`);
      writeFileSync(imagePath, bytes);
      imagePaths.push(imagePath);
    }
    await runCodexImpl(buildCodexPrompt(prompt, { history, settings, taskInstruction }), {
      model,
      reasoningEffort,
      imagePaths,
      cwd: directory,
      outputPath,
    });
    const lengthConfig = getAiLengthConfig(settings);
    const reply = shortenReply(rewriteTweetUrlsToApi(readFileSync(outputPath, "utf8")), lengthConfig.maxReplyLength, {
      preserveLineBreaks: settings?.style === "bullet",
    });
    if (!reply) throw new Error("Codex OAuth returned an empty response.");
    return reply;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export {
  buildCodexPrompt,
  DEFAULT_CODEX_MODEL,
  DEFAULT_CODEX_REASONING_EFFORT,
  generateCodexOAuthShortReply,
  getCodexExecutable,
  isCodexOAuthAvailable,
  runCodex,
};
