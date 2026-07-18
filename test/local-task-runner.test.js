import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FfmpegTaskRunner,
  LocalTaskRunStore,
  PendingMediaTaskStore,
  getMediaAttachment,
  hasMediaTaskSignal,
  parseMediaTaskRequest,
} from "../src/local-task-runner.js";

function attachment(overrides = {}) {
  return {
    url: "https://cdn.discordapp.com/attachments/1/2/source.mp4",
    name: "source.mp4",
    contentType: "video/mp4",
    size: 4,
    ...overrides,
  };
}

function makeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => true;
  return child;
}

test("parses bounded media task requests without exposing command arguments", () => {
  assert.deepEqual(parseMediaTaskRequest("@bot mp3"), { type: "audio" });
  assert.deepEqual(parseMediaTaskRequest("この動画をgifにして"), { type: "gif" });
  assert.deepEqual(parseMediaTaskRequest("@bot info"), { type: "info" });
  assert.deepEqual(parseMediaTaskRequest("trim 00:00:10 00:00:20"), {
    type: "trim",
    startSeconds: 10,
    durationSeconds: 20,
  });
  assert.equal(parseMediaTaskRequest("run --rm -it"), null);
  assert.equal(parseMediaTaskRequest("この音声聞こえる？"), null);
  assert.equal(hasMediaTaskSignal("この音声聞こえる？"), false);
  assert.equal(hasMediaTaskSignal("please make an mp4"), true);
});

test("accepts only one media attachment from a Discord CDN host", () => {
  const result = getMediaAttachment({
    attachments: new Map([
      ["1", attachment()],
    ]),
  });
  assert.equal(result.attachment.name, "source.mp4");

  assert.equal(
    getMediaAttachment({
      attachments: new Map([
        ["1", attachment({ url: "https://example.com/source.mp4" })],
      ]),
    }).reason,
    "unsupported_attachment",
  );
  assert.equal(
    getMediaAttachment({
      attachments: new Map([
        ["1", attachment()],
        ["2", attachment({ name: "second.mp4" })],
      ]),
    }).reason,
    "multiple_attachments",
  );
});

test("runs a fixed ffmpeg task with shell disabled and cleans its temporary directory", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "miq-task-test-"));
  const calls = [];
  try {
    const runner = new FfmpegTaskRunner({
      tempRoot,
      fetchImpl: async () => ({
        ok: true,
        headers: { get: () => "4" },
        arrayBuffer: async () => Uint8Array.from([1, 2, 3, 4]).buffer,
      }),
      spawnSyncImpl: () => ({ status: 0 }),
      spawnImpl: (command, args, options) => {
        const child = makeChild();
        calls.push({ command, args, options });
        void (async () => {
          await writeFile(args.at(-1), Buffer.from("encoded"));
          child.emit("close", 0, null);
        })();
        return child;
      },
    });

    const result = await runner.run(
      { type: "audio" },
      { attachment: attachment(), signal: new AbortController().signal },
    );

    assert.equal(result.type, "audio");
    assert.equal(result.outputName, "miq-audio.mp3");
    assert.deepEqual(result.output, Buffer.from("encoded"));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.shell, false);
    assert.equal(calls[0].options.windowsHide, true);
    assert.equal(calls[0].args.includes("-codec:a"), true);
    assert.equal(calls[0].args.some((arg) => arg.includes("--rm") || arg.includes(";")), false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("builds a bounded contact-sheet preview for AI video understanding", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "miq-preview-test-"));
  const calls = [];
  try {
    const runner = new FfmpegTaskRunner({
      tempRoot,
      fetchImpl: async () => ({
        ok: true,
        headers: { get: () => "4" },
        arrayBuffer: async () => Uint8Array.from([1, 2, 3, 4]).buffer,
      }),
      spawnSyncImpl: () => ({ status: 0 }),
      spawnImpl: (_command, args) => {
        const child = makeChild();
        calls.push(args);
        void (async () => {
          await writeFile(args.at(-1), Buffer.from("jpeg-preview"));
          child.emit("close", 0, null);
        })();
        return child;
      },
    });
    const result = await runner.run({ type: "preview" }, { attachment: attachment() });
    assert.equal(result.outputName, "miq-preview.jpg");
    assert.deepEqual(result.output, Buffer.from("jpeg-preview"));
    assert.equal(calls[0].includes("-frames:v"), true);
    assert.equal(calls[0].some((arg) => arg.includes("tile=3x2")), true);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("stops all local task runs through AbortController", () => {
  const store = new LocalTaskRunStore();
  const first = store.start("first");
  const second = store.start("second");

  assert.equal(store.stopAll(), 2);
  assert.equal(first.controller.signal.aborted, true);
  assert.equal(second.controller.signal.aborted, true);
  assert.equal(store.size, 0);
});

test("remembers one media instruction for the user's next attachment", () => {
  const store = new PendingMediaTaskStore({ ttlMs: 300_000 });
  store.set("guild:channel:user", { type: "mp4" }, 1_000);
  assert.deepEqual(store.get("guild:channel:user", 1_001)?.task, { type: "mp4" });
  assert.deepEqual(store.take("guild:channel:user", 1_002)?.task, { type: "mp4" });
  assert.equal(store.get("guild:channel:user", 1_003), null);

  store.set("expired", { type: "gif" }, 1_000);
  assert.equal(store.get("expired", 301_000), null);
});

test("uses bundled ffmpeg and ffprobe when environment paths are absent", () => {
  const runner = new FfmpegTaskRunner();
  assert.equal(runner.isAvailable("mp4"), true);
  assert.equal(runner.isAvailable("info"), true);
});
