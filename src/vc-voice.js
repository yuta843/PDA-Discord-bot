import { Readable } from "node:stream";
import {
  AudioPlayerStatus,
  EndBehaviorType,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
} from "@discordjs/voice";
import { opus } from "prism-media";

const DEFAULT_VOICEVOX_URL = "http://127.0.0.1:50021";
const DEFAULT_VOICEVOX_SPEAKER = 3;
const DEFAULT_VOICEVOX_TIMEOUT_MS = 15_000;
const DEFAULT_VOICE_READY_TIMEOUT_MS = 30_000;
const DEFAULT_SILENCE_MS = 850;
const DEFAULT_MAX_SPEECH_MS = 15_000;
const MAX_TTS_TEXT_LENGTH = 2_000;
const WAV_HEADER_BYTES = 44;

function normalizeVoicevoxUrl(value = DEFAULT_VOICEVOX_URL) {
  return String(value).trim().replace(/\/+$/u, "");
}

function createPcmWav(pcm, {
  sampleRate = 48_000,
  channels = 2,
  bitsPerSample = 16,
} = {}) {
  const data = Buffer.from(pcm ?? []);
  const blockAlign = channels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const header = Buffer.alloc(WAV_HEADER_BYTES);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

function decodeOpusStreamToWav(stream, {
  decoderFactory = () => new opus.Decoder({ frameSize: 960, channels: 2, rate: 48_000 }),
  maxDurationMs = DEFAULT_MAX_SPEECH_MS,
} = {}) {
  if (!stream || typeof stream.pipe !== "function") {
    return Promise.reject(new Error("Discord voice receiver returned an invalid stream."));
  }

  return new Promise((resolve, reject) => {
    const decoder = decoderFactory();
    const chunks = [];
    let settled = false;
    const timer = setTimeout(() => {
      const error = new Error("Voice utterance exceeded the maximum duration.");
      finish(reject, error);
      stream.destroy?.(error);
    }, maxDurationMs);
    timer.unref?.();
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const onError = (error) => finish(reject, error);
    stream.once?.("error", onError);
    decoder.once?.("error", onError);
    decoder.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    decoder.once("end", () => finish(resolve, createPcmWav(Buffer.concat(chunks))));
    stream.pipe(decoder);
  });
}

class VoicevoxTtsService {
  constructor({
    baseUrl = process.env.VOICEVOX_URL || DEFAULT_VOICEVOX_URL,
    speaker = Number.parseInt(process.env.VOICEVOX_SPEAKER_ID ?? `${DEFAULT_VOICEVOX_SPEAKER}`, 10),
    timeoutMs = DEFAULT_VOICEVOX_TIMEOUT_MS,
    fetchImpl = fetch,
  } = {}) {
    this.baseUrl = normalizeVoicevoxUrl(baseUrl);
    this.speaker = Number.isInteger(speaker) && speaker >= 0 ? speaker : DEFAULT_VOICEVOX_SPEAKER;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  isConfigured() {
    return Boolean(this.baseUrl);
  }

  async checkHealth() {
    if (!this.isConfigured()) throw new Error("VOICEVOX URL is not configured.");
    const response = await this.fetchImpl(`${this.baseUrl}/version`, {
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response?.ok) throw new Error(`VOICEVOX is unavailable (${response?.status ?? "unknown"}).`);
    return true;
  }

  async synthesize(text) {
    const normalized = String(text ?? "").trim().slice(0, MAX_TTS_TEXT_LENGTH);
    if (!normalized) throw new Error("Cannot synthesize an empty voice reply.");
    const speaker = encodeURIComponent(`${this.speaker}`);
    const queryResponse = await this.fetchImpl(
      `${this.baseUrl}/audio_query?text=${encodeURIComponent(normalized)}&speaker=${speaker}`,
      { method: "POST", signal: AbortSignal.timeout(this.timeoutMs) },
    );
    if (!queryResponse?.ok) {
      throw new Error(`VOICEVOX audio query failed (${queryResponse?.status ?? "unknown"}).`);
    }
    const query = await queryResponse.json();
    const synthesisResponse = await this.fetchImpl(
      `${this.baseUrl}/synthesis?speaker=${speaker}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(query),
        signal: AbortSignal.timeout(this.timeoutMs),
      },
    );
    if (!synthesisResponse?.ok) {
      throw new Error(`VOICEVOX synthesis failed (${synthesisResponse?.status ?? "unknown"}).`);
    }
    const audio = Buffer.from(await synthesisResponse.arrayBuffer());
    if (audio.length <= WAV_HEADER_BYTES) throw new Error("VOICEVOX returned empty audio.");
    return audio;
  }
}

class VoiceSessionManager {
  constructor({
    transcribeImpl,
    respondImpl,
    ttsService,
    joinVoiceChannelImpl = joinVoiceChannel,
    entersStateImpl = entersState,
    createAudioPlayerImpl = createAudioPlayer,
    createAudioResourceImpl = createAudioResource,
    decodeImpl = decodeOpusStreamToWav,
    silenceMs = DEFAULT_SILENCE_MS,
    maxSpeechMs = DEFAULT_MAX_SPEECH_MS,
    readyTimeoutMs = DEFAULT_VOICE_READY_TIMEOUT_MS,
    shouldProcess = () => true,
    onStateChange = () => {},
    logger = console,
  } = {}) {
    if (typeof transcribeImpl !== "function") throw new Error("VC transcription handler is required.");
    if (typeof respondImpl !== "function") throw new Error("VC response handler is required.");
    this.transcribeImpl = transcribeImpl;
    this.respondImpl = respondImpl;
    this.ttsService = ttsService;
    this.joinVoiceChannelImpl = joinVoiceChannelImpl;
    this.entersStateImpl = entersStateImpl;
    this.createAudioPlayerImpl = createAudioPlayerImpl;
    this.createAudioResourceImpl = createAudioResourceImpl;
    this.decodeImpl = decodeImpl;
    this.silenceMs = silenceMs;
    this.maxSpeechMs = maxSpeechMs;
    this.readyTimeoutMs = readyTimeoutMs;
    this.shouldProcess = shouldProcess;
    this.onStateChange = onStateChange;
    this.logger = logger;
    this.sessions = new Map();
  }

  get(guildId) {
    return this.sessions.get(guildId) ?? null;
  }

  notifyState(guildId, state) {
    try {
      Promise.resolve(this.onStateChange(guildId, state)).catch((error) => {
        this.logger.warn?.(`[vc:${guildId}] Activity state update failed:`, error);
      });
    } catch (error) {
      this.logger.warn?.(`[vc:${guildId}] Activity state update failed:`, error);
    }
  }

  async join({ guildId, channelId, adapterCreator, botUserId }) {
    if (!guildId || !channelId || typeof adapterCreator !== "function") {
      throw new Error("Guild, voice channel, and adapter creator are required.");
    }
    const existing = this.get(guildId);
    if (existing?.channelId === channelId) return existing;
    if (existing) await this.leave(guildId);

    const connection = this.joinVoiceChannelImpl({
      channelId,
      guildId,
      adapterCreator,
      selfDeaf: false,
      selfMute: false,
    });
    let networkingCloseCode = null;
    const observedNetworking = new WeakSet();
    const observeNetworking = (state) => {
      const networking = state?.networking;
      if (!networking || observedNetworking.has(networking)) return;
      observedNetworking.add(networking);
      networking.on?.("stateChange", (oldNetworkingState, newNetworkingState) => {
        this.logger.info?.(
          `[vc:${guildId}] Voice networking state: ${oldNetworkingState?.code ?? "unknown"} -> ${newNetworkingState?.code ?? "unknown"}`,
        );
      });
      networking.on?.("close", (code) => {
        networkingCloseCode = code;
        this.logger.warn?.(`[vc:${guildId}] Voice networking closed: code=${code ?? "unknown"}`);
      });
    };
    connection.on?.("stateChange", (oldState, newState) => {
      observeNetworking(newState);
      this.logger.info?.(
        `[vc:${guildId}] Voice connection state: ${oldState?.status ?? "unknown"} -> ${newState?.status ?? "unknown"}`,
      );
    });
    observeNetworking(connection.state);
    connection.on?.("error", (error) => this.logger.error?.(`[vc:${guildId}] Voice connection error:`, error));
    try {
      await this.entersStateImpl(connection, VoiceConnectionStatus.Ready, this.readyTimeoutMs);
    } catch (error) {
      connection.destroy?.();
      if (networkingCloseCode === 4017) {
        throw new Error(
          "Discord rejected this voice channel because DAVE/E2EE support is required.",
          { cause: error },
        );
      }
      if (/operation was aborted/iu.test(error?.message ?? "")) {
        throw new Error(
          `Discord voice connection did not become ready within ${this.readyTimeoutMs}ms (state: ${connection.state?.status ?? "unknown"}).`,
          { cause: error },
        );
      }
      throw error;
    }

    const player = this.createAudioPlayerImpl({ behavior: NoSubscriberBehavior.Stop });
    connection.subscribe(player);
    const session = {
      guildId,
      channelId,
      connection,
      player,
      botUserId,
      activeUserId: null,
      processing: false,
      stopped: false,
      speechQueue: Promise.resolve(),
      queuedSpeech: 0,
      isPlaying: false,
      onSpeakingStart: null,
    };
    session.onSpeakingStart = (userId) => {
      if (session.stopped || userId === botUserId || session.activeUserId || session.processing || session.isPlaying || session.queuedSpeech > 0) return;
      session.activeUserId = userId;
      this.notifyState(guildId, { phase: "listening", emotion: "neutral", text: "" });
      void this.capture(session, userId);
    };
    connection.receiver.speaking.on("start", session.onSpeakingStart);
    player.on?.("error", (error) => this.logger.error?.(`[vc:${guildId}] Voice player error:`, error));
    this.sessions.set(guildId, session);
    this.notifyState(guildId, { phase: "idle", emotion: "neutral", text: "" });
    return session;
  }

  async capture(session, userId) {
    let stream;
    try {
      stream = session.connection.receiver.subscribe(userId, {
        end: { behavior: EndBehaviorType.AfterSilence, duration: this.silenceMs },
      });
      const wav = await this.decodeImpl(stream, { maxDurationMs: this.maxSpeechMs });
      if (session.stopped || !this.shouldProcess()) return;
      session.processing = true;
      this.notifyState(session.guildId, { phase: "thinking", emotion: "neutral", text: "" });
      const transcript = await this.transcribeImpl(wav, { mimeType: "audio/wav", userId, guildId: session.guildId });
      if (!transcript || /^\[inaudible\]$/iu.test(transcript.trim())) return;
      const reply = await this.respondImpl(transcript, { userId, guildId: session.guildId });
      if (!reply || session.stopped || !this.ttsService) return;
      await this.speak(session.guildId, reply);
    } catch (error) {
      if (!session.stopped) this.logger.error?.(`[vc:${session.guildId}] Voice turn failed:`, error);
    } finally {
      session.processing = false;
      session.activeUserId = null;
      if (!session.stopped && !session.isPlaying && session.queuedSpeech === 0) {
        this.notifyState(session.guildId, { phase: "idle", emotion: "neutral", text: "" });
      }
    }
  }

  speak(guildId, text) {
    const session = this.get(guildId);
    if (!session || session.stopped || !this.ttsService) return Promise.resolve(false);

    session.queuedSpeech += 1;
    const play = async () => {
      try {
        if (session.stopped) return false;
        const audio = await this.ttsService.synthesize(text);
        if (session.stopped) return false;
        const resource = this.createAudioResourceImpl(Readable.from([audio]), {
          inputType: StreamType.Arbitrary,
        });
        session.isPlaying = true;
        this.notifyState(guildId, { phase: "speaking", emotion: "neutral", text: "" });
        await new Promise((resolve, reject) => {
          const onIdle = () => finish(resolve, true);
          const onError = (error) => finish(reject, error);
          const finish = (callback, value) => {
            session.player.removeListener?.(AudioPlayerStatus.Idle, onIdle);
            session.player.removeListener?.("error", onError);
            callback(value);
          };
          session.player.once?.(AudioPlayerStatus.Idle, onIdle);
          session.player.once?.("error", onError);
          session.player.play(resource);
        });
        return true;
      } finally {
        session.isPlaying = false;
        session.queuedSpeech = Math.max(0, session.queuedSpeech - 1);
        if (!session.stopped && session.queuedSpeech === 0) {
          this.notifyState(guildId, { phase: "idle", emotion: "neutral", text: "" });
        }
      }
    };

    session.speechQueue = session.speechQueue.catch(() => false).then(play);
    return session.speechQueue;
  }

  async leave(guildId) {
    const session = this.sessions.get(guildId);
    if (!session) return false;
    session.stopped = true;
    session.connection.receiver.speaking.removeListener?.("start", session.onSpeakingStart);
    session.player.stop?.();
    session.connection.destroy?.();
    this.sessions.delete(guildId);
    this.notifyState(guildId, { phase: "idle", emotion: "neutral", text: "" });
    return true;
  }

  async leaveAll() {
    await Promise.all([...this.sessions.keys()].map((guildId) => this.leave(guildId)));
  }
}

export {
  DEFAULT_MAX_SPEECH_MS,
  DEFAULT_SILENCE_MS,
  DEFAULT_VOICEVOX_SPEAKER,
  DEFAULT_VOICEVOX_URL,
  VoiceSessionManager,
  VoicevoxTtsService,
  createPcmWav,
  decodeOpusStreamToWav,
};
