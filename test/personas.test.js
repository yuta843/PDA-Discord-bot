import test from "node:test";
import assert from "node:assert/strict";
import { parsePersonaSwitchCommand } from "../src/personas.js";

test("parses the pda_founder persona switch command", () => {
  assert.deepEqual(parsePersonaSwitchCommand("ペルソナ切り替え: pda_founder"), {
    persona: "pda_founder",
  });
});

test("accepts whitespace and a full-width colon in the persona switch command", () => {
  assert.deepEqual(parsePersonaSwitchCommand("  ペルソナ切り替え  ：  PDA_FOUNDER  "), {
    persona: "pda_founder",
  });
});

test("parses the Danjo Towa persona switch by internal name or Japanese name", () => {
  assert.deepEqual(parsePersonaSwitchCommand("ペルソナ切り替え: danjo_towa"), {
    persona: "danjo_towa",
  });
  assert.deepEqual(parsePersonaSwitchCommand("ペルソナ切り替え：壇上十和"), {
    persona: "danjo_towa",
  });
});

test("does not treat unrelated persona text as a switch command", () => {
  assert.equal(parsePersonaSwitchCommand("ペルソナ切り替え: jishou"), null);
  assert.equal(parsePersonaSwitchCommand("ペルソナ切り替え: pda_founder 追加説明"), null);
  assert.equal(parsePersonaSwitchCommand("ペルソナ切り替え: danjo_towa 追加説明"), null);
  assert.equal(parsePersonaSwitchCommand("通常のメッセージ"), null);
});
