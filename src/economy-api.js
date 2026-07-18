import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

export const PACHINKO_BALL_COST = 100;

function authorized(header, secret) {
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(header ?? "");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

function send(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 8_192) throw new Error("body_too_large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function createEconomyApiServer({ store, secret, host = "127.0.0.1", port = 3099, authorizePurchase = async () => true }) {
  if (!secret || secret.length < 32) throw new Error("ECONOMY_API_SECRET must contain at least 32 characters.");
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health") return send(response, 200, { ok: true });
    if (!authorized(request.headers.authorization, secret)) return send(response, 401, { error: "unauthorized" });
    if (request.method !== "POST" || request.url !== "/pachinko/purchase") return send(response, 404, { error: "not_found" });
    try {
      const body = await readJson(request);
      if (![body.guildId, body.userId, body.transactionId].every((value) => typeof value === "string" && value.length > 0)) {
        return send(response, 400, { error: "invalid_request" });
      }
      if (!(await authorizePurchase({ guildId: body.guildId, userId: body.userId }))) {
        return send(response, 403, { error: "not_a_guild_member" });
      }
      const existing = store.findEconomyTransaction(body.transactionId);
      if (existing) {
        if (existing.userId !== body.userId || existing.amount !== -PACHINKO_BALL_COST) return send(response, 409, { error: "duplicate" });
        return send(response, 200, { ok: true, cost: PACHINKO_BALL_COST, balance: existing.balanceAfter });
      }
      const result = store.applyWalletDelta({
        guildId: body.guildId,
        userId: body.userId,
        amount: -PACHINKO_BALL_COST,
        reason: "Pachinko Activity: 10 balls",
        type: "pachinko_balls",
        transactionId: body.transactionId,
      });
      if (!result.ok) {
        return send(response, result.reason === "insufficient_funds" ? 402 : 400, {
          error: result.reason,
          balance: result.wallet.balance,
        });
      }
      return send(response, 200, { ok: true, cost: PACHINKO_BALL_COST, balance: result.wallet.balance });
    } catch {
      return send(response, 400, { error: "invalid_request" });
    }
  });
  return {
    listen: () => new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => { server.off("error", reject); resolve(); });
    }),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
