import test from "node:test";
import assert from "node:assert/strict";
import {
  IMAGE_COMMAND_ALLOWED_USER_ID,
  canUseImageCommand,
} from "../src/image-command-access.js";

test("allows the designated Discord user to use /image", () => {
  assert.equal(canUseImageCommand(IMAGE_COMMAND_ALLOWED_USER_ID), true);
});

test("rejects every other user from /image", () => {
  assert.equal(canUseImageCommand("111111111111111111"), false);
  assert.equal(canUseImageCommand(undefined), false);
  assert.equal(canUseImageCommand(IMAGE_COMMAND_ALLOWED_USER_ID.replace(/1$/, "2")), false);
});
