import { createServer } from "node:http";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  existsSync,
  readFileSync,
  renameSync,
  chmodSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

const X_AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";
const X_TOKEN_URL = "https://api.x.com/2/oauth2/token";
const X_USER_URL = "https://api.x.com/2/users/me";
const X_SCOPE = "users.read";
const X_VERIFICATION_DATA_VERSION = 1;
const X_VERIFICATION_STATE_TTL_MS = 10 * 60 * 1000;
const X_VERIFICATION_REVIEW_TTL_MS = 24 * 60 * 60 * 1000;
const X_VERIFICATION_ROLE_GRANT_TTL_MS = 5 * 60 * 1000;
const X_VERIFICATION_EXCHANGE_TTL_MS = 5 * 60 * 1000;
const X_VERIFICATION_NOTIFICATION_CLAIM_TTL_MS = 5 * 60 * 1000;
const X_VERIFICATION_RECORD_RETENTION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const X_VERIFICATION_REQUEST_TIMEOUT_MS = 15_000;
const X_VERIFICATION_STATUSES = Object.freeze([
  "awaiting_oauth",
  "exchanging",
  "awaiting_admin",
  "approved",
  "granting",
  "granted",
  "rejected",
  "cancelled",
  "expired",
  "left",
  "released",
]);

class XVerificationError extends Error {
  constructor(message, { code = "X_VERIFICATION_ERROR", status = 400 } = {}) {
    super(message);
    this.name = "XVerificationError";
    this.code = code;
    this.status = status;
  }
}

class XVerificationNotConfiguredError extends XVerificationError {
  constructor(message = "X OAuth is not configured.") {
    super(message, { code: "X_VERIFICATION_NOT_CONFIGURED", status: 503 });
    this.name = "XVerificationNotConfiguredError";
  }
}

class XVerificationConflictError extends XVerificationError {
  constructor(message = "This X account is already linked to another Discord user.") {
    super(message, { code: "X_VERIFICATION_CONFLICT", status: 409 });
    this.name = "XVerificationConflictError";
  }
}

function toBase64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function hashState(state) {
  return createHash("sha256").update(String(state ?? "")).digest("hex");
}

