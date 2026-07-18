import { spawn as nodeSpawn, spawnSync as nodeSpawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import ffmpegStaticPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import { isAllowedDiscordAssetUrl } from "./relay.js";

const MEDIA_INPUT_EXTENSIONS = new Set([
  ".aac",
  ".avi",
  ".flac",
  ".gif",
  ".m4a",
  ".m4v",
  ".mkv",
  ".mov",
  ".mp3",
  ".mp4",
  ".oga",
  ".ogg",
  ".opus",
  ".wav",
  ".webm",
  ".wmv",
]);

const OUTPUT_EXTENSIONS = {
  audio: ".mp3",
  gif: ".gif",
  mp4: ".mp4",
  preview: ".jpg",
  trim: ".mp4",
};

const MEDIA_TASK_SIGNAL_PATTERN = /(?:\b(?:ffmpeg|ffprobe|mp3|mp4|gif|trim|info|probe|metadata)\b|extract\s+audio|音声抽出|音だけを?\s*mp3|動画を?\s*(?:mp4|gif)|(?:切り出し|トリミング)\s*[\d:])/iu;
const MEDIA_TASK_HELP = [
  "添付メディアの処理方法を指定してください:",
  "`@Bot mp3` 音声だけをMP3に抽出",
  "`@Bot mp4` 動画をMP4に変換",
  "`@Bot gif` 動画をGIFに変換",
  "`@Bot info` メディア情報を確認",
  "`@Bot trim 00:00:10 00:00:20` 開始秒と継続秒を指定して切り出し",
  "入力はDiscord添付ファイルのみ。1回1ファイル、最大25MB、処理時間は90秒です。",
].join("\n");

const DEFAULT_MAX_INPUT_BYTES = 25 * 1024 * 1024;
const DEFAULT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_PROCESS_OUTPUT_BYTES = 128 * 1024;
const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_PENDING_TASK_TTL_MS = 5 * 60_000;
const DEFAULT_TEMP_ROOT = join(tmpdir(), "miq-isou-media-tasks");

class LocalTaskError extends Error {
  constructor(message, code = "local_task_error") {
    super(message);
    this.name = "LocalTaskError";
    this.code = code;
  }
}

function normalizeText(value) {
  return typeof value === "string" ? value.normalize("NFKC").trim().toLowerCase() : "";
}

function parseTimecode(value) {
  const normalized = String(value ?? "").trim();
  if (/^\d+(?:\.\d+)?$/u.test(normalized)) return Number(normalized);

  const parts = normalized.split(":");
  if (parts.length !== 2 && parts.length !== 3) return null;
  if (!parts.every((part, index) => index === parts.length - 1
    ? /^\d{1,2}(?:\.\d+)?$/u.test(part)
    : /^\d+$/u.test(part))) {
    return null;
  }

  const numbers = parts.map(Number);
  if (parts.length === 2) return numbers[0] * 60 + numbers[1];
  return numbers[0] * 3600 + numbers[1] * 60 + numbers[2];
}

function getTrimTimes(normalized) {
  const match = normalized.match(
    /(?:trim|cut|切り出(?:し|す)?|トリミング)\s+([\d:.]+)\s+(?:to|for|から|継続|長さ)?\s*([\d:.]+)/iu,
  );
  if (!match) return null;

  const startSeconds = parseTimecode(match[1]);
  const durationSeconds = parseTimecode(match[2]);
  if (!Number.isFinite(startSeconds) || !Number.isFinite(durationSeconds)) return null;
  if (startSeconds < 0 || startSeconds > 3_600) return null;
  if (durationSeconds <= 0 || durationSeconds > 600) return null;
  return { startSeconds, durationSeconds };
}

function parseMediaTaskRequest(content) {
  const normalized = normalizeText(content);
  if (!normalized) return null;

  const trimTimes = getTrimTimes(normalized);
  if (trimTimes) return { type: "trim", ...trimTimes };
  if (/(?:\b(?:info|probe|metadata)\b|メディア情報|メタデータ)/iu.test(normalized)) {
    return { type: "info" };
  }
  if (/(?:\bmp3\b|extract\s+audio|音声抽出|音だけを?\s*mp3)/iu.test(normalized)) {
    return { type: "audio" };
  }
  if (/(?:gif|gif化|gifに)/iu.test(normalized)) return { type: "gif" };
  if (/(?:mp4|video convert|convert video|動画変換|動画に変換)/iu.test(normalized)) {
    return { type: "mp4" };
  }
  return null;
}

function hasMediaTaskSignal(content) {
  return MEDIA_TASK_SIGNAL_PATTERN.test(normalizeText(content));
}

function sanitizeBaseName(value) {
  const baseName = String(value ?? "media")
    .replace(/\.[^./\\]+$/u, "")
    .replace(/[^a-zA-Z0-9_-]/gu, "_")
    .replace(/^\.+/u, "")
    .slice(0, 48);
  return baseName || "media";
}

function getAttachmentValues(message) {
  return message?.attachments?.values
    ? [...message.attachments.values()]
    : Array.isArray(message?.attachments)
      ? message.attachments
      : [];
}

function getMediaAttachment(message) {
  const attachments = getAttachmentValues(message);
  const valid = attachments.filter((attachment) => {
    if (!isAllowedDiscordAssetUrl(attachment?.url)) return false;
    const extension = extname(attachment?.name ?? "").toLowerCase();
    const contentType = String(attachment?.contentType ?? "").toLowerCase();
    return MEDIA_INPUT_EXTENSIONS.has(extension) || contentType.startsWith("audio/") || contentType.startsWith("video/");
  });
  if (valid.length === 0) return { attachment: null, reason: "unsupported_attachment" };
  if (valid.length > 1) return { attachment: null, reason: "multiple_attachments" };
  return { attachment: valid[0], reason: null };
}

function formatProcessSeconds(value) {
  if (!Number.isFinite(value) || value < 0) throw new LocalTaskError("Invalid trim time.", "invalid_task");
  return value.toFixed(3).replace(/0+$/u, "").replace(/\.$/u, "") || "0";
}

function buildFfmpegArgs(task, inputPath, outputPath) {
  switch (task.type) {
    case "audio":
      return ["-y", "-i", inputPath, "-vn", "-codec:a", "libmp3lame", "-b:a", "192k", outputPath];
    case "gif":
      return ["-y", "-i", inputPath, "-vf", "fps=12,scale=480:-2:flags=lanczos", "-loop", "0", outputPath];
    case "mp4":
      return [
        "-y",
        "-i",
        inputPath,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        outputPath,
      ];
    case "preview":
      return [
        "-y",
        "-i",
        inputPath,
        "-t",
        "18",
        "-vf",
        "fps=1/3,scale=320:-2:flags=lanczos,tile=3x2:padding=4:margin=4",
        "-frames:v",
        "1",
        "-q:v",
        "3",
        outputPath,
      ];
    case "trim":
      return [
        "-y",
        "-ss",
        formatProcessSeconds(task.startSeconds),
        "-i",
        inputPath,
        "-t",
        formatProcessSeconds(task.durationSeconds),
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        outputPath,
      ];
    default:
      throw new LocalTaskError(`Unsupported media task: ${task.type}`, "invalid_task");
  }
}

function appendBoundedOutput(state, chunk, maxBytes) {
  const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
  if (state.bytes < maxBytes) {
    const remaining = maxBytes - state.bytes;
    state.chunks.push(buffer.subarray(0, remaining));
  }
  state.bytes += buffer.length;
}

function readBoundedOutput(state) {
  return Buffer.concat(state.chunks).toString("utf8");
}

async function readResponseBody(response, maxBytes) {
  const reader = response?.body?.getReader?.();
  if (!reader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) {
      throw new LocalTaskError(`入力ファイルは${Math.round(maxBytes / 1024 / 1024)}MBまでです。`, "input_too_large");
    }
    return buffer;
  }

  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new LocalTaskError(`入力ファイルは${Math.round(maxBytes / 1024 / 1024)}MBまでです。`, "input_too_large");
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks, totalBytes);
}

