import { createHmac, randomBytes } from 'node:crypto';
import type { User } from '@miq/pachinko-shared';
import { GameStore } from './db.js';
import type { AppConfig } from './config.js';

export const SESSION_COOKIE = 'pachinko_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hashToken(token: string, secret: string) {
  return createHmac('sha256', secret).update(token).digest('hex');
}

export function createSession(store: GameStore, user: User, instanceId: string, guildId: string, config: AppConfig, now = Date.now()) {
  const token = randomBytes(32).toString('base64url');
  store.createSession(hashToken(token, config.SESSION_SECRET), user, instanceId, guildId, now + SESSION_TTL_MS, now);
  return token;
}

export function readSession(store: GameStore, token: string | undefined, instanceId: string, config: AppConfig, now = Date.now()) {
  if (!token) return null;
  return store.getSession(hashToken(token, config.SESSION_SECRET), instanceId, now);
}

export function deleteSession(store: GameStore, token: string | undefined, config: AppConfig) {
  if (token) store.deleteSession(hashToken(token, config.SESSION_SECRET));
}
