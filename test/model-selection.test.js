import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  AI_MODEL_LABELS,
  IMAGE_PROVIDER_LABELS,
  MODEL_ADMIN_USER_ID,
  canSelectModel,
  loadSelectedImageProvider,
  loadSelectedProvider,
  saveSelectedImageProvider,
  saveSelectedProvider,
} from "../src/model-selection.js";

test("shows the active Codex OAuth model in the OpenAI choice", () => {
  assert.equal(AI_MODEL_LABELS.openai, "OpenAI GPT-5.6 Luna（低・ChatGPT OAuth）");
});

test("allows only the configured Discord user to select a model", () => {
  assert.equal(canSelectModel(MODEL_ADMIN_USER_ID), true);
  assert.equal(canSelectModel("other-user"), false);
});

test("persists and reloads the selected provider", () => {
  const directory = mkdtempSync(join(tmpdir(), "miq-model-"));
  const filePath = join(directory, "selection.json");
  assert.equal(loadSelectedProvider(filePath, "gemini"), "gemini");
  assert.equal(saveSelectedProvider(filePath, "openai"), "openai");
  assert.equal(loadSelectedProvider(filePath), "openai");
  assert.equal(JSON.parse(readFileSync(filePath, "utf8")).provider, "openai");
});

test("exposes and persists the Codex image provider", () => {
  assert.equal(IMAGE_PROVIDER_LABELS.codex, "Codex OAuth (GPT Image 2)");
  const directory = mkdtempSync(join(tmpdir(), "miq-image-provider-"));
  const filePath = join(directory, "selection.json");
  assert.equal(loadSelectedImageProvider(filePath), "cloudflare");
  assert.equal(saveSelectedImageProvider(filePath, "codex"), "codex");
  assert.equal(loadSelectedImageProvider(filePath), "codex");
  assert.equal(JSON.parse(readFileSync(filePath, "utf8")).imageProvider, "codex");
});