function runChildProcess(
  command,
  args,
  {
    cwd,
    maxOutputBytes = DEFAULT_MAX_PROCESS_OUTPUT_BYTES,
    signal,
    spawnImpl = nodeSpawn,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = {},
) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutHandle = null;
    let killHandle = null;
    const stdout = { bytes: 0, chunks: [] };
    const stderr = { bytes: 0, chunks: [] };

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (killHandle) clearTimeout(killHandle);
      signal?.removeEventListener?.("abort", abort);
      callback(value);
    };

    const abort = () => {
      if (settled) return;
      try {
        child?.kill?.("SIGTERM");
      } catch {
        // The process may already have exited.
      }
      killHandle = setTimeout(() => {
        try {
          child?.kill?.("SIGKILL");
        } catch {
          // Ignore a race with process shutdown.
        }
      }, 1_000);
      finish(reject, new LocalTaskError("メディア処理を停止しました。", "task_stopped"));
    };

    let child;
    try {
      child = spawnImpl(command, args, {
        cwd,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      finish(reject, error);
      return;
    }

    child.stdout?.on?.("data", (chunk) => appendBoundedOutput(stdout, chunk, maxOutputBytes));
    child.stderr?.on?.("data", (chunk) => appendBoundedOutput(stderr, chunk, maxOutputBytes));
    child.once?.("error", (error) => {
      if (error?.code === "ENOENT") {
        finish(reject, new LocalTaskError(`${command} が見つかりません。`, "tool_unavailable"));
        return;
      }
      finish(reject, error);
    });
    child.once?.("close", (code, signalName) => {
      if (code !== 0) {
        const detail = readBoundedOutput(stderr).trim().split("\n").slice(-3).join("\n");
        finish(
          reject,
          new LocalTaskError(
            detail ? `メディア処理に失敗しました: ${detail}` : `メディア処理に失敗しました (${signalName || code})`,
            "process_failed",
          ),
        );
        return;
      }
      if (stdout.bytes > maxOutputBytes) {
        finish(reject, new LocalTaskError("処理結果が大きすぎます。", "process_output_too_large"));
        return;
      }
      finish(resolve, {
        stdout: readBoundedOutput(stdout),
        stderr: readBoundedOutput(stderr),
      });
    });

    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener?.("abort", abort, { once: true });
    timeoutHandle = setTimeout(() => {
      try {
        child.kill?.("SIGTERM");
      } catch {
        // Ignore a race with process shutdown.
      }
      finish(reject, new LocalTaskError("メディア処理がタイムアウトしました。", "task_timeout"));
    }, timeoutMs);
  });
}

