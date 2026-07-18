import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
  VoiceSessionManager,
  VoicevoxTtsService,
  createPcmWav,
  decodeOpusStreamToWav,
} from "../src/vc-voice.js";

function createVoiceMocks({ autoIdle = true } = {}) {
  const speaking = new EventEmitter();
  const receiver = {
    speaking,
    subscribe: () => new EventEmitter(),
  };
  const connection = new EventEmitter();
  connection.receiver = receiver;
  connection.subscribe = () => {};
  connection.destroyed = false;
  connection.destroy = () => { connection.destroyed = true; };
  const player = new EventEmitter();
  player.played = [];
  player.play = (resource) => {
    player.played.push(resource);
    player.state = { status: "playing" };
    if (autoIdle) setImmediate(() => {
      player.state = { status: "idle" };
      player.emit("idle");
    });
  };
  player.stop = () => {};
  return { connection, player, speaking };
}

test("creates a standard 48 kHz stereo PCM WAV", () => {
  const wav = createPcmWav(Buffer.from([1, 2, 3, 4]));
  assert.equal(wav.subarray(0, 4).toString(), "RIFF");
  assert.equal(wav.subarray(8, 12).toString(), "WAVE");
  assert.equal(wav.readUInt32LE(24), 48_000);
  assert.equal(wav.readUInt16LE(22), 2);
  assert.equal(wav.readUInt32LE(40), 4);
  assert.deepEqual([...wav.subarray(44)], [1, 2, 3, 4]);
});

test("VOICEVOX performs the query then synthesis requests", async () => {
  const calls = [];
  const service = new VoicevoxTtsService({
    baseUrl: "http://voicevox.test/",
    speaker: 8,
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (url.endsWith("/version")) return { ok: true, async json() { return {}; } };
      if (url.includes("/audio_query?")) return { ok: true, async json() { return { accent_phrases: [] }; } };
      return { ok: true, async arrayBuffer() { return Uint8Array.from({ length: 49 }, () => 1).buffer; } };
    },
  });

  await service.checkHealth();
  const audio = await service.synthesize("こんにちは");
  assert.equal(audio.length, 49);
  assert.equal(calls.length, 3);
  assert.match(calls[1].url, /audio_query\?text=%E3%81%93%E3%82%93%E3%81%AB%E3%81%A1%E3%81%AF&speaker=8/u);
  assert.equal(calls[2].options.method, "POST");
});

test("decodes an Opus receiver stream into a WAV without requiring Discord", async () => {
  const stream = new PassThrough();
  const wavPromise = decodeOpusStreamToWav(stream, {
    decoderFactory: () => new PassThrough(),
    maxDurationMs: 100,
  });
  stream.end(Buffer.from([9, 8, 7, 6]));
  const wav = await wavPromise;
  assert.equal(wav.readUInt32LE(24), 48_000);
  assert.deepEqual([...wav.subarray(44)], [9, 8, 7, 6]);
});

test("reports Discord voice readiness failures separately from TTS", async () => {
  const mocks = createVoiceMocks();
  mocks.connection.state = { status: "connecting" };
  const manager = new VoiceSessionManager({
    transcribeImpl: async () => "unused",
    respondImpl: async () => "unused",
    ttsService: { synthesize: async () => Buffer.from("wav") },
    joinVoiceChannelImpl: () => mocks.connection,
    entersStateImpl: async () => { throw new Error("The operation was aborted."); },
    createAudioPlayerImpl: () => mocks.player,
    readyTimeoutMs: 100,
  });

  await assert.rejects(
    manager.join({
      guildId: "guild-1",
      channelId: "voice-1",
      adapterCreator: () => {},
      botUserId: "bot-1",
    }),
    /Discord voice connection did not become ready within 100ms \(state: connecting\)/u,
  );
  assert.equal(mocks.connection.destroyed, true);
});

test("reports DAVE-required voice channels explicitly", async () => {
  const mocks = createVoiceMocks();
  const networking = new EventEmitter();
  networking.state = { code: 0 };
  mocks.connection.state = { status: "connecting", networking };
  const manager = new VoiceSessionManager({
    transcribeImpl: async () => "unused",
    respondImpl: async () => "unused",
    ttsService: { synthesize: async () => Buffer.from("wav") },
    joinVoiceChannelImpl: () => mocks.connection,
    entersStateImpl: async () => {
      networking.emit("close", 4017);
      throw new Error("The operation was aborted");
    },
    createAudioPlayerImpl: () => mocks.player,
  });

  await assert.rejects(
    manager.join({
      guildId: "guild-1",
      channelId: "voice-1",
      adapterCreator: () => {},
      botUserId: "bot-1",
    }),
    /DAVE\/E2EE support is required/u,
  );
});

