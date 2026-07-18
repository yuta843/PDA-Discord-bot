import test from "node:test";
import assert from "node:assert/strict";
import {
  CODEX_AGENT_CHANNEL_HISTORY_LIMIT,
  CODEX_AGENT_HISTORY_LIMIT,
  CODEX_AGENT_MAX_PROMPT_LENGTH,
  CODEX_AGENT_TIMEOUT_MS,
  CODEX_AGENT_USER_HISTORY_LIMIT,
  CodexAgentRunStore,
  canRunCodexAgent,
  getAutonomousAgentTask,
  getOwnerAgentTask,
  shouldAutoRunCodexAgent,
} from "../src/codex-agent.js";

test("limits Codex Agent access to the configured owner", () => {
  assert.equal(canRunCodexAgent("1068329268397998161"), true);
  assert.equal(canRunCodexAgent("other-user"), false);
  assert.equal(canRunCodexAgent(1068329268397998161), false);
});

test("allows only one active Codex Agent per key and aborts it on stop", () => {
  const store = new CodexAgentRunStore();
  const run = store.start("guild:channel", { userId: "owner" });

  assert.ok(run);
  assert.equal(run.controller.signal.aborted, false);
  assert.equal(store.start("guild:channel"), null);
  assert.equal(store.stop("guild:channel"), run);
  assert.equal(run.controller.signal.aborted, true);
  assert.equal(store.size, 0);
});

test("stops all active Codex Agent runs", () => {
  const store = new CodexAgentRunStore();
  const first = store.start("first");
  const second = store.start("second");

  assert.equal(store.stopAll(), 2);
  assert.equal(first.controller.signal.aborted, true);
  assert.equal(second.controller.signal.aborted, true);
  assert.equal(store.size, 0);
});

test("keeps bounded Agent limits explicit", () => {
  assert.equal(CODEX_AGENT_TIMEOUT_MS, 5 * 60_000);
  assert.equal(CODEX_AGENT_MAX_PROMPT_LENGTH, 1_000);
  assert.equal(CODEX_AGENT_CHANNEL_HISTORY_LIMIT, 300);
  assert.equal(CODEX_AGENT_USER_HISTORY_LIMIT, 100);
  assert.equal(CODEX_AGENT_HISTORY_LIMIT, 400);
});

test("only sends necessary questions and requests to the autonomous path", () => {
  assert.equal(getAutonomousAgentTask("普通の会話です"), null);
  assert.equal(getAutonomousAgentTask("こんにちは"), null);
  assert.equal(getAutonomousAgentTask("どうすればいい？"), "どうすればいい？");
  assert.equal(getAutonomousAgentTask("これ調べてまとめて"), "これ調べてまとめて");
  assert.equal(getAutonomousAgentTask("エラーで困ってる"), "エラーで困ってる");
  assert.equal(getAutonomousAgentTask("その件どう？", { relatedScore: 0.4 }), "その件どう？");
  assert.equal(getAutonomousAgentTask("それ", { hasRelevantContext: true }), "それ");
  assert.equal(getAutonomousAgentTask("ありがとう", { relatedScore: 1 }), null);
  assert.equal(getAutonomousAgentTask("/agent task"), null);
  assert.equal(getAutonomousAgentTask("<@123> reply", { botUserId: "123" }), null);
});

test("detects owner instruction messages without requiring a command", () => {
  assert.equal(getOwnerAgentTask("今後は短く返答してほしい"), "今後は短く返答してほしい");
  assert.equal(getOwnerAgentTask("I prefer concise replies."), "I prefer concise replies.");
  assert.equal(getOwnerAgentTask("Discordの履歴を調べてまとめて"), "Discordの履歴を調べてまとめて");
  assert.equal(shouldAutoRunCodexAgent("今日はいい天気だ"), false);
  assert.equal(shouldAutoRunCodexAgent("/agent task"), false);
});

test("does not double-trigger a direct Bot mention", () => {
  assert.equal(
    getOwnerAgentTask("<@123> 調べて", { botUserId: "123" }),
    null,
  );
});

test("does not autonomously answer when a request is explicitly addressed to another user", () => {
  assert.equal(
    getAutonomousAgentTask("<@456> 調べて", {
      botUserId: "123",
      addressedToAnotherUser: true,
      addressedToBot: false,
    }),
    null,
  );
  assert.equal(
    getAutonomousAgentTask("Please check it", {
      botUserId: "123",
      addressedToAnotherUser: false,
      addressedToBot: true,
    }),
    "Please check it",
  );
});