function createPkcePair(randomBytesImpl = randomBytes) {
  const verifier = toBase64Url(randomBytesImpl(32));
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createEmptyData() {
  return {
    version: X_VERIFICATION_DATA_VERSION,
    requests: {},
    links: {},
    panels: {},
  };
}

function normalizeRequest(value) {
  if (!value || typeof value !== "object") return null;
  const status = X_VERIFICATION_STATUSES.includes(value.status) ? value.status : null;
  if (!status || typeof value.id !== "string") return null;
  const request = {
    id: value.id,
    guildId: typeof value.guildId === "string" ? value.guildId : "",
    discordUserId: typeof value.discordUserId === "string" ? value.discordUserId : "",
    roleId: typeof value.roleId === "string" ? value.roleId : "",
    notificationChannelId: typeof value.notificationChannelId === "string"
      ? value.notificationChannelId
      : "",
    status,
    createdAt: Number.isSafeInteger(value.createdAt) ? value.createdAt : 0,
    expiresAt: Number.isSafeInteger(value.expiresAt) ? value.expiresAt : 0,
    reviewExpiresAt: Number.isSafeInteger(value.reviewExpiresAt) ? value.reviewExpiresAt : null,
    state: typeof value.state === "string" ? value.state : null,
    stateHash: typeof value.stateHash === "string" ? value.stateHash : null,
    codeVerifier: typeof value.codeVerifier === "string" ? value.codeVerifier : null,
    codeChallenge: typeof value.codeChallenge === "string" ? value.codeChallenge : null,
    xUserId: typeof value.xUserId === "string" ? value.xUserId : null,
    xUsername: typeof value.xUsername === "string" ? value.xUsername : null,
    xName: typeof value.xName === "string" ? value.xName : null,
    verifiedAt: Number.isSafeInteger(value.verifiedAt) ? value.verifiedAt : null,
    approvedAt: Number.isSafeInteger(value.approvedAt) ? value.approvedAt : null,
    approvedBy: typeof value.approvedBy === "string" ? value.approvedBy : null,
    roleGrantStartedAt: Number.isSafeInteger(value.roleGrantStartedAt) ? value.roleGrantStartedAt : null,
    roleGrantedAt: Number.isSafeInteger(value.roleGrantedAt) ? value.roleGrantedAt : null,
    notificationMessageId: typeof value.notificationMessageId === "string"
      ? value.notificationMessageId
      : null,
    notifiedAt: Number.isSafeInteger(value.notifiedAt) ? value.notifiedAt : null,
    notificationStartedAt: Number.isSafeInteger(value.notificationStartedAt)
      ? value.notificationStartedAt
      : null,
    rejectedAt: Number.isSafeInteger(value.rejectedAt) ? value.rejectedAt : null,
    rejectedBy: typeof value.rejectedBy === "string" ? value.rejectedBy : null,
  };
  if (!request.guildId || !request.discordUserId || !request.roleId) return null;
  return request;
}

function normalizeData(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== X_VERIFICATION_DATA_VERSION) {
    throw new XVerificationError("Verification data has an unsupported schema version.", {
      code: "X_VERIFICATION_DATA_SCHEMA_UNSUPPORTED",
      status: 500,
    });
  }
  const data = createEmptyData();
  if (value.requests !== undefined && (!value.requests || typeof value.requests !== "object" || Array.isArray(value.requests))) {
    throw new XVerificationError("Verification data requests are invalid.", {
      code: "X_VERIFICATION_DATA_SCHEMA_INVALID",
      status: 500,
    });
  }
  if (value.requests) {
    for (const [id, raw] of Object.entries(value.requests)) {
      const request = normalizeRequest({ ...raw, id: raw?.id ?? id });
      if (!request) {
        throw new XVerificationError("Verification data contains an invalid request.", {
          code: "X_VERIFICATION_DATA_SCHEMA_INVALID",
          status: 500,
        });
      }
      data.requests[request.id] = request;
    }
  }
  if (value.panels !== undefined && (!value.panels || typeof value.panels !== "object" || Array.isArray(value.panels))) {
    throw new XVerificationError("Verification data panels are invalid.", {
      code: "X_VERIFICATION_DATA_SCHEMA_INVALID",
      status: 500,
    });
  }
  if (value.panels) {
    for (const [key, raw] of Object.entries(value.panels)) {
      if (!raw || typeof raw !== "object"
        || typeof raw.guildId !== "string"
        || typeof raw.channelId !== "string"
        || typeof raw.messageId !== "string") {
        throw new XVerificationError("Verification data contains an invalid panel.", {
          code: "X_VERIFICATION_DATA_SCHEMA_INVALID",
          status: 500,
        });
      }
      data.panels[key] = {
        guildId: raw.guildId,
        channelId: raw.channelId,
        messageId: raw.messageId,
      };
    }
  }
  for (const request of Object.values(data.requests)) {
    if (!request.xUserId || ["rejected", "expired", "left", "released", "cancelled"].includes(request.status)) continue;
    const key = `${request.guildId}:${request.xUserId}`;
    const existing = data.links[key];
    if (existing && existing.discordUserId !== request.discordUserId) {
      throw new XVerificationError("Verification data contains a conflicting X account link.", {
        code: "X_VERIFICATION_DATA_CONFLICT",
        status: 500,
      });
    }
    data.links[key] = { requestId: request.id, discordUserId: request.discordUserId };
  }
  return data;
}

class XVerificationStore {
  constructor({ filePath } = {}) {
    if (!filePath) throw new Error("XVerificationStore filePath is required.");
    this.filePath = filePath;
    this.data = this.load();
    if (this.pruneTerminalRequests()) this.save();
  }

  load() {
    if (!existsSync(this.filePath)) return createEmptyData();
    try {
      return normalizeData(JSON.parse(readFileSync(this.filePath, "utf8")));
    } catch (error) {
      throw new XVerificationError(
        `Could not load verification data safely: ${error.message}`,
        { code: "X_VERIFICATION_DATA_CORRUPT", status: 500 },
      );
    }
  }

  save() {
    const serialized = `${JSON.stringify(this.data, null, 2)}\n`;
    const temporaryPath = `${this.filePath}.tmp`;
    try {
      writeFileSync(temporaryPath, serialized, { encoding: "utf8", mode: 0o600 });
      try {
        chmodSync(temporaryPath, 0o600);
      } catch {
        // Windows may not expose POSIX mode bits; keep the file local-only.
      }
      try {
        renameSync(temporaryPath, this.filePath);
      } catch {
        throw new Error("Could not atomically replace verification data file.");
      }
    } catch (error) {
      throw new XVerificationError(`Could not save verification data: ${error.message}`, {
        code: "X_VERIFICATION_STORAGE_ERROR",
        status: 500,
      });
    }
  }

