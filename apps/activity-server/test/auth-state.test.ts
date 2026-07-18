import { describe, expect, it } from 'vitest';
import { createOAuthState, verifyOAuthState } from '../src/auth-state.js';

describe('OAuth state', () => {
  it('round-trips a signed state and rejects tampering', () => {
    const now = 1_000_000;
    const state = createOAuthState('a'.repeat(32), now);
    expect(verifyOAuthState(state, 'a'.repeat(32), now + 1)).toBe(true);
    expect(verifyOAuthState(`${state}x`, 'a'.repeat(32), now + 1)).toBe(false);
  });

  it('rejects expired state values', () => {
    const state = createOAuthState('a'.repeat(32), 1_000);
    expect(verifyOAuthState(state, 'a'.repeat(32), 1_000 + 10 * 60 * 1000 + 1)).toBe(false);
  });
});
