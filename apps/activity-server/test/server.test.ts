import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { GameStore } from '../src/db.js';
import { io as createSocket } from 'socket.io-client';

const config = {
  NODE_ENV: 'development' as const,
  SERVER_PORT: 3001,
  CLIENT_ORIGIN: 'https://activity.example.test',
  DATABASE_PATH: ':memory:',
  DISCORD_CLIENT_ID: '123456789012345678',
  DISCORD_CLIENT_SECRET: 'client-secret',
  DISCORD_REDIRECT_URI: 'https://activity.example.test/oauth/callback',
  SESSION_SECRET: 's'.repeat(32),
  DEV_AUTH_ENABLED: false,
  ECONOMY_API_URL: 'http://127.0.0.1:3099',
  ECONOMY_API_SECRET: 'e'.repeat(32),
  ACTIVITY_BOT_API_SECRET: 'a'.repeat(32),
  DISCORD_API_BASE_URL: 'https://discord.com/api/v10',
};

describe('Activity server delivery', () => {
  it('delivers an authenticated Bot state update only to its exact Activity room', async () => {
    const store = new GameStore(':memory:');
    const devConfig = { ...config, DEV_AUTH_ENABLED: true };
    const app = await buildServer(devConfig, store);
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not bind to TCP.');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const roomId = 'activity-room-1';
    const guildId = '123456789012345678';
    const auth = await app.inject({
      method: 'POST',
      url: '/api/auth/dev',
      payload: { instanceId: roomId, guildId },
    });
    const cookie = auth.headers['set-cookie']?.split(';', 1)[0];
    expect(cookie).toBeTruthy();
    const socket = createSocket(baseUrl, {
      auth: { roomId },
      extraHeaders: { cookie: cookie! },
      transports: ['websocket'],
    });
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('connect_error', reject);
      });
      const received = new Promise<unknown>((resolve) => socket.once('character:state', resolve));
      const state = { phase: 'thinking', emotion: 'neutral', text: '', turnId: null, updatedAt: new Date().toISOString() };
      const update = await app.inject({
        method: 'POST',
        url: '/internal/character-state',
        headers: { authorization: `Bearer ${config.ACTIVITY_BOT_API_SECRET}` },
        payload: { roomId, guildId, state },
      });
      expect(update.statusCode).toBe(200);
      expect(update.json()).toEqual({ ok: true, updated: true });
      expect(await received).toEqual(state);
    } finally {
      socket.disconnect();
      await app.close();
      store.close();
    }
  });

  it('rejects unauthenticated and invalid character state updates', async () => {
    const store = new GameStore(':memory:');
    const app = await buildServer(config, store);
    try {
      const unauthorized = await app.inject({ method: 'POST', url: '/internal/character-state', payload: {} });
      expect(unauthorized.statusCode).toBe(401);

      const invalid = await app.inject({
        method: 'POST',
        url: '/internal/character-state',
        headers: { authorization: `Bearer ${config.ACTIVITY_BOT_API_SECRET}` },
        payload: { guildId: 'not-a-guild', state: {} },
      });
      expect(invalid.statusCode).toBe(400);
    } finally {
      await app.close();
      store.close();
    }
  });

  it('serves client assets for the local Activity origin without HTTPS upgrade', async () => {
    const store = new GameStore(':memory:');
    const app = await buildServer(config, store);
    try {
      const index = await app.inject({ method: 'GET', url: '/' });
      expect(index.statusCode).toBe(200);
      const assetName = index.body.match(/\/assets\/(index-[^"]+\.js)/)?.[1];
      expect(assetName).toBeTruthy();

      const asset = await app.inject({
        method: 'GET',
        url: `/assets/${assetName}`,
        headers: { origin: 'http://127.0.0.1:3001' },
      });
      expect(asset.statusCode).toBe(200);
      expect(asset.headers['content-type']).toContain('application/javascript');
      expect(asset.headers['content-security-policy']).not.toContain('upgrade-insecure-requests');
    } finally {
      await app.close();
      store.close();
    }
  });
});
