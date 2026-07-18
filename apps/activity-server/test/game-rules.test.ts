import { describe, expect, it } from 'vitest';
import { GAME_RULES, calculateAward, isPocketTimingValid } from '@miq/pachinko-shared';

describe('authoritative game rules', () => {
  it('maps pocket ids to server-defined points and never trusts client points', () => {
    expect(calculateAward('center', 99)).toEqual({
      basePoints: 500,
      bonusMultiplier: 1,
      awardedPoints: 500,
      bonusLabel: null,
    });
  });

  it('applies the random bonus only inside the server-side chance window', () => {
    expect(calculateAward('left', 0).awardedPoints).toBe(100 * GAME_RULES.bonusMultiplier);
    expect(calculateAward('left', GAME_RULES.bonusChancePercent).awardedPoints).toBe(100);
  });

  it('rejects pocket events that arrive too early or too late', () => {
    const createdAt = 1_000;
    expect(isPocketTimingValid(createdAt, createdAt + GAME_RULES.minimumPocketDelayMs)).toBe(true);
    expect(isPocketTimingValid(createdAt, createdAt + GAME_RULES.minimumPocketDelayMs - 1)).toBe(false);
    expect(isPocketTimingValid(createdAt, createdAt + GAME_RULES.maximumPocketDelayMs + 1)).toBe(false);
  });
});
