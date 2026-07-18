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
    "relay",
    "help",
    "ahoo",
    "rate",
    "reset",
    "status",
    "context",
    "agent",
    "ai",
    "res",
    "stop",
    "open",
    "gay",
    "kitachan",
    "x-search",
    "x",
    "ac",
    "model",
    "summarize",
    "poll",
    "remind",
    "stats",
    "quotes",
    "image",
    "memory",
    "skill",
    "spotify",
    "verify",
    "settings",
    "balance",
    "daily",
    "work",
    "quest",
    "leaderboard",
    "pay",
   "roulette",
   "vc",
  ]);
  assert.equal(slashCommands.find((command) => command.name === "rate").options[0].name, "limit");
  assert.deepEqual(
    slashCommands.find((command) => command.name === "reset").options.map((option) => option.name),
    ["ai", "x"],
  );
  assert.deepEqual(
    slashCommands.find((command) => command.name === "agent").options.map((option) => option.name),
    ["task"],
  );
  assert.equal(
    slashCommands.find((command) => command.name === "agent").options[0].required,
    true,
  );
  assert.deepEqual(
    slashCommands.find((command) => command.name === "relay").options.map((option) => option.name),
    ["channel"],
  );
  assert.deepEqual(
    slashCommands
      .find((command) => command.name === "relay")
      .toJSON()
      .options[0]
      .options
      .map((option) => option.name),
    ["channel_id"],
  );
  assert.deepEqual(
    slashCommands
      .find((command) => command.name === "ai")
      .toJSON()
      .options.find((option) => option.name === "battle")
      .options.map((option) => option.name),
    ["st", "stop"],
  );
  assert.deepEqual(
    slashCommands.find((command) => command.name === "res").options.map((option) => option.name),
    ["battle"],
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
  assert.deepEqual(
    slashCommands
      .find((command) => command.name === "model")
      .toJSON()
      .options.find((option) => option.name === "provider")
      .options[1]
      .choices.map(({ value }) => value),
    ["cloudflare", "codex"],
  );
  assert.equal(slashCommands.find((command) => command.name === "summarize").options[0].name, "count");
  assert.deepEqual(
    slashCommands.find((command) => command.name === "x-search").options.map((option) => option.name),
    ["query", "count", "order"],
  );
  assert.deepEqual(
    slashCommands.find((command) => command.name === "x-search").toJSON().options[2].choices
      .map(({ name, value }) => ({ name, value })),
    [
      { name: "話題順", value: "top" },
      { name: "新着順", value: "latest" },
      { name: "メディア", value: "media" },
    ],
  );
  assert.deepEqual(
    slashCommands.find((command) => command.name === "x").options.map((option) => option.name),
    ["tuiseki"],
  );
  assert.deepEqual(
    slashCommands.find((command) => command.name === "ac").toJSON().options[0].options.map((option) => option.name),
    ["username"],
  );
  assert.deepEqual(
    slashCommands.find((command) => command.name === "balance").options.map((option) => option.name),
    ["user"],
  );
  assert.deepEqual(
    slashCommands.find((command) => command.name === "pay").options.map((option) => option.name),
    ["user", "amount"],
  );
  assert.deepEqual(
    slashCommands.find((command) => command.name === "roulette").options.map((option) => option.name),
    ["amount", "choice", "number"],
  );
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
    slashCommands.find((command) => command.name === "spotify").options.map((option) => option.name),
    ["connect", "history", "status", "disconnect"],
  );
  assert.deepEqual(
    slashCommands.find((command) => command.name === "image").options.map((option) => option.name),
    ["prompt"],
  );
  const memory = slashCommands.find((command) => command.name === "memory").toJSON();
  assert.equal(memory.description, "Manage saved memories");
  assert.deepEqual(
    memory.options.map(({ name, description }) => ({ name, description })),
    [
      { name: "remember", description: "Save a memory" },
      { name: "list", description: "List saved memories" },
      { name: "forget", description: "Delete a saved memory" },
    ],
  );
  assert.deepEqual(
    memory.options[0].options.map(({ name, description, required }) => ({ name, description, required })),
    [{ name: "text", description: "Memory text to save", required: true }],
  );
  assert.deepEqual(
    memory.options[2].options.map(({ name, description, required }) => ({ name, description, required })),
    [{ name: "id", description: "Memory ID to delete", required: true }],
  );
  const skill = slashCommands.find((command) => command.name === "skill").toJSON();
  assert.equal(skill.description, "Manage reusable agent skills");
  assert.deepEqual(
    skill.options.map(({ name, description }) => ({ name, description })),
    [
      { name: "save", description: "Save or update a reusable skill" },
      { name: "list", description: "List saved agent skills" },
      { name: "delete", description: "Delete a saved agent skill" },
    ],
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
    [
      "casual",
      "polite",
      "bullet",
      "cold",
      "debate",
      "tease",
      "jishou",
      "pda_founder",
      "danjo_towa",
      "safe_debate",
      "conversation",
      "plana",
      "maguro",
    ],
  );
  assert.equal(
    slashCommands.find((command) => command.name === "settings").toJSON().default_member_permissions,
    null,
  );
  const vc = slashCommands.find((command) => command.name === "vc").toJSON();
  assert.deepEqual(vc.options.map(({ name }) => name), ["join", "leave", "channel"]);
  assert.deepEqual(
    vc.options[2].options.map(({ name, required }) => ({ name, required })),
    [{ name: "text_channel", required: true }],
  );
});
