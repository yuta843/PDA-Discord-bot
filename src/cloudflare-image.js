import {
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { getDateKey } from "./economy.js";
import { IMAGE_UNLIMITED_USER_ID } from "./image-access.js";

const CLOUDFLARE_FLUX_MODEL = "@cf/black-forest-labs/flux-1-schnell";
const DEFAULT_IMAGE_DAILY_LIMIT = 5;
const MAX_IMAGE_PROMPT_LENGTH = 2_048;
const IMAGE_USAGE_VERSION = 1;

class CloudflareImageError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "CloudflareImageError";
    this.status = options.status;
  }
}

function createEmptyUsageData() {
  return { version: IMAGE_USAGE_VERSION, users: {} };
}

function normalizeUsageData(value, limit) {
  const data = createEmptyUsageData();
  if (!value || typeof value !== "object" || !value.users || typeof value.users !== "object") {
    return data;
  }

  for (const [userId, record] of Object.entries(value.users)) {
    if (!record || typeof record !== "object") continue;
    const dateKey = typeof record.dateKey === "string" && /^\d{4}-\d{2}-\d{2}$/.test(record.dateKey)
      ? record.dateKey
      : null;
    const count = Number(record.count);
    if (!dateKey || !Number.isSafeInteger(count) || count < 0) continue;
    data.users[userId] = {
      dateKey,
      count: Math.min(count, limit),
    };
  }
  return data;
}

class DailyImageUsageStore {
  constructor({
    filePath,
    limit = DEFAULT_IMAGE_DAILY_LIMIT,
    unlimitedUserIds = [IMAGE_UNLIMITED_USER_ID],
  } = {}) {
    if (!filePath) throw new Error("DailyImageUsageStore filePath is required.");
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new Error("DailyImageUsageStore limit must be a positive integer.");
    }
    this.filePath = filePath;
    this.limit = limit;
    this.unlimitedUserIds = new Set(unlimitedUserIds);
    this.data = this.load();
  }

  isUnlimited(userId) {
    return this.unlimitedUserIds.has(userId);
  }

  load() {
    if (!existsSync(this.filePath)) return createEmptyUsageData();
    try {
      return normalizeUsageData(JSON.parse(readFileSync(this.filePath, "utf8")), this.limit);
    } catch (error) {
      console.warn(`[image-usage] Could not load usage data: ${error.message}`);
      return createEmptyUsageData();
    }
  }

  save() {
    const serialized = `${JSON.stringify(this.data, null, 2)}\n`;
    const temporaryPath = `${this.filePath}.tmp`;
    try {
      writeFileSync(temporaryPath, serialized, "utf8");
      try {
        renameSync(temporaryPath, this.filePath);
      } catch {
        writeFileSync(this.filePath, serialized, "utf8");
        rmSync(temporaryPath, { force: true });
      }
    } catch (error) {
      console.error(`[image-usage] Could not save usage data: ${error.message}`);
    }
  }

  getStatus(userId, now = Date.now()) {
    const dateKey = getDateKey(now);
    if (this.isUnlimited(userId)) {
      return {
        allowed: true,
        dateKey,
        used: 0,
        remaining: null,
        limit: null,
        unlimited: true,
      };
    }
    const record = this.data.users[userId];
    const used = record?.dateKey === dateKey ? record.count : 0;
    return {
      allowed: used < this.limit,
      dateKey,
      used,
      remaining: Math.max(this.limit - used, 0),
      limit: this.limit,
    };
  }

  tryConsume(userId, now = Date.now()) {
    const status = this.getStatus(userId, now);
    if (status.unlimited) return status;
    if (!status.allowed) return status;

    this.data.users[userId] = {
      dateKey: status.dateKey,
      count: status.used + 1,
    };
    this.save();
    return {
      ...status,
      allowed: true,
      used: status.used + 1,
      remaining: status.remaining - 1,
    };
  }

  refund(userId, dateKey) {
    const record = this.data.users[userId];
    if (!record || record.dateKey !== dateKey || record.count < 1) return false;
    record.count -= 1;
    this.save();
    return true;
  }
}

function getCloudflareErrorMessage(payload, status) {
  const messages = Array.isArray(payload?.errors)
    ? payload.errors.map((error) => error?.message).filter(Boolean)
    : [];
  return messages.join("; ") || `Cloudflare image request failed (${status ?? "unknown"}).`;
}

function extractImageBase64(payload) {
  const result = payload?.result;
  if (typeof result === "string") return result;
  if (typeof result?.image === "string") return result.image;
  if (typeof result?.b64_json === "string") return result.b64_json;
  if (typeof result?.data?.[0]?.b64_json === "string") return result.data[0].b64_json;
  return null;
}

class CloudflareImageService {
  constructor({ accountId, apiToken, model = CLOUDFLARE_FLUX_MODEL, fetchImpl = fetch } = {}) {
    this.accountId = accountId?.trim() || "";
    this.apiToken = apiToken?.trim() || "";
    this.model = model;
    this.fetchImpl = fetchImpl;
  }

  isConfigured() {
    return Boolean(this.accountId && this.apiToken);
  }

  async generate(prompt, { steps = 4 } = {}) {
    const normalizedPrompt = String(prompt ?? "").trim();
    if (!normalizedPrompt) throw new CloudflareImageError("Image prompt is required.");
    if (normalizedPrompt.length > MAX_IMAGE_PROMPT_LENGTH) {
      throw new CloudflareImageError(`Image prompt must be ${MAX_IMAGE_PROMPT_LENGTH} characters or fewer.`);
    }
    if (!this.isConfigured()) {
      throw new CloudflareImageError("Cloudflare Workers AI is not configured.");
    }

    const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this.accountId)}/ai/run/${this.model}`;
    let response;
    try {
      response = await this.fetchImpl(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ prompt: normalizedPrompt, steps }),
        signal: AbortSignal.timeout(90_000),
      });
    } catch (error) {
      throw new CloudflareImageError("Cloudflare image generation could not be reached.", {
        cause: error,
      });
    }

    const contentType = response?.headers?.get?.("content-type") ?? "";
    if (contentType.toLowerCase().startsWith("image/")) {
      if (!response.ok) {
        throw new CloudflareImageError(
          `Cloudflare image request failed (${response.status ?? "unknown"}).`,
          { status: response.status },
        );
      }
      return Buffer.from(await response.arrayBuffer());
    }

    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      throw new CloudflareImageError("Cloudflare returned an invalid image response.", {
        cause: error,
        status: response?.status,
      });
    }

    if (!response?.ok || payload?.success === false) {
      throw new CloudflareImageError(
        getCloudflareErrorMessage(payload, response?.status),
        { status: response?.status },
      );
    }

    const encoded = extractImageBase64(payload)?.replace(/^data:image\/[^;]+;base64,/, "");
    if (!encoded) throw new CloudflareImageError("Cloudflare returned no generated image.");
    const image = Buffer.from(encoded, "base64");
    if (image.length === 0) throw new CloudflareImageError("Cloudflare returned an empty image.");
    return image;
  }
}

export {
  CLOUDFLARE_FLUX_MODEL,
  DEFAULT_IMAGE_DAILY_LIMIT,
  MAX_IMAGE_PROMPT_LENGTH,
  CloudflareImageError,
  CloudflareImageService,
  DailyImageUsageStore,
};
