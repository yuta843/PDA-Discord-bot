import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { User } from '@miq/pachinko-shared';
import { GameStore } from '../src/db.js';

const user: User = { id: 'user-1', username: 'player', displayName: 'Player', avatar: null };

describe('SQLite game store', () => {
  let store: GameStore | undefined;

  afterEach(() => store?.close());

  it('decrements balls atomically and enforces the server cooldown', () => {
    store = new GameStore(':memory:');
    const first = store.tryCreateLaunch('room-1', user, 1, '00000000-0000-4000-8000-000000000001', 1_000);
    expect(first.kind).toBe('accepted');
    expect(store.getPlayer('room-1', user.id, 1_000)?.ballsRemaining).toBe(19);

    const second = store.tryCreateLaunch('room-1', user, 1, '00000000-0000-4000-8000-000000000002', 1_500);
    expect(second).toEqual({ kind: 'cooldown', retryAfterMs: 400 });
  });

  it('allows a free refill only at zero and enforces the refill cooldown', () => {
    store = new GameStore(':memory:');
    for (let index = 0; index < 20; index += 1) {
      const result = store.tryCreateLaunch('room-1', user, 1, `launch-${index}`, 1_000 + index * 1_000);
      expect(result.kind).toBe('accepted');
    }
    expect(store.getPlayer('room-1', user.id, 20_000)?.ballsRemaining).toBe(0);

    expect(store.tryRefill('room-1', user, 'refill-1', 30_000)).toEqual({
      kind: 'accepted',
      ballsRemaining: 10,
      refillAmount: 10,
      cooldownMs: 30_000,
    });
    expect(store.tryRefill('room-1', user, 'refill-2', 30_001)).toEqual({ kind: 'not_empty' });

    for (let index = 0; index < 10; index += 1) {
      const result = store.tryCreateLaunch('room-1', user, 1, `refill-launch-${index}`, 31_000 + index * 1_000);
      expect(result.kind).toBe('accepted');
    }
    expect(store.tryRefill('room-1', user, 'refill-3', 59_999)).toEqual({ kind: 'cooldown', retryAfterMs: 1 });
    expect(store.tryRefill('room-1', user, 'refill-4', 60_000).kind).toBe('accepted');
  });

  it('calculates the score from the pocket id and accepts only one event per launch', () => {
    store = new GameStore(':memory:');
    const launch = store.tryCreateLaunch('room-1', user, 0.5, '00000000-0000-4000-8000-000000000003', 1_000);
    if (launch.kind !== 'accepted') throw new Error('launch should be accepted');

    const award = store.resolvePocket(
      'room-1',
      user,
      launch.launchId,
      'center',
      '00000000-0000-4000-8000-000000000004',
      99,
      1_500,
    );
    expect(award.kind).toBe('awarded');
    expect(store.getPlayer('room-1', user.id, 1_500)?.score).toBe(500);

    const duplicate = store.resolvePocket(
      'room-1',
      user,
      launch.launchId,
      'center',
      '00000000-0000-4000-8000-000000000005',
      0,
      1_600,
    );
    expect(duplicate).toEqual({ kind: 'invalid' });
  });

  it('persists the score to a SQLite file so a reload can restore it', () => {
    const folder = mkdtempSync(join(tmpdir(), 'pachinko-'));
    const filePath = join(folder, 'scores.sqlite');
    store = new GameStore(filePath);
    const launch = store.tryCreateLaunch('room-1', user, 0.75, '00000000-0000-4000-8000-000000000005', 1_000);
    if (launch.kind !== 'accepted') throw new Error('launch should be accepted');
    store.resolvePocket('room-1', user, launch.launchId, 'right', '00000000-0000-4000-8000-000000000006', 99, 1_500);
    store.close();
    store = undefined;

    store = new GameStore(filePath);
    expect(store.getPlayer('room-1', user.id)?.score).toBe(250);
    store.close();
    store = undefined;
    rmSync(folder, { recursive: true, force: true });
  });

  it('restores progress by Discord user id across Activity instances', () => {
    store = new GameStore(':memory:');
    const launch = store.tryCreateLaunch('room-1', user, 0.75, '00000000-0000-4000-8000-000000000007', 1_000);
    if (launch.kind !== 'accepted') throw new Error('launch should be accepted');
    store.resolvePocket('room-1', user, launch.launchId, 'center', '00000000-0000-4000-8000-000000000008', 99, 1_500);

    store.upsertPlayer('room-2', user, 2_000);
    expect(store.getPlayer('room-2', user.id, 2_000)).toMatchObject({ score: 500, ballsRemaining: 19 });
  });

  it('recharges one stored ball per minute up to the maximum', () => {
    store = new GameStore(':memory:');
    store.tryCreateLaunch('room-1', user, 1, '00000000-0000-4000-8000-000000000009', 1_000);
    expect(store.getPlayer('room-2', user.id, 61_000)?.ballsRemaining).toBe(20);
  });
});
