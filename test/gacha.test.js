import test from "node:test";
import assert from "node:assert/strict";
import { formatGachaResult, parseGachaCommand, rollGacha } from "../src/gacha.js";

test("parses the gacha command", () => {
  assert.equal(parseGachaCommand("!gacha"), true);
  assert.equal(parseGachaCommand(" !GACHA "), true);
  assert.equal(parseGachaCommand("!gacha 10"), false);
});

test("rolls ten independent results with the configured thresholds", () => {
  const randomValues = [0, 0.029, 0.03, 0.214, 0.215, 0.999, 0.5, 0.1, 0.25, 0.8];
  const { results, counts } = rollGacha({
    random: () => randomValues.shift(),
  });

  assert.equal(results.length, 10);
  assert.deepEqual(counts, { purple: 2, yellow: 3, blue: 5 });
  assert.equal(results[0], "purple");
  assert.equal(results[2], "yellow");
  assert.equal(results[4], "blue");
});

test("formats ten-pull results", () => {
  const result = formatGachaResult({
    results: [
      "purple",
      "yellow",
      "blue",
      "purple",
      "yellow",
      "blue",
      "purple",
      "yellow",
      "blue",
      "purple",
    ],
    counts: { purple: 4, yellow: 3, blue: 3 },
  });

  assert.match(result, /10連結果/);
  assert.match(result, /🟪🟨🟦🟪🟨\n🟦🟪🟨🟦🟪/);
  assert.match(result, /🟪 紫: 4回/);
  assert.match(result, /🟨 黄色: 3回/);
  assert.match(result, /🟦 青: 3回/);
});

test("guarantees at least one yellow-or-better result on a ten-pull", () => {
  const { results, counts } = rollGacha({ random: () => 0.999 });

  assert.equal(results.length, 10);
  assert.equal(counts.blue, 9);
  assert.equal(counts.yellow, 1);
  assert.equal(counts.purple, 0);
});

test("purple satisfies the ten-pull guarantee", () => {
  const randomValues = [0, ...Array(9).fill(0.999)];
  const { counts } = rollGacha({ random: () => randomValues.shift() });

  assert.equal(counts.purple, 1);
  assert.equal(counts.yellow, 0);
  assert.equal(counts.blue, 9);
});
