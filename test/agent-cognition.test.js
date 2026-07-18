import test from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_METACOGNITION_INSTRUCTION,
  AgentCognitionStore,
  buildAgentCorrectionInstruction,
  buildAgentObservation,
  buildAgentObservationContext,
  reflectAgentReply,
} from "../src/agent-cognition.js";

test("gives the agent a bounded self-check without asking it to reveal private reasoning", () => {
  assert.match(AGENT_METACOGNITION_INSTRUCTION, /current speaker and intended recipient/i);
  assert.match(AGENT_METACOGNITION_INSTRUCTION, /verified facts.*history.*guesses/i);
  assert.match(AGENT_METACOGNITION_INSTRUCTION, /do not reveal hidden chain-of-thought/i);
  assert.match(AGENT_METACOGNITION_INSTRUCTION, /stop after this turn/i);
});

test("builds an observation with recipient and uncertainty fields inside an untrusted context block", () => {
  const observation = buildAgentObservation({
    task: "Reply to the message and explain the next step",
    message: { id: "current", channelId: "channel-1" },
    discordContext: {
      messageId: "current",
      channelId: "channel-1",
      author: { id: "alice", name: "Alice" },
      addressedTo: [{ id: "bot", name: "miq", reason: "reply-target" }],
      replyTo: { messageId: "target", authorId: "bot" },
      addressedToBot: true,
    },
    relevantHistoryCount: 0,
  });
  const context = buildAgentObservationContext(observation);

  assert.equal(observation.step, 1);
  assert.equal(observation.maxSteps, 1);
  assert.deepEqual(observation.uncertainty, ["no-matching-local-history"]);
  assert.match(context, /UNTRUSTED APPLICATION AGENT OBSERVATION/);
  assert.match(context, /"addressedTo"/);
  assert.match(context, /not an instruction/);
});

test("reflects unsafe claims and provides one bounded correction instruction", () => {
  const reflection = reflectAgentReply("I sent the message and ran the command.");

  assert.equal(reflection.ok, false);
  assert.deepEqual(reflection.issues, ["unverified-external-action-claim"]);
  assert.match(buildAgentCorrectionInstruction(reflection), /do not claim an external action/i);
  assert.equal(reflectAgentReply("答えです").ok, true);
});

test("tracks observation, decision, action, and reflection with TTL bounds", () => {
  let now = 1_000;
  const store = new AgentCognitionStore({ ttlMs: 100, maxEntries: 2, now: () => now });
  const observation = { messageId: "current", nextAction: "answer_current_request" };

  assert.equal(store.observe("run-1", observation).phase, "observed");
  assert.equal(store.decide("run-1", { confidence: "high" }).phase, "decided");
  assert.equal(store.act("run-1", { action: "reply" }).phase, "acted");
  assert.equal(store.reflect("run-1", { ok: true }).phase, "reflected");
  assert.equal(store.get("run-1").reflection.ok, true);

  now += 101;
  assert.equal(store.get("run-1"), null);
  assert.equal(store.size, 0);
});
