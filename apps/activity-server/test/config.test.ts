import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const baseEnv = {
  DISCORD_CLIENT_ID: '123456789012345678',
  DISCORD_CLIENT_SECRET: 'client-secret',
  SESSION_SECRET: 's'.repeat(32),
  ECONOMY_API_SECRET: 'e'.repeat(32),
  ACTIVITY_BOT_API_SECRET: 'a'.repeat(32),
};

describe('Activity server production config', () => {
  it('fails closed without a Bot token and HTTPS origins', () => {
    expect(() => loadConfig({
      ...baseEnv,
      NODE_ENV: 'production',
      CLIENT_ORIGIN: 'http://activity.example.test',
      DISCORD_REDIRECT_URI: 'http://activity.example.test/oauth',
    })).toThrow(/DISCORD_BOT_TOKEN, CLIENT_ORIGIN, DISCORD_REDIRECT_URI/u);
  });

  it('accepts a production-safe Discord configuration', () => {
    const config = loadConfig({
      ...baseEnv,
      NODE_ENV: 'production',
      CLIENT_ORIGIN: 'https://activity.example.test',
      DISCORD_REDIRECT_URI: 'https://activity.example.test/oauth',
      DISCORD_BOT_TOKEN: 'bot-token',
      DEV_AUTH_ENABLED: 'false',
    });
    expect(config.NODE_ENV).toBe('production');
  });
});
