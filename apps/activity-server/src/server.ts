import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { CharacterStateSchema, INSTANCE_ID_SCHEMA, UserSchema } from '@miq/pachinko-shared';
import type { AppConfig } from './config.js';
import { createOAuthState, verifyOAuthState } from './auth-state.js';
import { exchangeDiscordCode, fetchDiscordUser } from './discord.js';
import { GameStore } from './db.js';
import { createSession, deleteSession, readSession, SESSION_COOKIE } from './session.js';
import { registerSocketServer } from './socket.js';

const DiscordAuthBodySchema = z.object({
  code: z.string().min(1).max(2_000),
  state: z.string().min(20).max(2_000),
  instanceId: INSTANCE_ID_SCHEMA,
  guildId: z.string().regex(/^\d{17,20}$/),
});
const DevAuthBodySchema = z.object({
  instanceId: INSTANCE_ID_SCHEMA,
  displayName: z.string().min(1).max(100).optional(),
  guildId: z.string().min(1).default('dev-guild'),
});
const InstanceQuerySchema = z.object({ instanceId: INSTANCE_ID_SCHEMA, guildId: z.string().min(1) });
const CharacterStateBodySchema = z.object({
  roomId: INSTANCE_ID_SCHEMA,
  guildId: z.string().regex(/^\d{17,20}$/),
  state: CharacterStateSchema,
});

export async function buildServer(config: AppConfig, store = new GameStore(config.DATABASE_PATH)) {
  const app = Fastify({
    logger: {
      redact: ['req.headers.authorization', 'req.headers.cookie', 'req.body.code', 'req.body.state'],
    },
  });

  const discordProxyOrigin = `https://${config.DISCORD_CLIENT_ID}.discordsays.com`;
  const localActivityOrigins = [
    `http://127.0.0.1:${config.SERVER_PORT}`,
    `http://localhost:${config.SERVER_PORT}`,
    `http://[::1]:${config.SERVER_PORT}`,
  ];
  const allowedOrigins = new Set([config.CLIENT_ORIGIN, discordProxyOrigin, ...localActivityOrigins]);
  const embeddedCookie = config.NODE_ENV === 'production' || !config.DEV_AUTH_ENABLED;
  const sessionCookieOptions = {
    httpOnly: true,
    sameSite: embeddedCookie ? 'none' as const : 'lax' as const,
    secure: embeddedCookie,
    partitioned: embeddedCookie,
    path: '/',
    maxAge: 7 * 24 * 60 * 60,
  };

  await app.register(cookie);
  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('origin_not_allowed'), false);
    },
    credentials: true,
  });
  await app.register(helmet, {
    // CSP frame-ancestors is the Activity allowlist; SAMEORIGIN would block Discord's iframe.
    xFrameOptions: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'", 'https://discord.com', 'https://*.discord.com', 'https://*.discordsays.com'],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        // Local HTTP testing must be able to load its own JS/CSS over HTTP.
        // Keep the HTTPS upgrade for the deployed Activity, but do not turn
        // http://127.0.0.1:3001 into an unusable https://127.0.0.1:3001 URL.
        upgradeInsecureRequests: config.NODE_ENV === 'production' ? [] : null,
        imgSrc: ["'self'", 'data:', 'https://cdn.discordapp.com'],
        connectSrc: ["'self'", config.CLIENT_ORIGIN, discordProxyOrigin, 'https://discord.com', 'wss:', 'https:'],
      },
    },
  });

  app.addHook('onSend', async (_request, reply) => {
    reply.header('Permissions-Policy', 'camera=(self)');
  });

  app.get('/health', async () => ({ ok: true, service: 'pachinko-server', timestamp: new Date().toISOString() }));

  app.get('/api/activity-config', async () => ({
    clientId: config.DISCORD_CLIENT_ID,
    devAuthEnabled: config.NODE_ENV !== 'production' && config.DEV_AUTH_ENABLED,
  }));

  app.get('/api/auth/state', async (_request, reply) => {
    return reply.send({ state: createOAuthState(config.SESSION_SECRET) });
  });

  app.get('/api/auth/me', async (request, reply) => {
    const query = InstanceQuerySchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'invalid_instance' });
    const session = readSession(store, request.cookies[SESSION_COOKIE], query.data.instanceId, config);
    if (!session || session.guildId !== query.data.guildId) return reply.code(401).send({ error: 'session_invalid' });
    return reply.send({ user: session.user, instanceId: session.instanceId });
  });

  app.post('/api/auth/discord', async (request, reply) => {
    const body = DiscordAuthBodySchema.safeParse(request.body);
    if (!body.success || !verifyOAuthState(body.data.state, config.SESSION_SECRET)) {
      return reply.code(400).send({ error: 'invalid_oauth_request' });
    }
    try {
      const accessToken = await exchangeDiscordCode(body.data.code, config);
      const user = UserSchema.parse(await fetchDiscordUser(accessToken, config));
      const sessionToken = createSession(store, user, body.data.instanceId, body.data.guildId, config);
      reply.setCookie(SESSION_COOKIE, sessionToken, sessionCookieOptions);
      return reply.send({ user, instanceId: body.data.instanceId });
    } catch {
      return reply.code(502).send({ error: 'discord_auth_failed' });
    }
  });

  app.post('/api/auth/dev', async (request, reply) => {
    if (!config.DEV_AUTH_ENABLED || config.NODE_ENV === 'production') {
      return reply.code(404).send({ error: 'not_found' });
    }
    const body = DevAuthBodySchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_dev_request' });
    const user = {
      id: 'dev-user',
      username: 'developer',
      displayName: body.data.displayName ?? 'ローカルプレイヤー',
      avatar: null,
    };
    const sessionToken = createSession(store, user, body.data.instanceId, body.data.guildId, config);
    reply.setCookie(SESSION_COOKIE, sessionToken, sessionCookieOptions);
    return reply.send({ user, instanceId: body.data.instanceId });
  });

  app.post('/api/auth/logout', async (request, reply) => {
    deleteSession(store, request.cookies[SESSION_COOKIE], config);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.code(204).send();
  });

  const clientDist = join(dirname(fileURLToPath(import.meta.url)), '../../activity-client/dist');
  if (existsSync(clientDist)) {
    await app.register(fastifyStatic, { root: clientDist, prefix: '/' });
    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && request.headers.accept?.includes('text/html')) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: 'not_found' });
    });
  }

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, 'request failed');
    return reply.code(500).send({ error: 'internal_server_error' });
  });

  const socketRuntime = registerSocketServer(app.server, store, config);
  app.post('/internal/character-state', async (request, reply) => {
    const supplied = Buffer.from(request.headers.authorization ?? '');
    const expected = Buffer.from(`Bearer ${config.ACTIVITY_BOT_API_SECRET}`);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const body = CharacterStateBodySchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_character_state' });
    const updated = socketRuntime.publishCharacterState(body.data.roomId, body.data.guildId, body.data.state);
    return reply.send({ ok: true, updated });
  });
  app.addHook('onClose', (_instance, done) => {
    socketRuntime.io.close();
    done();
  });
  return app;
}

export type ActivityServer = FastifyInstance;