test("VC session processes one speaker and plays the TTS reply", async () => {
  const mocks = createVoiceMocks();
  let resolveResponse;
  const played = [];
  const manager = new VoiceSessionManager({
    transcribeImpl: async () => "hello",
    respondImpl: () => new Promise((resolve) => { resolveResponse = resolve; }),
    ttsService: { synthesize: async (text) => { played.push(text); return Buffer.from("wav"); } },
    joinVoiceChannelImpl: () => mocks.connection,
    entersStateImpl: async () => mocks.connection,
    createAudioPlayerImpl: () => mocks.player,
    createAudioResourceImpl: (input, options) => ({ input, options }),
    decodeImpl: async () => Buffer.from("wav"),
  });

  const session = await manager.join({
    guildId: "guild-1",
    channelId: "voice-1",
    adapterCreator: () => {},
    botUserId: "bot-1",
  });
  mocks.speaking.emit("start", "user-1");
  mocks.speaking.emit("start", "user-2");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(session.activeUserId, "user-1");
  resolveResponse("hi from AI");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(played, ["hi from AI"]);
  assert.equal(mocks.player.played.length, 1);

  assert.equal(await manager.leave("guild-1"), true);
  assert.equal(mocks.connection.destroyed, true);
  assert.equal(manager.get("guild-1"), null);
});

test("VC session exposes renderer-friendly state transitions", async () => {
  const mocks = createVoiceMocks();
  const states = [];
  const manager = new VoiceSessionManager({
    transcribeImpl: async () => "hello",
    respondImpl: async () => "voice reply",
    ttsService: { synthesize: async () => Buffer.from("wav") },
    joinVoiceChannelImpl: () => mocks.connection,
    entersStateImpl: async () => mocks.connection,
    createAudioPlayerImpl: () => mocks.player,
    createAudioResourceImpl: (input, options) => ({ input, options }),
    decodeImpl: async () => Buffer.from("wav"),
    onStateChange: (_guildId, state) => states.push(state.phase),
  });
  await manager.join({ guildId: "guild-1", channelId: "voice-1", adapterCreator: () => {}, botUserId: "bot-1" });
  mocks.speaking.emit("start", "user-1");
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(states.slice(0, 4), ["idle", "listening", "thinking", "speaking"]);
  await manager.leave("guild-1");
});

test("queues text replies so VC speech does not overlap", async () => {
  const mocks = createVoiceMocks();
  const spoken = [];
  let releaseFirst;
  const manager = new VoiceSessionManager({
    transcribeImpl: async () => "unused",
    respondImpl: async () => "unused",
    ttsService: {
      synthesize: async (text) => {
        spoken.push(`start:${text}`);
        if (text === "first") await new Promise((resolve) => { releaseFirst = resolve; });
        spoken.push(`done:${text}`);
        return Buffer.from("wav");
      },
    },
    joinVoiceChannelImpl: () => mocks.connection,
    entersStateImpl: async () => mocks.connection,
    createAudioPlayerImpl: () => mocks.player,
    createAudioResourceImpl: (input, options) => ({ input, options }),
  });

  await manager.join({
    guildId: "guild-1",
    channelId: "voice-1",
    adapterCreator: () => {},
    botUserId: "bot-1",
  });
  const first = manager.speak("guild-1", "first");
  const second = manager.speak("guild-1", "second");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(spoken, ["start:first"]);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(spoken, ["start:first", "done:first", "start:second", "done:second"]);
  assert.equal(mocks.player.played.length, 2);
  await manager.leave("guild-1");
});

test("waits for playback idle and ignores VC input while the bot is speaking", async () => {
  const mocks = createVoiceMocks({ autoIdle: false });
  const manager = new VoiceSessionManager({
    transcribeImpl: async () => "unused",
    respondImpl: async () => "unused",
    ttsService: { synthesize: async () => Buffer.from("wav") },
    joinVoiceChannelImpl: () => mocks.connection,
    entersStateImpl: async () => mocks.connection,
    createAudioPlayerImpl: () => mocks.player,
    createAudioResourceImpl: (input, options) => ({ input, options }),
  });
  const session = await manager.join({
    guildId: "guild-1",
    channelId: "voice-1",
    adapterCreator: () => {},
    botUserId: "bot-1",
  });
  const first = manager.speak("guild-1", "first");
  const second = manager.speak("guild-1", "second");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(mocks.player.played.length, 1);
  mocks.speaking.emit("start", "user-1");
  assert.equal(session.activeUserId, null);
  mocks.player.emit("idle");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(mocks.player.played.length, 2);
  mocks.player.emit("idle");
  await Promise.all([first, second]);
  await manager.leave("guild-1");
});
