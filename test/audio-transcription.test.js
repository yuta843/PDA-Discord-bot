import test from "node:test";
import assert from "node:assert/strict";
import {
  getAudioMimeType,
  transcribeAudioBuffer,
  transcribeDiscordAudio,
} from "../src/audio-transcription.js";

const attachment = {
  url: "https://cdn.discordapp.com/attachments/1/2/voice.wav",
  name: "voice.wav",
  contentType: "audio/wav",
};

test("detects supported Discord audio types", () => {
  assert.equal(getAudioMimeType(attachment), "audio/wav");
  assert.equal(getAudioMimeType({ name: "voice.mp3" }), "audio/mpeg");
  assert.equal(getAudioMimeType({ name: "file.txt" }), null);
});

test("downloads Discord audio and asks Gemini for a transcript", async () => {
  const calls = [];
  const transcript = await transcribeDiscordAudio(attachment, {
    apiKey: "test-key",
    model: "gemini-audio",
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (url === attachment.url) {
        return {
          ok: true,
          headers: { get: () => "4" },
          arrayBuffer: async () => Uint8Array.from([1, 2, 3, 4]).buffer,
        };
      }
      const body = JSON.parse(options.body);
      assert.equal(options.headers["x-goog-api-key"], "test-key");
      assert.equal(body.contents[0].parts[1].inlineData.mimeType, "audio/wav");
      assert.equal(body.contents[0].parts[1].inlineData.data, "AQIDBA==");
      return {
        ok: true,
        json: async () => ({ candidates: [{ content: { parts: [{ text: "こんにちは" }] } }] }),
      };
    },
  });
  assert.equal(transcript, "こんにちは");
  assert.equal(calls.length, 2);
});

test("rejects non-Discord audio URLs", async () => {
  await assert.rejects(
    transcribeDiscordAudio({ ...attachment, url: "https://example.com/voice.wav" }, {
      apiKey: "test-key", model: "gemini-audio",
    }),
    /Only Discord audio attachments/,
  );
});

test("transcribes an in-memory WAV buffer for VC input", async () => {
  let requestBody;
  const transcript = await transcribeAudioBuffer(Buffer.from("wav-bytes"), {
    apiKey: "test-key",
    model: "gemini-audio",
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return {
        ok: true,
        async json() {
          return { candidates: [{ content: { parts: [{ text: "hello from voice" }] } }] };
        },
      };
    },
  });

  assert.equal(transcript, "hello from voice");
  assert.equal(requestBody.contents[0].parts[1].inlineData.mimeType, "audio/wav");
  assert.equal(
    Buffer.from(requestBody.contents[0].parts[1].inlineData.data, "base64").toString(),
    "wav-bytes",
  );
});
