import test from "node:test";
import assert from "node:assert/strict";
import { buildHelpMessage, HELP_SECTIONS } from "../src/help.js";

test("help lists every user-facing command and automatic feature", () => {
  const help = buildHelpMessage();

  assert.match(help, /kimazui/);
  assert.match(help, /kitachan/);
  assert.match(help, /1525816436625379458/);

  for (const command of [
    "/help",
    "/ahoo news",
    "/summarize",
    "/x-search",
    "/x tuiseki",
    "/ac search",
    "/poll",
    "/remind",
    "/stats",
    "/quotes",
    "/image",
    "/memory remember text",
    "/memory list",
    "/memory forget id",
    "/spotify",
    "/settings",
    "/chanel",
    "/channel",
    "/relay",
    "/rate",
    "/reset",
    "/context",
    "/verify",
    "/agent task",
    "/stop",
    "/open",
    "/gay",
    "/model",
    "/balance",
    "/daily",
    "/work",
    "/quest",
    "/leaderboard",
    "/pay",
    "/roulette",
    "!gacha",
    "!ank",
  ]) {
    assert.match(help, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.equal(HELP_SECTIONS.length, 8);
  assert.match(help, /Make it a Quote/);
  assert.match(help, /ペルソナ切り替え: pda_founder/);
  assert.match(help, /ペルソナ切り替え: danjo_towa/);
  assert.match(help, /壇上十和/);
  assert.match(help, /\/relay channel channel_id/);
  assert.doesNotMatch(help, /\/relay guild guild_id/);
  assert.match(help, /only Discord user 1068329268397998161 can use these commands/);
  assert.match(help, /まぐろmode/);
});