function isToolAvailable(command, spawnSyncImpl = nodeSpawnSync) {
  try {
    const result = spawnSyncImpl(command, ["-version"], {
      shell: false,
      windowsHide: true,
      stdio: "ignore",
    });
    return result?.status === 0;
  } catch {
    return false;
  }
}

class LocalTaskRunStore {
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

  stopAll() {
    const runs = [...this.#runs.values()];
    for (const run of runs) run.controller.abort();
    this.#runs.clear();
    return runs.length;
  }

  get size() {
    return this.#runs.size;
  }
}

class PendingMediaTaskStore {
  constructor({ ttlMs = DEFAULT_PENDING_TASK_TTL_MS } = {}) {
    this.tasks = new Map();
    this.ttlMs = ttlMs;
  }

  set(key, task, now = Date.now()) {
    const value = { task: { ...task }, expiresAt: now + this.ttlMs };
    this.tasks.set(key, value);
    return value;
  }

  get(key, now = Date.now()) {
    const value = this.tasks.get(key) ?? null;
    if (value && now >= value.expiresAt) {
      this.tasks.delete(key);
      return null;
    }
    return value;
  }

  take(key, now = Date.now()) {
    const value = this.get(key, now);
    if (value) this.tasks.delete(key);
    return value;
  }

  delete(key) {
    return this.tasks.delete(key);
  }
}

class FfmpegTaskRunner {
  constructor({
    ffmpegPath = process.env.FFMPEG_BIN?.trim() || ffmpegStaticPath || "ffmpeg",
    ffprobePath = process.env.FFPROBE_BIN?.trim() || ffprobeStatic?.path || "ffprobe",
    fetchImpl = globalThis.fetch,
    maxInputBytes = DEFAULT_MAX_INPUT_BYTES,
    maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
    maxProcessOutputBytes = DEFAULT_MAX_PROCESS_OUTPUT_BYTES,
    spawnImpl = nodeSpawn,
    spawnSyncImpl = nodeSpawnSync,
    tempRoot = process.env.MEDIA_TASK_TEMP_DIR?.trim() || DEFAULT_TEMP_ROOT,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = {}) {
    this.ffmpegPath = ffmpegPath;
    this.ffprobePath = ffprobePath;
    this.fetchImpl = fetchImpl;
    this.maxInputBytes = maxInputBytes;
    this.maxOutputBytes = maxOutputBytes;
    this.maxProcessOutputBytes = maxProcessOutputBytes;
    this.spawnImpl = spawnImpl;
    this.spawnSyncImpl = spawnSyncImpl;
    this.tempRoot = tempRoot;
    this.timeoutMs = timeoutMs;
  }

  isAvailable(type) {
    const command = type === "info" ? this.ffprobePath : this.ffmpegPath;
    return isToolAvailable(command, this.spawnSyncImpl);
  }

  async run(task, { attachment, signal } = {}) {
    if (!task || !OUTPUT_EXTENSIONS[task.type] && task.type !== "info") {
      throw new LocalTaskError("Unsupported media task.", "invalid_task");
    }
    if (!attachment || !isAllowedDiscordAssetUrl(attachment.url)) {
      throw new LocalTaskError("入力はDiscordの添付ファイルだけに対応しています。", "invalid_input");
    }
    if (signal?.aborted) throw new LocalTaskError("メディア処理を停止しました。", "task_stopped");

    const command = task.type === "info" ? this.ffprobePath : this.ffmpegPath;
    if (!isToolAvailable(command, this.spawnSyncImpl)) {
      throw new LocalTaskError(
        `${task.type === "info" ? "ffprobe" : "ffmpeg"} が利用できません。FFMPEG_BIN / FFPROBE_BIN を設定するか、実行環境にインストールしてください。`,
        "tool_unavailable",
      );
    }
    if (!this.fetchImpl) throw new LocalTaskError("ファイル取得機能が利用できません。", "fetch_unavailable");

    const declaredSize = Number(attachment.size);
    if (Number.isFinite(declaredSize) && declaredSize > this.maxInputBytes) {
      throw new LocalTaskError(`入力ファイルは${Math.round(this.maxInputBytes / 1024 / 1024)}MBまでです。`, "input_too_large");
    }

    await mkdir(this.tempRoot, { recursive: true });
    const taskDirectory = await mkdtemp(join(this.tempRoot, "task-"));
    try {
      const inputExtension = MEDIA_INPUT_EXTENSIONS.has(extname(attachment.name ?? "").toLowerCase())
        ? extname(attachment.name).toLowerCase()
        : ".media";
      const inputPath = join(taskDirectory, `${sanitizeBaseName(attachment.name)}${inputExtension}`);
      const outputPath = task.type === "info"
        ? null
        : join(taskDirectory, `miq-${task.type}-${randomUUID().slice(0, 8)}${OUTPUT_EXTENSIONS[task.type]}`);

      const response = await this.fetchImpl(attachment.url, { signal });
      if (!response?.ok) {
        throw new LocalTaskError(`添付ファイルを取得できませんでした (${response?.status ?? "unknown"})`, "download_failed");
      }
      const responseLength = Number(response.headers?.get?.("content-length"));
      if (Number.isFinite(responseLength) && responseLength > this.maxInputBytes) {
        throw new LocalTaskError(`入力ファイルは${Math.round(this.maxInputBytes / 1024 / 1024)}MBまでです。`, "input_too_large");
      }
      const inputBuffer = await readResponseBody(response, this.maxInputBytes);
      await writeFile(inputPath, inputBuffer, { flag: "wx" });

      if (task.type === "info") {
        const result = await runChildProcess(
          command,
          ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", inputPath],
          {
            cwd: taskDirectory,
            maxOutputBytes: this.maxProcessOutputBytes,
            signal,
            spawnImpl: this.spawnImpl,
            timeoutMs: this.timeoutMs,
          },
        );
        return { type: "info", text: formatMediaInfo(result.stdout) };
      }

      await runChildProcess(command, buildFfmpegArgs(task, inputPath, outputPath), {
        cwd: taskDirectory,
        maxOutputBytes: this.maxProcessOutputBytes,
        signal,
        spawnImpl: this.spawnImpl,
        timeoutMs: this.timeoutMs,
      });
      const outputStats = await stat(outputPath);
      if (!outputStats.isFile() || outputStats.size <= 0) {
        throw new LocalTaskError("処理結果ファイルが作成されませんでした。", "output_missing");
      }
      if (outputStats.size > this.maxOutputBytes) {
        throw new LocalTaskError(`処理結果は${Math.round(this.maxOutputBytes / 1024 / 1024)}MBまでです。`, "output_too_large");
      }
      const output = await readFile(outputPath);
      return {
        type: task.type,
        outputName: `miq-${task.type}${OUTPUT_EXTENSIONS[task.type]}`,
        output,
      };
    } finally {
      await rm(taskDirectory, { recursive: true, force: true }).catch(() => {});
    }
  }
}

function formatMediaInfo(rawJson) {
  let parsed;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new LocalTaskError("メディア情報を読み取れませんでした。", "invalid_tool_output");
  }

