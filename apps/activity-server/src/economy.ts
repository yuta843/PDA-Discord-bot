import { z } from 'zod';
import type { AppConfig } from './config.js';

const EconomyResponseSchema = z.object({
  ok: z.literal(true),
  cost: z.number().int().positive(),
  balance: z.number().int().nonnegative(),
});

export async function purchaseFromBotEconomy(config: AppConfig, input: { guildId: string; userId: string; transactionId: string }) {
  try {
    const response = await fetch(`${config.ECONOMY_API_URL}/pachinko/purchase`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.ECONOMY_API_SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(5_000),
  });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (response.status === 402) return { kind: 'insufficient_funds' as const, balance: typeof body.balance === 'number' ? body.balance : undefined };
    if (!response.ok) return { kind: 'unavailable' as const };
    const parsed = EconomyResponseSchema.safeParse(body);
    return parsed.success ? { kind: 'accepted' as const, ...parsed.data } : { kind: 'unavailable' as const };
  } catch {
    return { kind: 'unavailable' as const };
  }
}