  pruneTerminalRequests(now = Date.now()) {
    const terminalStatuses = new Set(["rejected", "expired", "left", "released", "cancelled"]);
    let changed = false;
    for (const request of Object.values(this.data.requests)) {
      if (!terminalStatuses.has(request.status)) continue;
      const endedAt = Math.max(
        request.rejectedAt ?? 0,
        request.roleGrantedAt ?? 0,
        request.verifiedAt ?? 0,
        request.createdAt ?? 0,
      );
      if (endedAt > now - X_VERIFICATION_RECORD_RETENTION_TTL_MS) continue;
      const linkKey = request.xUserId ? `${request.guildId}:${request.xUserId}` : null;
      if (linkKey && this.data.links[linkKey]?.requestId === request.id) delete this.data.links[linkKey];
      delete this.data.requests[request.id];
      changed = true;
    }
    return changed;
  }

  getRequest(requestId) {
    return clone(this.data.requests[requestId]);
  }

  listRequests() {
    return Object.values(this.data.requests).map(clone);
  }

  panelKey(guildId, channelId) {
    return `${guildId}:${channelId}`;
  }

  getPanel(guildId, channelId) {
    return clone(this.data.panels[this.panelKey(guildId, channelId)]);
  }

  setPanel(guildId, channelId, messageId) {
    this.data.panels[this.panelKey(guildId, channelId)] = {
      guildId: String(guildId),
      channelId: String(channelId),
      messageId: String(messageId),
    };
    this.save();
    return this.getPanel(guildId, channelId);
  }

  clearPanel(guildId, channelId, messageId = null) {
    const key = this.panelKey(guildId, channelId);
    const current = this.data.panels[key];
    if (!current || (messageId !== null && current.messageId !== String(messageId))) return false;
    delete this.data.panels[key];
    this.save();
    return true;
  }

  findRequestByState(state) {
    if (typeof state !== "string" || state.length === 0) return null;
    const stateHashValue = hashState(state);
    return Object.values(this.data.requests).find((request) =>
      request.stateHash === stateHashValue || request.state === state,
    ) ?? null;
  }

  findActiveRequest(guildId, discordUserId, now = Date.now()) {
    const activeStatuses = new Set(["awaiting_oauth", "exchanging", "awaiting_admin", "approved", "granting"]);
    let changed = false;
    const matches = [];
    for (const request of Object.values(this.data.requests)) {
      if (request.guildId !== guildId || request.discordUserId !== discordUserId) continue;
      if (request.status === "awaiting_oauth" && request.expiresAt <= now) {
        request.status = "expired";
        request.state = null;
        request.stateHash = null;
        request.codeVerifier = null;
        request.codeChallenge = null;
        changed = true;
        continue;
      }
      if (request.status === "exchanging" && request.createdAt <= now - X_VERIFICATION_EXCHANGE_TTL_MS) {
        request.status = "cancelled";
        request.state = null;
        request.stateHash = null;
        request.codeVerifier = null;
        request.codeChallenge = null;
        request.rejectedAt = now;
        changed = true;
        continue;
      }
      if (request.status === "awaiting_admin" && request.reviewExpiresAt !== null && request.reviewExpiresAt <= now) {
        request.status = "expired";
        if (this.data.links[`${request.guildId}:${request.xUserId}`]?.requestId === request.id) {
          delete this.data.links[`${request.guildId}:${request.xUserId}`];
        }
        changed = true;
        continue;
      }
      if (activeStatuses.has(request.status)) matches.push(request);
    }
    if (changed) this.save();
    return matches.sort((left, right) => right.createdAt - left.createdAt)[0] ?? null;
  }

  findRecentRequest(guildId, discordUserId, now = Date.now(), windowMs = X_VERIFICATION_STATE_TTL_MS) {
    return Object.values(this.data.requests)
      .filter((request) =>
        request.guildId === guildId
        && request.discordUserId === discordUserId
        && request.createdAt > now - windowMs,
      )
      .sort((left, right) => right.createdAt - left.createdAt)[0] ?? null;
  }

