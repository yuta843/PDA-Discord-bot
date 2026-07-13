import test from "node:test";
import assert from "node:assert/strict";
import { buildHelpMessage, HELP_SECTIONS } from "../src/help.js";

test("help lists every user-facing command and automatic feature", () => {
  const help = buildHelpMessage();

  assert.match(help, /kimazui/);

  for (const command of [
    "/help",
    "/ahoo news",
    "/summarize",
    "/poll",
    "/remind",
    "/stats",
    "/quotes",
    "/settings",
    "/chanel",
    "/channel",
    "/rate",
    "/reset",
    "/context",
    "/model",
    "!gacha",
    "!ank",
  ]) {
    assert.match(help, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.equal(HELP_SECTIONS.length, 6);
  assert.match(help, /Make it a Quote/);
  assert.match(help, /ペルソナ切り替え: pda_founder/);
});
