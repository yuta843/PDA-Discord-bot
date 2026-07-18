import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  GAME_RULES,
  INSTANCE_ID_SCHEMA,
  type PocketId,
  type PlayerScore,
  type ScoreAwarded,
  type User,
  calculateAward,
} from '@miq/pachinko-shared';

export type SqliteDatabase = DatabaseSync;

export interface SessionRecord {
  tokenHash: string;
  user: User;
  instanceId: string;
  guildId: string;
  expiresAt: number;
}

type PlayerRow = {
  user_id: string;
  display_name: string;
  avatar: string | null;
  score: number;
  balls_remaining: number;
  last_ball_at: number;
};

type LaunchRow = {
  launch_id: string;
  instance_id: string;
  user_id: string;
  created_at: number;
  resolved_at: number | null;
};

export class GameStore {
  readonly db: SqliteDatabase;

  constructor(filePath: string) {
    if (filePath !== ':memory:') mkdirSync(dirname(filePath), { recursive: true });
    this.db = new DatabaseSync(filePath, {
      timeout: 5_000,
      enableForeignKeyConstraints: true,
      allowBareNamedParameters: true,
    });
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS player_scores (
        instance_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        avatar TEXT,
        score INTEGER NOT NULL DEFAULT 0 CHECK (score >= 0),
        balls_remaining INTEGER NOT NULL DEFAULT ${GAME_RULES.initialBalls} CHECK (balls_remaining >= 0),
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (instance_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS player_progress (
        user_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        avatar TEXT,
        score INTEGER NOT NULL DEFAULT 0 CHECK (score >= 0),
        balls_remaining INTEGER NOT NULL DEFAULT ${GAME_RULES.initialBalls} CHECK (balls_remaining >= 0),
        last_ball_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        display_name TEXT NOT NULL,
        avatar TEXT,
        instance_id TEXT NOT NULL,
        guild_id TEXT NOT NULL DEFAULT '',
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
      CREATE TABLE IF NOT EXISTS launches (
        launch_id TEXT PRIMARY KEY,
        client_launch_id TEXT NOT NULL UNIQUE,
        instance_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        power REAL NOT NULL,
        created_at INTEGER NOT NULL,
        resolved_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_launches_user_time ON launches(instance_id, user_id, created_at);
      CREATE TABLE IF NOT EXISTS score_events (
        event_id TEXT PRIMARY KEY,
        launch_id TEXT NOT NULL UNIQUE REFERENCES launches(launch_id),
        client_event_id TEXT NOT NULL UNIQUE,
        instance_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        pocket_id TEXT NOT NULL,
        base_points INTEGER NOT NULL,
        bonus_multiplier INTEGER NOT NULL,
        awarded_points INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS player_refills (
        instance_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        last_refilled_at INTEGER NOT NULL,
        PRIMARY KEY (instance_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS refill_requests (
        client_request_id TEXT PRIMARY KEY,
        instance_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ball_purchases (
        transaction_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        balls_added INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    const sessionColumns = this.db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>;
    if (!sessionColumns.some(({ name }) => name === 'guild_id')) {
      this.db.exec("ALTER TABLE sessions ADD COLUMN guild_id TEXT NOT NULL DEFAULT ''");
    }
    this.db.exec(`
      INSERT OR IGNORE INTO player_progress
        (user_id, display_name, avatar, score, balls_remaining, last_ball_at, updated_at)
      SELECT user_id, MAX(display_name), MAX(avatar), MAX(score), MAX(balls_remaining), MAX(updated_at), MAX(updated_at)
      FROM player_scores
      GROUP BY user_id;
    `);
  }

  close() {
    this.db.close();
  }

  upsertPlayer(instanceId: string, user: User, now = Date.now()) {
    INSTANCE_ID_SCHEMA.parse(instanceId);
    this.db
      .prepare(`
        INSERT INTO player_progress (user_id, display_name, avatar, last_ball_at, updated_at)
        VALUES (@userId, @displayName, @avatar, @now, @now)
        ON CONFLICT(user_id) DO UPDATE SET
          display_name = excluded.display_name,
          avatar = excluded.avatar,
          updated_at = excluded.updated_at
      `)
      .run({
        userId: user.id,
        displayName: user.displayName,
        avatar: user.avatar,
        now,
      });
    this.rechargeBalls(user.id, now);
  }

  getPlayer(instanceId: string, userId: string, now = Date.now()): PlayerScore | null {
    INSTANCE_ID_SCHEMA.parse(instanceId);
    this.rechargeBalls(userId, now);
    const row = this.db
      .prepare('SELECT * FROM player_progress WHERE user_id = ?')
      .get(userId) as PlayerRow | undefined;
    return row ? this.toPlayerScore(row) : null;
  }

  getPlayers(instanceId: string, userIds?: string[]): PlayerScore[] {
    INSTANCE_ID_SCHEMA.parse(instanceId);
    if (!userIds?.length) return [];
    const now = Date.now();
    for (const userId of userIds) this.rechargeBalls(userId, now);
    const rows = userIds
      .map((userId) => this.db.prepare('SELECT * FROM player_progress WHERE user_id = ?').get(userId) as PlayerRow | undefined)
      .filter((row): row is PlayerRow => Boolean(row));
    return rows.sort((a, b) => b.score - a.score || a.display_name.localeCompare(b.display_name)).map((row) => this.toPlayerScore(row));
  }

  tryRefill(
    instanceId: string,
    user: User,
    clientRequestId: string,
    now = Date.now(),
  ):
    | { kind: 'accepted'; ballsRemaining: number; refillAmount: number; cooldownMs: number }
    | { kind: 'cooldown'; retryAfterMs: number }
    | { kind: 'not_empty' }
    | { kind: 'invalid_request' } {
    return this.withTransaction(() => {
      this.upsertPlayer(instanceId, user, now);
      const duplicate = this.db.prepare('SELECT client_request_id FROM refill_requests WHERE client_request_id = ?').get(clientRequestId);
      if (duplicate) return { kind: 'invalid_request' as const };

      const player = this.db
        .prepare('SELECT balls_remaining FROM player_progress WHERE user_id = ?')
        .get(user.id) as { balls_remaining: number } | undefined;
      if (!player || player.balls_remaining > 0) {
        this.db.prepare('INSERT INTO refill_requests (client_request_id, instance_id, user_id, created_at) VALUES (?, ?, ?, ?)').run(clientRequestId, instanceId, user.id, now);
        return { kind: 'not_empty' as const };
      }

      const previous = this.db
        .prepare('SELECT last_refilled_at FROM player_refills WHERE instance_id = ? AND user_id = ?')
        .get(instanceId, user.id) as { last_refilled_at: number } | undefined;
      if (previous) {
        const elapsed = now - previous.last_refilled_at;
        if (elapsed < GAME_RULES.refillCooldownMs) {
          return { kind: 'cooldown' as const, retryAfterMs: GAME_RULES.refillCooldownMs - elapsed };
        }
      }

      this.db.prepare('INSERT INTO refill_requests (client_request_id, instance_id, user_id, created_at) VALUES (?, ?, ?, ?)').run(clientRequestId, instanceId, user.id, now);
      this.db.prepare(`
        UPDATE player_progress SET balls_remaining = ?, last_ball_at = ?, updated_at = ? WHERE user_id = ?
      `).run(GAME_RULES.refillAmount, now, now, user.id);
      this.db.prepare(`
        INSERT INTO player_refills (instance_id, user_id, last_refilled_at) VALUES (?, ?, ?)
        ON CONFLICT(instance_id, user_id) DO UPDATE SET last_refilled_at = excluded.last_refilled_at
      `).run(instanceId, user.id, now);
      return {
        kind: 'accepted' as const,
        ballsRemaining: GAME_RULES.refillAmount,
        refillAmount: GAME_RULES.refillAmount,
        cooldownMs: GAME_RULES.refillCooldownMs,
      };
    });
  }

  createSession(tokenHash: string, user: User, instanceId: string, guildId: string, expiresAt: number, now = Date.now()) {
    this.db
      .prepare(`
        INSERT INTO sessions (token_hash, user_id, username, display_name, avatar, instance_id, guild_id, expires_at, created_at)
        VALUES (@tokenHash, @userId, @username, @displayName, @avatar, @instanceId, @guildId, @expiresAt, @now)
      `)
      .run({ tokenHash, userId: user.id, username: user.username, displayName: user.displayName, avatar: user.avatar, instanceId, guildId, expiresAt, now });
    this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
  }

  getSession(tokenHash: string, instanceId: string, now = Date.now()): SessionRecord | null {
    const row = this.db
      .prepare('SELECT * FROM sessions WHERE token_hash = ? AND instance_id = ? AND expires_at >= ?')
      .get(tokenHash, instanceId, now) as {
      token_hash: string;
      user_id: string;
      username: string;
      display_name: string;
      avatar: string | null;
      instance_id: string;
      expires_at: number;
      guild_id: string;
    } | undefined;
    if (!row) return null;
    return {
      tokenHash: row.token_hash,
      user: { id: row.user_id, username: row.username, displayName: row.display_name, avatar: row.avatar },
      instanceId: row.instance_id,
      guildId: row.guild_id,
      expiresAt: row.expires_at,
    };
  }

  deleteSession(tokenHash: string) {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  }

  addPurchasedBalls(user: User, transactionId: string, amount: number, now = Date.now()) {
    return this.withTransaction(() => {
      this.upsertPlayer('purchase', user, now);
      const existing = this.db.prepare('SELECT transaction_id FROM ball_purchases WHERE transaction_id = ?').get(transactionId);
      if (existing) return { kind: 'duplicate' as const, ballsRemaining: this.getPlayer('purchase', user.id, now)?.ballsRemaining ?? 0 };
      const player = this.getPlayer('purchase', user.id, now);
      if (!player || player.ballsRemaining + amount > GAME_RULES.maximumStoredBalls) return { kind: 'limit' as const };
      const ballsRemaining = player.ballsRemaining + amount;
      this.db.prepare('UPDATE player_progress SET balls_remaining = ?, updated_at = ? WHERE user_id = ?').run(ballsRemaining, now, user.id);
      this.db.prepare('INSERT INTO ball_purchases (transaction_id, user_id, balls_added, created_at) VALUES (?, ?, ?, ?)').run(transactionId, user.id, amount, now);
      return { kind: 'accepted' as const, ballsRemaining };
    });
  }

  tryCreateLaunch(
    instanceId: string,
    user: User,
    power: number,
    clientLaunchId: string,
    now = Date.now(),
  ):
    | { kind: 'accepted'; launchId: string; ballsRemaining: number }
    | { kind: 'cooldown'; retryAfterMs: number }
    | { kind: 'no_balls' }
    | { kind: 'invalid_request' } {
    return this.withTransaction(() => {
      this.upsertPlayer(instanceId, user, now);
      const duplicate = this.db.prepare('SELECT launch_id FROM launches WHERE client_launch_id = ?').get(clientLaunchId);
      if (duplicate) return { kind: 'invalid_request' as const };

      const player = this.db
        .prepare('SELECT balls_remaining FROM player_progress WHERE user_id = ?')
        .get(user.id) as { balls_remaining: number } | undefined;
      if (!player || player.balls_remaining <= 0) return { kind: 'no_balls' as const };

      const latest = this.db
        .prepare('SELECT created_at FROM launches WHERE instance_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1')
        .get(instanceId, user.id) as { created_at: number } | undefined;
      if (latest) {
        const elapsed = now - latest.created_at;
        if (elapsed < GAME_RULES.launchCooldownMs) {
          return { kind: 'cooldown' as const, retryAfterMs: GAME_RULES.launchCooldownMs - elapsed };
        }
      }

      const launchId = randomUUID();
      const nextBalls = player.balls_remaining - 1;
      this.db.prepare(`
        UPDATE player_progress SET balls_remaining = ?, last_ball_at = ?, updated_at = ? WHERE user_id = ?
      `).run(nextBalls, now, now, user.id);
      this.db.prepare(`
        INSERT INTO launches (launch_id, client_launch_id, instance_id, user_id, power, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(launchId, clientLaunchId, instanceId, user.id, power, now);
      return { kind: 'accepted' as const, launchId, ballsRemaining: nextBalls };
    });
  }

  resolvePocket(
    instanceId: string,
    user: User,
    launchId: string,
    pocketId: PocketId,
    clientEventId: string,
    bonusRoll: number,
    now = Date.now(),
  ):
    | { kind: 'awarded'; scoreAwarded: ScoreAwarded }
    | { kind: 'invalid' | 'too_early' | 'expired' | 'duplicate' } {
    return this.withTransaction(() => {
      const duplicateEvent = this.db.prepare('SELECT event_id FROM score_events WHERE client_event_id = ?').get(clientEventId);
      if (duplicateEvent) return { kind: 'duplicate' as const };

      const launch = this.db
        .prepare('SELECT * FROM launches WHERE launch_id = ? AND instance_id = ? AND user_id = ?')
        .get(launchId, instanceId, user.id) as LaunchRow | undefined;
      if (!launch || launch.resolved_at !== null) return { kind: 'invalid' as const };
      const elapsed = now - launch.created_at;
      if (elapsed < GAME_RULES.minimumPocketDelayMs) return { kind: 'too_early' as const };
      if (elapsed > GAME_RULES.maximumPocketDelayMs) {
        this.db.prepare('UPDATE launches SET resolved_at = ? WHERE launch_id = ?').run(now, launchId);
        return { kind: 'expired' as const };
      }

      const award = calculateAward(pocketId, bonusRoll);
      const eventId = randomUUID();
      this.db.prepare('UPDATE launches SET resolved_at = ? WHERE launch_id = ?').run(now, launchId);
      this.db.prepare(`
        UPDATE player_progress SET score = score + ?, updated_at = ?
        WHERE user_id = ?
      `).run(award.awardedPoints, now, user.id);
      this.db.prepare(`
        INSERT INTO score_events (event_id, launch_id, client_event_id, instance_id, user_id, pocket_id, base_points, bonus_multiplier, awarded_points, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(eventId, launchId, clientEventId, instanceId, user.id, pocketId, award.basePoints, award.bonusMultiplier, award.awardedPoints, now);
      const player = this.getPlayer(instanceId, user.id, now);
      if (!player) return { kind: 'invalid' as const };
      return {
        kind: 'awarded' as const,
        scoreAwarded: {
          eventId,
          launchId,
          userId: user.id,
          displayName: user.displayName,
          pocketId,
          ...award,
          score: player.score,
          ballsRemaining: player.ballsRemaining,
        },
      };
    });
  }

  private toPlayerScore(row: PlayerRow): PlayerScore {
    return {
      userId: row.user_id,
      displayName: row.display_name,
      avatar: row.avatar,
      score: row.score,
      ballsRemaining: row.balls_remaining,
    };
  }

  private rechargeBalls(userId: string, now: number) {
    const row = this.db.prepare('SELECT balls_remaining, last_ball_at FROM player_progress WHERE user_id = ?').get(userId) as
      | { balls_remaining: number; last_ball_at: number }
      | undefined;
    if (!row || row.balls_remaining >= GAME_RULES.maximumBalls) return;
    const earned = Math.floor((now - row.last_ball_at) / GAME_RULES.ballRechargeMs);
    if (earned <= 0) return;
    const nextBalls = Math.min(GAME_RULES.maximumBalls, row.balls_remaining + earned);
    const consumedIntervals = nextBalls - row.balls_remaining;
    this.db.prepare(`
      UPDATE player_progress SET balls_remaining = ?, last_ball_at = ?, updated_at = ? WHERE user_id = ?
    `).run(nextBalls, row.last_ball_at + consumedIntervals * GAME_RULES.ballRechargeMs, now, userId);
  }

  private withTransaction<T>(callback: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = callback();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