  createRequest({ guildId, discordUserId, roleId, notificationChannelId, now, state, codeVerifier, codeChallenge, ttlMs }) {
    if (!guildId || !discordUserId || !roleId || !notificationChannelId) {
      throw new TypeError("guildId, discordUserId, roleId, and notificationChannelId are required.");
    }
    const createdAt = Number.isSafeInteger(now) ? now : Date.now();
    const request = {
      id: randomUUID(),
      guildId,
      discordUserId,
      roleId,
      notificationChannelId,
      status: "awaiting_oauth",
      createdAt,
      expiresAt: createdAt + (Number.isSafeInteger(ttlMs) ? ttlMs : X_VERIFICATION_STATE_TTL_MS),
      reviewExpiresAt: null,
      state: null,
      stateHash: hashState(state),
      codeVerifier,
      codeChallenge,
      xUserId: null,
      xUsername: null,
      xName: null,
      verifiedAt: null,
      approvedAt: null,
      approvedBy: null,
      roleGrantStartedAt: null,
      roleGrantedAt: null,
      notificationMessageId: null,
      notifiedAt: null,
      notificationStartedAt: null,
      rejectedAt: null,
      rejectedBy: null,
    };
    this.data.requests[request.id] = request;
    this.save();
    return clone(request);
  }

  beginCallback(state, now = Date.now()) {
    const request = this.findRequestByState(state);
    if (!request) {
      throw new XVerificationError("X OAuth state is invalid or expired.", {
        code: "X_VERIFICATION_INVALID_STATE",
        status: 400,
      });
    }
    if (request.expiresAt <= now || request.status !== "awaiting_oauth") {
      if (request.status === "awaiting_oauth" && request.expiresAt <= now) {
        this.data.requests[request.id].status = "expired";
        this.save();
      }
      throw new XVerificationError("X OAuth state is invalid or expired.", {
        code: "X_VERIFICATION_INVALID_STATE",
        status: 400,
      });
    }
    this.data.requests[request.id].status = "exchanging";
    this.save();
    return clone(this.data.requests[request.id]);
  }

  cancelRequest(requestId, now = Date.now(), { allowExchanging = false } = {}) {
    const request = this.data.requests[requestId];
    const cancellableStatuses = allowExchanging
      ? ["awaiting_oauth", "exchanging"]
      : ["awaiting_oauth"];
    if (!request || !cancellableStatuses.includes(request.status)) return false;
    request.status = "cancelled";
    request.state = null;
    request.stateHash = null;
    request.codeVerifier = null;
    request.codeChallenge = null;
    request.rejectedAt = now;
    this.save();
    return true;
  }

  cancelActiveRequests(guildId, discordUserId) {
    let changed = false;
    for (const request of Object.values(this.data.requests)) {
      if (request.guildId !== guildId || request.discordUserId !== discordUserId) continue;
      if (request.status !== "awaiting_oauth") continue;
      request.status = "cancelled";
      request.state = null;
      request.stateHash = null;
      request.codeVerifier = null;
      request.codeChallenge = null;
      changed = true;
    }
    if (changed) this.save();
    return changed;
  }

