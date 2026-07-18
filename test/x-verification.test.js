import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  X_SCOPE,
  XVerificationConflictError,
  XVerificationError,
  XVerificationService,
  XVerificationStore,
  createPkcePair,
} from "../src/x-verification.js";

function createStore() {
  const directory = mkdtempSync(join(tmpdir(), "x-verification-"));
  return new XVerificationStore({ filePath: join(directory, "verification.json") });
}

function createService(store, overrides = {}) {
  return new XVerificationService({
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectUri: "https://verify.example.test/x/callback",
    store,
    now: () => 1_700_000_000_000,
    randomBytesImpl: (size) => Buffer.alloc(size, 7),
    ...overrides,
  });
}

test("creates a PKCE authorization URL with the Discord-bound request state", () => {
  const store = createStore();
  const service = createService(store);
  const url = new URL(service.createAuthorizationUrl({
    guildId: "guild-1",
    discordUserId: "discord-1",
    roleId: "role-1",
    notificationChannelId: "channel-1",
  }));
  assert.equal(url.origin + url.pathname, "https://x.com/i/oauth2/authorize");
  assert.equal(url.searchParams.get("scope"), X_SCOPE);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("redirect_uri"), "https://verify.example.test/x/callback");
  const request = store.findRequestByState(url.searchParams.get("state"));
  assert.equal(request.guildId, "guild-1");
  assert.equal(request.discordUserId, "discord-1");
  assert.equal(request.codeChallenge, url.searchParams.get("code_challenge"));
});

test("handles X callback, stores only the verified profile, and consumes state once", async () => {
  const store = createStore();
  const requests = [];
  const service = createService(store, {
    fetchImpl: async (url, options = {}) => {
      requests.push({ url, options });
      if (url === "https://api.x.com/2/oauth2/token") {
        return { ok: true, status: 200, json: async () => ({ access_token: "secret-token" }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { id: "123456789", username: "alice", name: "Alice" } }),
      };
    },
  });
  const authorizationUrl = new URL(service.createAuthorizationUrl({
    guildId: "guild-1",
    discordUserId: "discord-1",
    roleId: "role-1",
    notificationChannelId: "channel-1",
  }));
  const result = await service.handleCallback(
    `https://verify.example.test/x/callback?code=auth-code&state=${authorizationUrl.searchParams.get("state")}`,
  );
  assert.deepEqual(result.xUser, { id: "123456789", username: "alice", name: "Alice" });
  assert.equal(result.request.status, "awaiting_admin");
  assert.equal(requests.length, 2);
  assert.match(requests[0].options.headers.Authorization, /^Basic /);
  const tokenBody = String(requests[0].options.body);
  assert.match(tokenBody, /code_verifier=/);
  assert.equal(requests[1].options.headers.Authorization, "Bearer secret-token");
  assert.doesNotMatch(JSON.stringify(store.data), /secret-token/);
  await assert.rejects(
    () => service.handleCallback(
      `https://verify.example.test/x/callback?code=auth-code&state=${authorizationUrl.searchParams.get("state")}`,
    ),
    /X OAuth state is invalid or expired/,
  );
  const persisted = readFileSync(store.filePath, "utf8");
  assert.doesNotMatch(persisted, /secret-token/);
});

test("PKCE challenge is deterministic for a supplied verifier source", () => {
  const { verifier, challenge } = createPkcePair(() => Buffer.alloc(32, 1));
  assert.equal(verifier.length > 40, true);
  assert.equal(challenge.length > 40, true);
  assert.notEqual(verifier, challenge);
});

test("store prevents an X account conflict after a successful first verification", () => {
  const store = createStore();
  const first = store.createRequest({
    guildId: "guild-1",
    discordUserId: "discord-1",
    roleId: "role-1",
    notificationChannelId: "channel-1",
    now: 1,
    state: "state-1",
    codeVerifier: "verifier-1",
    codeChallenge: "challenge-1",
  });
  store.beginCallback("state-1", 2);
  store.markVerified(first.id, { id: "123", username: "alice", name: "Alice" }, 3);
  const second = store.createRequest({
    guildId: "guild-1",
    discordUserId: "discord-2",
    roleId: "role-1",
    notificationChannelId: "channel-1",
    now: 4,
    state: "state-2",
    codeVerifier: "verifier-2",
    codeChallenge: "challenge-2",
  });
  store.beginCallback("state-2", 5);
  assert.throws(
    () => store.markVerified(second.id, { id: "123", username: "alice", name: "Alice" }, 6),
    XVerificationConflictError,
  );
});

