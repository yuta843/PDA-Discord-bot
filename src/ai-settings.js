const DEFAULT_AI_SETTINGS = Object.freeze({
  length: "short",
  language: "auto",
  style: "casual",
});

const AI_SETTING_CHOICES = Object.freeze({
  length: Object.freeze([
    Object.freeze({ name: "短め", value: "short" }),
    Object.freeze({ name: "標準", value: "normal" }),
    Object.freeze({ name: "詳しく", value: "long" }),
  ]),
  language: Object.freeze([
    Object.freeze({ name: "自動", value: "auto" }),
    Object.freeze({ name: "日本語", value: "ja" }),
    Object.freeze({ name: "英語", value: "en" }),
  ]),
  style: Object.freeze([
    Object.freeze({ name: "カジュアル", value: "casual" }),
    Object.freeze({ name: "丁寧", value: "polite" }),
    Object.freeze({ name: "箇条書き", value: "bullet" }),
    Object.freeze({ name: "冷笑", value: "cold" }),
    Object.freeze({ name: "レスバ", value: "debate" }),
    Object.freeze({ name: "煽り", value: "tease" }),
  ]),
});

const AI_SETTING_LABELS = Object.fromEntries(
  Object.entries(AI_SETTING_CHOICES).map(([setting, choices]) => [
    setting,
    Object.fromEntries(choices.map(({ name, value }) => [value, name])),
  ]),
);

const AI_LENGTH_CONFIG = Object.freeze({
  short: Object.freeze({
    maxReplyLength: 80,
    maxOutputTokens: 64,
    instruction: "Be extremely brief: one short sentence, at most 20 Japanese characters or 8 words.",
  }),
  normal: Object.freeze({
    maxReplyLength: 400,
    maxOutputTokens: 256,
    instruction: "Give a concise answer in 2 or 3 sentences, at most 400 characters.",
  }),
  long: Object.freeze({
    maxReplyLength: 1000,
    maxOutputTokens: 512,
    instruction: "Give a useful, detailed answer while staying focused, at most 1000 characters.",
  }),
});

function isValidSetting(setting, value) {
  return AI_SETTING_CHOICES[setting]?.some((choice) => choice.value === value) ?? false;
}

function normalizeAiSettings(settings = {}) {
  return Object.fromEntries(
    Object.keys(DEFAULT_AI_SETTINGS).map((setting) => [
      setting,
      isValidSetting(setting, settings[setting])
        ? settings[setting]
        : DEFAULT_AI_SETTINGS[setting],
    ]),
  );
}

function getAiLengthConfig(settings = {}) {
  return AI_LENGTH_CONFIG[normalizeAiSettings(settings).length];
}

function buildAiSystemInstruction(settings = {}) {
  const normalized = normalizeAiSettings(settings);
  const languageInstruction = {
    auto: "Answer in the user's language.",
    ja: "Answer in Japanese.",
    en: "Answer in English.",
  }[normalized.language];
  const styleInstruction = {
    casual: "Use a friendly, casual tone.",
    polite: "Use a polite, respectful tone.",
    bullet: "Use short bullet points when they make the answer clearer.",
    cold: "Use a dry, cynical, lightly sarcastic tone. Keep it playful and non-abusive; never target protected classes, private individuals, trauma, or use hateful or harassing language.",
    debate: "Use a concise, indirect debate style: point out one key flaw or contradiction with restrained irony. Avoid long logical explanations. Do not insult, threaten, harass, or use abusive language.",
    tease: "Use simple, short, indirect teasing with a slightly smug tone. Keep it playful and non-abusive; do not use direct insults, threats, harassment, or hateful language.",
  }[normalized.style];

  return [
    "You are a Discord bot.",
    languageInstruction,
    getAiLengthConfig(normalized).instruction,
    styleInstruction,
    "No greeting or preamble. Refuse sexual content involving minors and explicit sexual requests.",
  ].join(" ");
}

class AiSettingsStore {
  constructor() {
    this.settings = new Map();
  }

  get(key) {
    return normalizeAiSettings(this.settings.get(key));
  }

  set(key, setting, value) {
    if (!key || !isValidSetting(setting, value)) return this.get(key);
    const next = { ...this.get(key), [setting]: value };
    this.settings.set(key, next);
    return next;
  }
}

export {
  AI_SETTING_CHOICES,
  AI_SETTING_LABELS,
  AiSettingsStore,
  DEFAULT_AI_SETTINGS,
  buildAiSystemInstruction,
  getAiLengthConfig,
  normalizeAiSettings,
};