  markVerified(requestId, xUser, now = Date.now()) {
    const request = this.data.requests[requestId];
    if (!request || request.status !== "exchanging") {
      throw new XVerificationError("The X verification request is no longer active.", {
        code: "X_VERIFICATION_NOT_ACTIVE",
        status: 409,
      });
    }
    const xUserId = String(xUser?.id ?? "");
    const xUsername = String(xUser?.username ?? "");
    const xName = String(xUser?.name ?? "");
    if (!/^\d+$/.test(xUserId) || !xUsername || !xName) {
      throw new XVerificationError("X returned an incomplete user profile.", {
        code: "X_VERIFICATION_INVALID_PROFILE",
        status: 502,
      });
    }

    const linkKey = `${request.guildId}:${xUserId}`;
    const existingMemberLink = Object.values(this.data.requests).find((candidate) =>
      candidate.id !== requestId
      && candidate.guildId === request.guildId
      && candidate.discordUserId === request.discordUserId
      && ["awaiting_admin", "approved", "granting", "granted"].includes(candidate.status),
    );
    if (existingMemberLink) {
      throw new XVerificationConflictError("This Discord user already has an active link to an X account.");
    }
    const existingLink = this.data.links[linkKey];
    if (existingLink && existingLink.requestId !== requestId) {
      const existingRequest = this.data.requests[existingLink.requestId];
      if (["rejected", "expired", "left", "released", "cancelled"].includes(existingRequest?.status)) {
        delete this.data.links[linkKey];
      } else {
        throw new XVerificationConflictError(
          existingLink.discordUserId === request.discordUserId
            ? "This Discord user already has an active link to this X account."
            : undefined,
        );
      }
    }

    for (const candidate of Object.values(this.data.requests)) {
      if (candidate.id === requestId
        || candidate.guildId !== request.guildId
        || candidate.discordUserId !== request.discordUserId
        || candidate.status !== "awaiting_oauth") continue;
      candidate.status = "cancelled";
      candidate.state = null;
      candidate.stateHash = null;
      candidate.codeVerifier = null;
      candidate.codeChallenge = null;
      candidate.rejectedAt = now;
    }

    Object.assign(request, {
      status: "awaiting_admin",
      state: null,
      stateHash: null,
      codeVerifier: null,
      codeChallenge: null,
      xUserId,
      xUsername,
      xName,
      verifiedAt: now,
      reviewExpiresAt: now + X_VERIFICATION_REVIEW_TTL_MS,
      notificationMessageId: null,
      notifiedAt: null,
    });
    this.data.links[linkKey] = {
      requestId,
      discordUserId: request.discordUserId,
    };
    this.save();
    return clone(request);
  }

  approveRequest(requestId, approvedBy, now = Date.now()) {
    const request = this.data.requests[requestId];
    if (!request || request.status !== "awaiting_admin") {
      throw new XVerificationError("This verification request is no longer awaiting approval.", {
        code: "X_VERIFICATION_NOT_PENDING",
        status: 409,
      });
    }
    if (request.reviewExpiresAt !== null && request.reviewExpiresAt <= now) {
      request.status = "expired";
      const linkKey = `${request.guildId}:${request.xUserId}`;
      if (this.data.links[linkKey]?.requestId === requestId) delete this.data.links[linkKey];
      this.save();
      throw new XVerificationError("This verification request has expired.", {
        code: "X_VERIFICATION_EXPIRED",
        status: 409,
      });
    }
    request.status = "approved";
    request.approvedAt = now;
    request.approvedBy = String(approvedBy ?? "");
    this.save();
    return clone(request);
  }

  beginRoleGrant(requestId, now = Date.now()) {
    const request = this.data.requests[requestId];
    if (!request || request.status !== "approved") {
      throw new XVerificationError("This verification request is not ready for role assignment.", {
        code: "X_VERIFICATION_NOT_APPROVED",
        status: 409,
      });
    }
    if (request.reviewExpiresAt !== null && request.reviewExpiresAt <= now) {
      request.status = "expired";
      const linkKey = `${request.guildId}:${request.xUserId}`;
      if (this.data.links[linkKey]?.requestId === requestId) delete this.data.links[linkKey];
      this.save();
      throw new XVerificationError("This verification request has expired.", {
        code: "X_VERIFICATION_EXPIRED",
        status: 409,
      });
    }
    request.status = "granting";
    request.roleGrantStartedAt = now;
    this.save();
    return clone(request);
  }

  recoverStaleRoleGrant(requestId, now = Date.now()) {
    const request = this.data.requests[requestId];
    if (!request || request.status !== "granting") return false;
    const startedAt = request.roleGrantStartedAt ?? 0;
    if (startedAt > now - X_VERIFICATION_ROLE_GRANT_TTL_MS) return false;
    request.status = "approved";
    request.roleGrantStartedAt = null;
    this.save();
    return true;
  }

  markRoleGrantFailed(requestId) {
    const request = this.data.requests[requestId];
    if (!request || request.status !== "granting") return false;
    request.status = "approved";
    request.roleGrantStartedAt = null;
    this.save();
    return true;
  }

  markRoleGranted(requestId, now = Date.now()) {
    const request = this.data.requests[requestId];
    if (!request || request.status !== "granting") {
      throw new XVerificationError("This verification request is not being granted.", {
        code: "X_VERIFICATION_NOT_GRANTING",
        status: 409,
      });
    }
    request.status = "granted";
    request.roleGrantStartedAt = null;
    request.roleGrantedAt = now;
    this.save();
    return clone(request);
  }