test("cancellation consumes the request without leaving it stuck in exchanging", async () => {
  const store = createStore();
  const service = createService(store);
  const authorizationUrl = new URL(service.createAuthorizationUrl({
    guildId: "guild-1",
    discordUserId: "discord-1",
    roleId: "role-1",
    notificationChannelId: "channel-1",
  }));
  await assert.rejects(
    () => service.handleCallback(
      `https://verify.example.test/x/callback?error=access_denied&state=${authorizationUrl.searchParams.get("state")}`,
    ),
    /cancelled/,
  );
  const request = store.listRequests()[0];
  assert.equal(request.status, "cancelled");
  const retryUrl = new URL(service.createAuthorizationUrl({
    guildId: "guild-1",
    discordUserId: "discord-1",
    roleId: "role-1",
    notificationChannelId: "channel-1",
  }));
  assert.equal(store.listRequests().filter((item) => item.status === "awaiting_oauth").length, 1);
  assert.notEqual(
    store.listRequests().find((item) => item.status === "awaiting_oauth").id,
    request.id,
  );
});

test("does not let a second OAuth error cancel an exchange already in progress", () => {
  const store = createStore();
  const request = store.createRequest({
    guildId: "guild-1",
    discordUserId: "discord-1",
    roleId: "role-1",
    notificationChannelId: "channel-1",
    now: 1,
    state: "state-1",
    codeVerifier: "verifier-1",
    codeChallenge: "challenge-1",
  });
  store.beginCallback("state-1", 2);
  assert.equal(store.cancelRequest(request.id, 3), false);
  assert.equal(store.getRequest(request.id).status, "exchanging");
  assert.equal(store.cancelRequest(request.id, 4, { allowExchanging: true }), true);
});

test("rejects callbacks from a different origin before consuming state", async () => {
  const store = createStore();
  const service = createService(store);
  const authorizationUrl = new URL(service.createAuthorizationUrl({
    guildId: "guild-1",
    discordUserId: "discord-1",
    roleId: "role-1",
    notificationChannelId: "channel-1",
  }));
  await assert.rejects(
    () => service.handleCallback(
      `https://evil.example.test/x/callback?code=auth-code&state=${authorizationUrl.searchParams.get("state")}`,
    ),
    /does not match/,
  );
  assert.equal(store.listRequests()[0].status, "awaiting_oauth");
});

test("rejects callbacks without state before consuming the request", async () => {
  const store = createStore();
  const service = createService(store);
  service.createAuthorizationUrl({
    guildId: "guild-1",
    discordUserId: "discord-1",
    roleId: "role-1",
    notificationChannelId: "channel-1",
  });
  await assert.rejects(
    () => service.handleCallback("https://verify.example.test/x/callback?code=auth-code"),
    /state is missing/,
  );
  assert.equal(store.listRequests()[0].status, "awaiting_oauth");
});

test("expires admin review before approval and protects the existing X link", () => {
  const store = createStore();
  const request = store.createRequest({
    guildId: "guild-1",
    discordUserId: "discord-1",
    roleId: "role-1",
    notificationChannelId: "channel-1",
    now: 1,
    state: "state-1",
    codeVerifier: "verifier-1",
    codeChallenge: "challenge-1",
  });
  store.beginCallback("state-1", 2);
  store.markVerified(request.id, { id: "123", username: "alice", name: "Alice" }, 3);
  assert.throws(
    () => store.approveRequest(request.id, "admin-1", 3 + 24 * 60 * 60 * 1000),
    XVerificationError,
  );
  assert.equal(store.getRequest(request.id).status, "expired");
});

test("does not resend expired admin notifications", () => {
  const store = createStore();
  const request = store.createRequest({
    guildId: "guild-1",
    discordUserId: "discord-1",
    roleId: "role-1",
    notificationChannelId: "channel-1",
    now: 1,
    state: "state-1",
    codeVerifier: "verifier-1",
    codeChallenge: "challenge-1",
  });
  store.beginCallback("state-1", 2);
  store.markVerified(request.id, { id: "123", username: "alice", name: "Alice" }, 3);
  assert.deepEqual(store.listPendingNotifications(3 + 24 * 60 * 60 * 1000), []);
  assert.equal(store.getRequest(request.id).status, "expired");
  assert.equal(store.data.links["guild-1:123"], undefined);
});

