import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CommunityStore } from "../src/community-store.js";
import { createEconomyApiServer } from "../src/economy-api.js";

test("pachinko purchase debits once and is idempotent", async () => {
  const directory = mkdtempSync(join(tmpdir(), "miq-economy-api-"));
  const store = new CommunityStore({ filePath: join(directory, "data.json"), debounceMs: 0 });
  const api = createEconomyApiServer({ store, secret: "s".repeat(32), port: 31099 });
  await api.listen();
  try {
    const purchase = () => fetch("http://127.0.0.1:31099/pachinko/purchase", {
      method: "POST",
      headers: { Authorization: `Bearer ${"s".repeat(32)}`, "Content-Type": "application/json" },
      body: JSON.stringify({ guildId: "guild-1", userId: "user-1", transactionId: "purchase-1" }),
    });
    assert.equal((await purchase()).status, 200);
    assert.equal((await purchase()).status, 200);
    assert.equal(store.getWallet("guild-1", "user-1").balance, 400);
  } finally {
    await api.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
