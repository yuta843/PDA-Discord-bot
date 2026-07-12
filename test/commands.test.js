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
  assert.deepEqual(commandNames, ["chanel", "channel", "rate", "reset", "status", "context", "settings"]);
  assert.equal(slashCommands.find((command) => command.name === "rate").options[0].name, "limit");
  assert.deepEqual(
    slashCommands.find((command) => command.name === "settings").options.map((option) => option.name),
    ["length", "language", "style"],
  );
});