test("keeps role grants retryable after a stale in-progress attempt", () => {
  const store = createStore();
  const request = store.createRequest({
    guildId: "guild-1",
    discordUserId: "discord-1",
    roleId: "role-1",
    notificationChannelId: "channel-1",
    now: 1,
    state: "state-1",
    codeVerifier: "verifier-1",
    codeChallenge: "challenge-1",
  });
  store.beginCallback("state-1", 2);
  store.markVerified(request.id, { id: "123", username: "alice", name: "Alice" }, 3);
  store.approveRequest(request.id, "admin-1", 4);
  store.beginRoleGrant(request.id, 5);
  assert.equal(store.recoverStaleRoleGrant(request.id, 5 + 5 * 60 * 1000 + 1), true);
  assert.equal(store.getRequest(request.id).status, "approved");
  store.beginRoleGrant(request.id, 5 + 5 * 60 * 1000 + 2);
  store.markRoleGranted(request.id, 5 + 5 * 60 * 1000 + 3);
  assert.equal(store.getRequest(request.id).status, "granted");
});

test("releases the X link when a member leaves after being granted the role", () => {
  const store = createStore();
  const request = store.createRequest({
    guildId: "guild-1",
    discordUserId: "discord-1",
    roleId: "role-1",
    notificationChannelId: "channel-1",
    now: 1,
    state: "state-1",
    codeVerifier: "verifier-1",
    codeChallenge: "challenge-1",
  });
  store.beginCallback("state-1", 2);
  store.markVerified(request.id, { id: "123", username: "alice", name: "Alice" }, 3);
  store.approveRequest(request.id, "admin-1", 4);
  store.beginRoleGrant(request.id, 5);
  store.markRoleGranted(request.id, 6);
  assert.equal(store.markLeftForMember("guild-1", "discord-1"), true);
  assert.equal(store.getRequest(request.id).status, "left");
  assert.equal(store.data.links["guild-1:123"], undefined);
});

test("fails closed when the persisted verification JSON is corrupt", () => {
  const directory = mkdtempSync(join(tmpdir(), "x-verification-corrupt-"));
  const filePath = join(directory, "verification.json");
  writeFileSync(filePath, "not-json", "utf8");
  assert.throws(
    () => new XVerificationStore({ filePath }),
    /Could not load verification data safely/,
  );
});

test("fails closed when the persisted verification schema is unsupported", () => {
  const directory = mkdtempSync(join(tmpdir(), "x-verification-schema-"));
  const filePath = join(directory, "verification.json");
  writeFileSync(filePath, JSON.stringify({ version: 999, requests: {} }), "utf8");
  assert.throws(
    () => new XVerificationStore({ filePath }),
    /unsupported schema version/,
  );
});

test("does not allow one Discord member to run overlapping X verifications", () => {
  const store = createStore();
  const service = createService(store);
  const authorizationUrl = new URL(service.createAuthorizationUrl({
    guildId: "guild-1",
    discordUserId: "discord-1",
    roleId: "role-1",
    notificationChannelId: "channel-1",
  }));
  store.beginCallback(authorizationUrl.searchParams.get("state"), 1_700_000_000_001);
  assert.throws(
    () => service.createAuthorizationUrl({
      guildId: "guild-1",
      discordUserId: "discord-1",
      roleId: "role-1",
      notificationChannelId: "channel-1",
    }),
    /already in progress/,
  );
});

test("does not let repeated starts invalidate the first authorization URL", () => {
  const store = createStore();
  let randomValue = 0;
  const service = createService(store, {
    randomBytesImpl: (size) => Buffer.alloc(size, ++randomValue),
  });
  const first = new URL(service.createAuthorizationUrl({
    guildId: "guild-1",
    discordUserId: "discord-1",
    roleId: "role-1",
    notificationChannelId: "channel-1",
  }));
  const second = new URL(service.createAuthorizationUrl({
    guildId: "guild-1",
    discordUserId: "discord-1",
    roleId: "role-1",
    notificationChannelId: "channel-1",
  }));
  assert.notEqual(first.searchParams.get("state"), second.searchParams.get("state"));
  store.beginCallback(first.searchParams.get("state"), 1_700_000_000_001);
  store.markVerified(first ? store.findRequestByState(first.searchParams.get("state"))?.id : null, {
    id: "123",
    username: "alice",
    name: "Alice",
  }, 1_700_000_000_002);
  assert.equal(store.findRequestByState(second.searchParams.get("state")), null);
  assert.equal(store.listRequests().filter((request) => request.status === "cancelled").length, 1);
});

