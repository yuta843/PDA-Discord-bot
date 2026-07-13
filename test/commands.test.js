import test from "node:test";
import assert from "node:assert/strict";
import {
  extractChannelId,
  normalizeChannelQuery,
  parseTargetCommand,
  slashCommands,
} from "../src/commands.js";

test("parses both channel command spellings", () => {
  assert.deepEqual(parseTargetCommand("./chanel tensousaki general"), {
    channelQuery: "general",
  });
  assert.deepEqual(parseTargetCommand("./channel tensousaki #art"), {
    channelQuery: "#art",
  });
  assert.equal(parseTargetCommand("./chanel help"), null);
});

test("normalizes channel names and accepts mentions or IDs", () => {
  assert.equal(normalizeChannelQuery(" #General "), "general");
  assert.equal(extractChannelId("<#123456789>"), "123456789");
  assert.equal(extractChannelId("123456789"), "123456789");
  assert.equal(extractChannelId("general"), null);
});

test("registers rate limit and reset slash commands", () => {
  const commandNames = slashCommands.map((command) => command.name);
  assert.deepEqual(commandNames, [
    "chanel",
    "channel",
    "help",
    "ahoo",
    "rate",
    "reset",
    "status",
    "context",
    "ai",
    "model",
    "summarize",
    "poll",
    "remind",
    "stats",
    "quotes",
    "settings",
  ]);
  assert.equal(slashCommands.find((command) => command.name === "rate").options[0].name, "limit");
  assert.deepEqual(
    slashCommands
      .find((command) => command.name === "ai")
      .toJSON()
      .options.find((option) => option.name === "battle")
      .options.map((option) => option.name),
    ["st", "stop"],
  );
  assert.deepEqual(
    slashCommands
      .find((command) => command.name === "model")
      .toJSON()
      .options.find((option) => option.name === "provider")
      .options[0]
      .choices.map(({ value }) => value),
    ["gemini", "groq", "qwen", "openai"],
  );
  assert.equal(slashCommands.find((command) => command.name === "summarize").options[0].name, "count");
  assert.deepEqual(
    slashCommands.find((command) => command.name === "ahoo").options.map((option) => option.name),
    ["news"],
  );
  assert.deepEqual(
    slashCommands.find((command) => command.name === "poll").options.map((option) => option.name),
    ["question", "option1", "option2", "option3", "option4", "option5", "duration"],
  );
  assert.deepEqual(
    slashCommands.find((command) => command.name === "remind").options.map((option) => option.name),
    ["set", "list", "cancel"],
  );
  assert.deepEqual(
    slashCommands.find((command) => command.name === "settings").options.map((option) => option.name),
    ["length", "language", "style"],
  );
  assert.deepEqual(
    slashCommands
      .find((command) => command.name === "settings")
      .toJSON()
      .options.find((option) => option.name === "style")
      .options[0]
      .choices.map(({ value }) => value),
    ["casual", "polite", "bullet", "cold", "debate", "tease", "jishou", "pda_founder"],
  );
  assert.equal(
    slashCommands.find((command) => command.name === "settings").toJSON().default_member_permissions,
    null,
  );
});