  markNotificationSent(requestId, messageId, now = Date.now()) {
    const request = this.data.requests[requestId];
    if (!request || request.status !== "awaiting_admin") return false;
    request.notificationMessageId = String(messageId ?? "");
    request.notifiedAt = now;
    request.notificationStartedAt = null;
    this.save();
    return true;
  }

  claimNotification(requestId, now = Date.now()) {
    const request = this.data.requests[requestId];
    if (!request || request.status !== "awaiting_admin" || request.notificationMessageId) return false;
    if (request.notificationStartedAt !== null
      && request.notificationStartedAt > now - X_VERIFICATION_NOTIFICATION_CLAIM_TTL_MS) {
      return false;
    }
    request.notificationStartedAt = now;
    this.save();
    return true;
  }

  releaseNotificationClaim(requestId) {
    const request = this.data.requests[requestId];
    if (!request || request.status !== "awaiting_admin" || request.notificationMessageId) return false;
    if (request.notificationStartedAt === null) return false;
    request.notificationStartedAt = null;
    this.save();
    return true;
  }

  listPendingNotifications(now = Date.now()) {
    let changed = false;
    const pending = [];
    for (const request of Object.values(this.data.requests)) {
      if (request.status !== "awaiting_admin") continue;
      if (request.reviewExpiresAt !== null && request.reviewExpiresAt <= now) {
        request.status = "expired";
        if (this.data.links[`${request.guildId}:${request.xUserId}`]?.requestId === request.id) {
          delete this.data.links[`${request.guildId}:${request.xUserId}`];
        }
        changed = true;
        continue;
      }
      if (!request.notificationMessageId) pending.push(clone(request));
    }
    if (changed) this.save();
    return pending;
  }

  rejectRequest(requestId, rejectedBy, now = Date.now()) {
    const request = this.data.requests[requestId];
    if (!request || request.status !== "awaiting_admin") {
      throw new XVerificationError("This verification request is no longer awaiting approval.", {
        code: "X_VERIFICATION_NOT_PENDING",
        status: 409,
      });
    }
    if (request.reviewExpiresAt !== null && request.reviewExpiresAt <= now) {
      request.status = "expired";
      const linkKey = `${request.guildId}:${request.xUserId}`;
      if (this.data.links[linkKey]?.requestId === requestId) delete this.data.links[linkKey];
      this.save();
      throw new XVerificationError("This verification request has expired.", {
        code: "X_VERIFICATION_EXPIRED",
        status: 409,
      });
    }
    request.status = "rejected";
    request.rejectedAt = now;
    request.rejectedBy = String(rejectedBy ?? "");
    const linkKey = `${request.guildId}:${request.xUserId}`;
    if (this.data.links[linkKey]?.requestId === requestId) delete this.data.links[linkKey];
    this.save();
    return clone(request);
  }

  markLeftForMember(guildId, discordUserId) {
    let changed = false;
    for (const request of Object.values(this.data.requests)) {
      if (request.guildId !== guildId || request.discordUserId !== discordUserId) continue;
      if (["awaiting_oauth", "exchanging", "awaiting_admin", "approved", "granting", "granted"].includes(request.status)) {
        request.status = "left";
        request.state = null;
        request.stateHash = null;
        request.codeVerifier = null;
        request.codeChallenge = null;
        request.notificationStartedAt = null;
        if (request.xUserId && this.data.links[`${guildId}:${request.xUserId}`]?.requestId === request.id) {
          delete this.data.links[`${guildId}:${request.xUserId}`];
        }
        changed = true;
      }
    }
    if (changed) this.save();
    return changed;
  }

  reconcileMember(guildId, discordUserId, { hasVerifiedRole = false } = {}) {
    let changed = false;
    for (const request of Object.values(this.data.requests)) {
      if (request.guildId !== guildId || request.discordUserId !== discordUserId) continue;
      if (request.status !== "granted" || hasVerifiedRole) continue;
      request.status = "released";
      const linkKey = `${guildId}:${request.xUserId}`;
      if (this.data.links[linkKey]?.requestId === request.id) delete this.data.links[linkKey];
      changed = true;
    }
    if (changed) this.save();
    return changed;
  }
}