test("recovers an exchange left behind by a process crash", () => {
  const store = createStore();
  const request = store.createRequest({
    guildId: "guild-1",
    discordUserId: "discord-1",
    roleId: "role-1",
    notificationChannelId: "channel-1",
    now: 1_700_000_000_000,
    state: "state-1",
    codeVerifier: "verifier-1",
    codeChallenge: "challenge-1",
  });
  store.beginCallback("state-1", 1_700_000_000_001);
  assert.equal(store.findActiveRequest("guild-1", "discord-1", 1_700_000_000_001 + 5 * 60 * 1000 + 1), null);
  assert.equal(store.getRequest(request.id).status, "cancelled");
  assert.equal(store.getRequest(request.id).codeVerifier, null);
});

test("persists one public panel per guild channel", () => {
  const store = createStore();
  store.setPanel("guild-1", "channel-1", "message-1");
  assert.deepEqual(store.getPanel("guild-1", "channel-1"), {
    guildId: "guild-1",
    channelId: "channel-1",
    messageId: "message-1",
  });
  const reloaded = new XVerificationStore({ filePath: store.filePath });
  assert.equal(reloaded.getPanel("guild-1", "channel-1").messageId, "message-1");
  assert.equal(reloaded.clearPanel("guild-1", "channel-1", "message-1"), true);
  assert.equal(reloaded.getPanel("guild-1", "channel-1"), undefined);
});

test("claims admin notifications so concurrent retries do not duplicate them", () => {
  const store = createStore();
  const request = store.createRequest({
    guildId: "guild-1",
    discordUserId: "discord-1",
    roleId: "role-1",
    notificationChannelId: "channel-1",
    now: 1_700_000_000_000,
    state: "state-1",
    codeVerifier: "verifier-1",
    codeChallenge: "challenge-1",
  });
  store.beginCallback("state-1", 1_700_000_000_001);
  store.markVerified(request.id, { id: "123", username: "alice", name: "Alice" }, 1_700_000_000_002);
  assert.equal(store.claimNotification(request.id, 1_700_000_000_003), true);
  assert.equal(store.claimNotification(request.id, 1_700_000_000_004), false);
  assert.equal(store.releaseNotificationClaim(request.id), true);
  assert.equal(store.claimNotification(request.id, 1_700_000_000_005), true);
  assert.equal(store.markNotificationSent(request.id, "message-1", 1_700_000_000_006), true);
  assert.equal(store.claimNotification(request.id, 1_700_000_000_007), false);
});

test("clears PKCE material when a member leaves and releases a missing verified role", () => {
  const store = createStore();
  const request = store.createRequest({
    guildId: "guild-1",
    discordUserId: "discord-1",
    roleId: "role-1",
    notificationChannelId: "channel-1",
    now: 1_700_000_000_000,
    state: "state-1",
    codeVerifier: "verifier-1",
    codeChallenge: "challenge-1",
  });
  assert.equal(store.markLeftForMember("guild-1", "discord-1"), true);
  assert.equal(store.getRequest(request.id).codeVerifier, null);
  assert.equal(store.getRequest(request.id).stateHash, null);

  const granted = store.createRequest({
    guildId: "guild-1",
    discordUserId: "discord-2",
    roleId: "role-1",
    notificationChannelId: "channel-1",
    now: 1_700_000_000_010,
    state: "state-2",
    codeVerifier: "verifier-2",
    codeChallenge: "challenge-2",
  });
  store.beginCallback("state-2", 1_700_000_000_011);
  store.markVerified(granted.id, { id: "456", username: "bob", name: "Bob" }, 1_700_000_000_012);
  store.approveRequest(granted.id, "admin-1", 1_700_000_000_013);
  store.beginRoleGrant(granted.id, 1_700_000_000_014);
  store.markRoleGranted(granted.id, 1_700_000_000_015);
  assert.equal(store.reconcileMember("guild-1", "discord-2", { hasVerifiedRole: false }), true);
  assert.equal(store.getRequest(granted.id).status, "released");
  assert.equal(store.data.links["guild-1:456"], undefined);
});
