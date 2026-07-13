import test from "node:test";
import assert from "node:assert/strict";
import {
  canChangeAiSettings,
  parseAiSettingsAllowedUserIds,
} from "../src/ai-settings-access.js";

test("allows every user when the settings allowlist is empty", () => {
  assert.equal(canChangeAiSettings("123456789012345678", new Set()), true);
});

test("allows only configured Discord user IDs", () => {
  const allowed = parseAiSettingsAllowedUserIds(
    "123456789012345678, 987654321098765432, invalid",
  );

  assert.deepEqual([...allowed], ["123456789012345678", "987654321098765432"]);
  assert.equal(canChangeAiSettings("123456789012345678", allowed), true);
  assert.equal(canChangeAiSettings("111111111111111111", allowed), false);
});

test("allows a server manager even when their ID is not listed", () => {
  const allowed = parseAiSettingsAllowedUserIds("123456789012345678");

  assert.equal(
    canChangeAiSettings("111111111111111111", allowed, { canManageGuild: true }),
    true,
  );
});
