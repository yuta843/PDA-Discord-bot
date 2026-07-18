import test from "node:test";
import assert from "node:assert/strict";
import { buildServerInviteUrl } from "../src/invite.js";

test("builds a guild-install invite with bot and command scopes", () => {
  const url = new URL(buildServerInviteUrl("123456789012345678"));

  assert.equal(url.origin, "https://discord.com");
  assert.equal(url.pathname, "/oauth2/authorize");
  assert.equal(url.searchParams.get("client_id"), "123456789012345678");
  assert.equal(url.searchParams.get("integration_type"), "0");
  assert.deepEqual(
    new Set(url.searchParams.get("scope").split(" ")),
    new Set(["bot", "applications.commands"]),
  );
  assert.notEqual(url.searchParams.get("permissions"), "0");
});

test("rejects an invalid application ID", () => {
  assert.throws(() => buildServerInviteUrl("not-an-id"));
});
