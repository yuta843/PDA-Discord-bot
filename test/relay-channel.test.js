import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_RELAY_CHANNEL_ID,
  DISCORD_CHANNEL_ID_PATTERN,
  RELAY_CHANNEL_ADMIN_USER_ID,
  canConfigureRelayChannel,
  isValidDiscordChannelId,
  parseDiscordChannelId,
} from "../src/relay-channel.js";

const channelId = "12345678901234567";

test("uses the requested fixed default relay channel", () => {
  assert.equal(DEFAULT_RELAY_CHANNEL_ID, "1525816436625379458");
});

test("allows relay channel configuration only for the designated user", () => {
  assert.equal(canConfigureRelayChannel(RELAY_CHANNEL_ADMIN_USER_ID), true);
  assert.equal(canConfigureRelayChannel("other-user"), false);
  assert.equal(canConfigureRelayChannel(1068329268397998161), false);
});

test("accepts only Discord channel snowflake IDs", () => {
  assert.equal(parseDiscordChannelId(channelId), channelId);
  assert.equal(parseDiscordChannelId(` ${channelId} `), channelId);
  assert.equal(parseDiscordChannelId("123"), null);
  assert.equal(parseDiscordChannelId("channel-name"), null);
  assert.equal(parseDiscordChannelId("<#12345678901234567>"), null);
  assert.equal(parseDiscordChannelId(null), null);
  assert.equal(isValidDiscordChannelId(channelId), true);
  assert.equal(isValidDiscordChannelId("123"), false);
  assert.equal(DISCORD_CHANNEL_ID_PATTERN.test(channelId), true);
});
