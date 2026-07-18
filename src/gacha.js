const GACHA_RESULTS = Object.freeze({
  purple: Object.freeze({ label: "紫", emoji: "🟪", threshold: 30 }),
  yellow: Object.freeze({ label: "黄色", emoji: "🟨", threshold: 215 }),
  blue: Object.freeze({ label: "青", emoji: "🟦", threshold: 1000 }),
});

function parseGachaCommand(content) {
  return /^!gacha$/i.test(content?.trim() ?? "");
}

function rollGacha({ pulls = 10, random = Math.random } = {}) {
  const results = [];
  const counts = { purple: 0, yellow: 0, blue: 0 };

  for (let index = 0; index < pulls; index += 1) {
    const value = Math.min(Math.floor(random() * 1000), 999);
    const result = value < GACHA_RESULTS.purple.threshold
      ? "purple"
      : value < GACHA_RESULTS.yellow.threshold
        ? "yellow"
        : "blue";
    results.push(result);
    counts[result] += 1;
  }

  if (pulls >= 10 && counts.purple === 0 && counts.yellow === 0) {
    const guaranteedIndex = results.lastIndexOf("blue");
    if (guaranteedIndex >= 0) {
      results[guaranteedIndex] = "yellow";
      counts.blue -= 1;
      counts.yellow += 1;
    }
  }

  return { results, counts };
}

function formatGachaResult({ results, counts }) {
  const squares = results
    .map((result) => GACHA_RESULTS[result].emoji)
    .reduce((rows, emoji, index) => {
      const rowIndex = Math.floor(index / 5);
      rows[rowIndex] ??= [];
      rows[rowIndex].push(emoji);
      return rows;
    }, [])
    .map((row) => row.join(""))
    .join("\n");
  return [
    `10連結果\n${squares}`,
    `🟪 紫: ${counts.purple}回 / 🟨 黄色: ${counts.yellow}回 / 🟦 青: ${counts.blue}回`,
  ].join("\n");
}

export { GACHA_RESULTS, formatGachaResult, parseGachaCommand, rollGacha };