  const format = parsed?.format ?? {};
  const lines = [
    `形式: ${format.format_name || "unknown"}`,
    `長さ: ${format.duration ? `${Number(format.duration).toFixed(2)}秒` : "unknown"}`,
    `サイズ: ${format.size ? `${Math.round(Number(format.size) / 1024)}KB` : "unknown"}`,
  ];
  for (const stream of Array.isArray(parsed?.streams) ? parsed.streams.slice(0, 4) : []) {
    if (stream.codec_type === "video") {
      lines.push(`映像: ${stream.codec_name || "unknown"} ${stream.width || "?"}x${stream.height || "?"}`);
    } else if (stream.codec_type === "audio") {
      lines.push(`音声: ${stream.codec_name || "unknown"} ${stream.sample_rate || "?"}Hz`);
    }
  }
  return lines.join("\n").slice(0, 1_500);
}

export {
  DEFAULT_MAX_INPUT_BYTES,
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_PENDING_TASK_TTL_MS,
  DEFAULT_TIMEOUT_MS,
  FfmpegTaskRunner,
  LocalTaskError,
  LocalTaskRunStore,
  PendingMediaTaskStore,
  MEDIA_TASK_HELP,
  MEDIA_TASK_SIGNAL_PATTERN,
  formatMediaInfo,
  getMediaAttachment,
  hasMediaTaskSignal,
  isToolAvailable,
  parseMediaTaskRequest,
  runChildProcess,
};