function createBasicAuth(clientId, clientSecret) {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

class XVerificationService {
  constructor({
    clientId,
    clientSecret,
    redirectUri,
    store,
    fetchImpl = globalThis.fetch,
    now = () => Date.now(),
    randomBytesImpl = randomBytes,
    stateTtlMs = X_VERIFICATION_STATE_TTL_MS,
    requestTimeoutMs = X_VERIFICATION_REQUEST_TIMEOUT_MS,
  } = {}) {
    this.clientId = clientId?.trim() ?? "";
    this.clientSecret = clientSecret?.trim() ?? "";
    this.redirectUri = redirectUri?.trim() ?? "";
    this.store = store;
    this.fetch = fetchImpl;
    this.now = now;
    this.randomBytes = randomBytesImpl;
    this.stateTtlMs = stateTtlMs;
    this.requestTimeoutMs = requestTimeoutMs;
    this.callbackServer = null;
  }

  isConfigured() {
    return Boolean(
      this.clientId &&
      this.clientSecret &&
      this.redirectUri &&
      this.store &&
      this.fetch,
    );
  }

  ensureConfigured() {
    if (!this.isConfigured()) throw new XVerificationNotConfiguredError();
    let redirect;
    try {
      redirect = new URL(this.redirectUri);
    } catch {
      throw new XVerificationNotConfiguredError("X OAuth redirect URI is invalid.");
    }
    if (redirect.protocol !== "https:") {
      throw new XVerificationNotConfiguredError("X OAuth redirect URI must use HTTPS.");
    }
  }

  createAuthorizationUrl({ guildId, discordUserId, roleId, notificationChannelId }) {
    this.ensureConfigured();
    const existing = this.store.findActiveRequest(guildId, discordUserId, this.now());
    if (existing && existing.status !== "awaiting_oauth") {
      throw new XVerificationError("This Discord user's X verification is already in progress.", {
        code: "X_VERIFICATION_USER_IN_PROGRESS",
        status: 409,
      });
    }
    const state = toBase64Url(this.randomBytes(32));
    const { verifier, challenge } = createPkcePair(this.randomBytes);
    this.store.createRequest({
      guildId,
      discordUserId,
      roleId,
      notificationChannelId,
      now: this.now(),
      state,
      codeVerifier: verifier,
      codeChallenge: challenge,
      ttlMs: this.stateTtlMs,
    });
    const url = new URL(X_AUTHORIZE_URL);
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      scope: X_SCOPE,
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();
    return url.toString();
  }

  async exchangeCode(code, codeVerifier) {
    const response = await this.fetchWithTimeout(X_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: createBasicAuth(this.clientId, this.clientSecret),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: this.redirectUri,
        code_verifier: codeVerifier,
      }),
    });
    const data = await this.readJson(response, "X OAuth token exchange failed.");
    if (!response.ok || typeof data?.access_token !== "string" || !data.access_token) {
      throw new XVerificationError("X OAuth token exchange failed.", {
        code: "X_VERIFICATION_TOKEN_EXCHANGE_FAILED",
        status: response.ok ? 502 : response.status,
      });
    }
    return data.access_token;
  }

  async fetchAuthenticatedUser(accessToken) {
    const response = await this.fetchWithTimeout(X_USER_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await this.readJson(response, "X authenticated user lookup failed.");
    if (!response.ok || !data?.data) {
      throw new XVerificationError("X authenticated user lookup failed.", {
        code: "X_VERIFICATION_USER_LOOKUP_FAILED",
        status: response.ok ? 502 : response.status,
      });
    }
    return data.data;
  }

  async fetchWithTimeout(url, options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      return await this.fetch(url, { ...options, signal: controller.signal });
    } catch {
      throw new XVerificationError("X API request failed or timed out.", {
        code: "X_VERIFICATION_NETWORK_ERROR",
        status: 502,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async readJson(response, message) {
    try {
      return await response.json();
    } catch {
      throw new XVerificationError(message, {
        code: "X_VERIFICATION_INVALID_RESPONSE",
        status: 502,
      });
    }
  }

  async handleCallback(requestUrl) {
    this.ensureConfigured();
    const url = new URL(requestUrl, this.redirectUri);
    const redirect = new URL(this.redirectUri);
    const fixedQueryMatches = [...redirect.searchParams].every(([key, value]) =>
      url.searchParams.getAll(key).length === 1 && url.searchParams.get(key) === value,
    );
    if (url.origin !== redirect.origin || url.pathname !== redirect.pathname || url.hash || !fixedQueryMatches) {
      throw new XVerificationError("X OAuth callback URL does not match the configured redirect URI.", {
        code: "X_VERIFICATION_REDIRECT_MISMATCH",
        status: 400,
      });
    }
    const state = url.searchParams.get("state");
    if (!state) {
      throw new XVerificationError("X OAuth state is missing.", {
        code: "X_VERIFICATION_STATE_MISSING",
        status: 400,
      });
    }
    if (url.searchParams.get("error")) {
      const pending = this.store.findRequestByState(state);
      if (pending) this.store.cancelRequest(pending.id, this.now());
      throw new XVerificationError("X OAuth authorization was cancelled.", {
        code: "X_VERIFICATION_CANCELLED",
        status: 400,
      });
    }
    const code = url.searchParams.get("code");
    if (!code) {
      throw new XVerificationError("X OAuth authorization code is missing.", {
        code: "X_VERIFICATION_CODE_MISSING",
        status: 400,
      });
    }
    const request = this.store.beginCallback(state, this.now());
    try {
      const accessToken = await this.exchangeCode(code, request.codeVerifier);
      const xUser = await this.fetchAuthenticatedUser(accessToken);
      const verifiedRequest = this.store.markVerified(request.id, xUser, this.now());
      return { request: verifiedRequest, xUser };
    } catch (error) {
      this.store.cancelRequest(request.id, this.now(), { allowExchanging: true });
      throw error;
    }
  }

  async startCallbackServer({ host = "127.0.0.1", port = null, onVerified } = {}) {
    this.ensureConfigured();
    if (this.callbackServer) return this.callbackServer;
    const redirect = new URL(this.redirectUri);
    const callbackPath = redirect.pathname || "/";
    const listenPort = port || Number.parseInt(redirect.port, 10) || 8788;
    const server = createServer((request, response) => {
      const responseHeaders = {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        Pragma: "no-cache",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
      };
      if (request.method !== "GET") {
        response.writeHead(405, responseHeaders);
        response.end("Method Not Allowed");
        return;
      }
      const requestUrl = new URL(request.url ?? "/", this.redirectUri);
      if (requestUrl.pathname !== callbackPath) {
        response.writeHead(404, responseHeaders);
        response.end("Not found");
        return;
      }
      void this.handleCallback(requestUrl.toString())
        .then(async ({ request: verificationRequest, xUser }) => {
          let notificationPending = false;
          try {
            await onVerified?.(verificationRequest, xUser);
          } catch (error) {
            notificationPending = true;
            console.error(`[x-verification] Verification succeeded but admin notification is pending: ${error.message}`);
          }
          response.writeHead(200, responseHeaders);
          response.end(
            `<html><meta charset="utf-8"><title>Xアカウント確認完了</title><body><h1>Xアカウント確認が完了しました</h1><p>${escapeHtml(xUser.name)} (@${escapeHtml(xUser.username)}) を確認しました。${notificationPending ? "管理者への通知は再試行されます。" : "Discordの管理者による承認を待ってください。"}</p></body></html>`,
          );
        })
        .catch((error) => {
          const status = error.status && error.status >= 400 && error.status < 600 ? error.status : 500;
          response.writeHead(status, responseHeaders);
          response.end(
            `<html><meta charset="utf-8"><title>Xアカウント確認エラー</title><body><h1>Xアカウント確認に失敗しました</h1><p>${escapeHtml(error.message)}</p><p>Discordに戻って、もう一度認証を開始してください。</p></body></html>`,
          );
        });
    });
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        server.removeListener("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.removeListener("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(listenPort, host);
    });
    this.callbackServer = server;
    return server;
  }

  close() {
    this.callbackServer?.close();
    this.callbackServer = null;
  }
}

export {
  X_AUTHORIZE_URL,
  X_SCOPE,
  X_TOKEN_URL,
  X_USER_URL,
  X_VERIFICATION_REVIEW_TTL_MS,
  X_VERIFICATION_ROLE_GRANT_TTL_MS,
  X_VERIFICATION_REQUEST_TIMEOUT_MS,
  X_VERIFICATION_STATE_TTL_MS,
  X_VERIFICATION_STATUSES,
  XVerificationConflictError,
  XVerificationError,
  XVerificationNotConfiguredError,
  XVerificationService,
  XVerificationStore,
  createPkcePair,
};
