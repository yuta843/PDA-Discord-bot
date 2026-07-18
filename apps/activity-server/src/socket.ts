import { parse as parseCookie } from 'cookie';
import { randomInt } from 'node:crypto';
import { Server as SocketIOServer } from 'socket.io';
import {
  INSTANCE_ID_SCHEMA,
  LaunchRequestSchema,
  PocketEventSchema,
  PurchaseBallsRequestSchema,
  GAME_RULES,
  type CharacterState,
  RefillRequestSchema,
  type ClientToServerEvents,
  type InterServerEvents,
  type Participant,
  type RoomState,
  type ServerToClientEvents,
  type SocketData,
  type User,
} from '@miq/pachinko-shared';
import type { AppConfig } from './config.js';
import { verifyActivityInstance } from './discord.js';
import { GameStore } from './db.js';
import { SESSION_COOKIE, readSession } from './session.js';
import { purchaseFromBotEconomy } from './economy.js';

export type ActivitySocketServer = SocketIOServer<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
export type ActivitySocketRuntime = {
  io: ActivitySocketServer;
  publishCharacterState: (roomId: string, guildId: string, state: CharacterState) => boolean;
};

function getRoomId(socket: Parameters<Parameters<ActivitySocketServer['use']>[0]>[0]) {
  return typeof socket.handshake.auth?.roomId === 'string' ? socket.handshake.auth.roomId : '';
}

export function registerSocketServer(httpServer: ConstructorParameters<typeof SocketIOServer>[0], store: GameStore, config: AppConfig) {
  const purchasingUsers = new Set<string>();
  const discordProxyOrigin = `https://${config.DISCORD_CLIENT_ID}.discordsays.com`;
  const io: ActivitySocketServer = new SocketIOServer<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(httpServer, {
    cors: { origin: [config.CLIENT_ORIGIN, discordProxyOrigin], credentials: true },
    transports: ['websocket', 'polling'],
  });
  const characterStateByRoom = new Map<string, CharacterState>();

  io.use(async (socket, next) => {
    const roomIdResult = INSTANCE_ID_SCHEMA.safeParse(getRoomId(socket));
    if (!roomIdResult.success) return next(new Error('invalid_activity_instance'));
    const roomId = roomIdResult.data;
    const cookies = parseCookie(socket.handshake.headers.cookie ?? '');
    const session = readSession(store, cookies[SESSION_COOKIE], roomId, config);
    if (!session) return next(new Error('session_invalid'));
    if (!(await verifyActivityInstance(roomId, config))) return next(new Error('activity_instance_invalid'));
    socket.data.roomId = roomId;
    socket.data.user = session.user;
    socket.data.guildId = session.guildId;
    return next();
  });

  const emitRoomState = (roomId: string) => {
    const participants = getParticipants(io, roomId);
    const state: RoomState = { roomId, players: store.getPlayers(roomId, participants.map(({ id }) => id)), participants };
    io.to(roomId).emit('room:state', state);
  };

  io.on('connection', async (socket) => {
    const { roomId, user } = socket.data;
    store.upsertPlayer(roomId, user);
    await socket.join(roomId);
    emitRoomState(roomId);
    const characterState = characterStateByRoom.get(roomId);
    if (characterState) socket.emit('character:state', characterState);

    socket.on('game:launch', (payload) => {
      const parsed = LaunchRequestSchema.safeParse(payload);
      if (!parsed.success) {
        socket.emit('game:launchRejected', { reason: 'invalid_request' });
        return;
      }
      const result = store.tryCreateLaunch(roomId, user, parsed.data.power, parsed.data.clientLaunchId);
      if (result.kind === 'accepted') {
        socket.emit('game:launchAccepted', {
          launchId: result.launchId,
          clientLaunchId: parsed.data.clientLaunchId,
          power: parsed.data.power,
          ballsRemaining: result.ballsRemaining,
        });
        emitRoomState(roomId);
        return;
      }
      if (result.kind === 'cooldown') {
        socket.emit('game:launchRejected', { reason: 'cooldown', retryAfterMs: result.retryAfterMs });
        return;
      }
      if (result.kind === 'no_balls') {
        socket.emit('game:launchRejected', { reason: 'no_balls' });
        return;
      }
      socket.emit('game:launchRejected', { reason: 'invalid_request' });
    });

    socket.on('game:refill', (payload) => {
      const parsed = RefillRequestSchema.safeParse(payload);
      if (!parsed.success) {
        socket.emit('game:refillRejected', { reason: 'invalid_request' });
        return;
      }
      const result = store.tryRefill(roomId, user, parsed.data.clientRequestId);
      if (result.kind === 'accepted') {
        socket.emit('game:refillAccepted', result);
        emitRoomState(roomId);
        return;
      }
      if (result.kind === 'cooldown') {
        socket.emit('game:refillRejected', { reason: 'cooldown', retryAfterMs: result.retryAfterMs });
        return;
      }
      if (result.kind === 'not_empty') {
        socket.emit('game:refillRejected', { reason: 'not_empty' });
        return;
      }
      socket.emit('game:refillRejected', { reason: 'invalid_request' });
    });

    socket.on('game:pocket', (payload) => {
      const parsed = PocketEventSchema.safeParse(payload);
      if (!parsed.success) {
        socket.emit('game:launchRejected', { reason: 'invalid_request' });
        return;
      }
      const result = store.resolvePocket(
        roomId,
        user,
        parsed.data.launchId,
        parsed.data.pocketId,
        parsed.data.clientEventId,
        randomInt(0, 100),
      );
      if (result.kind === 'awarded') {
        io.to(roomId).emit('game:scoreAwarded', result.scoreAwarded);
        emitRoomState(roomId);
      }
    });

    socket.on('economy:purchaseBalls', async (payload) => {
      const parsed = PurchaseBallsRequestSchema.safeParse(payload);
      if (!parsed.success) return socket.emit('economy:purchaseRejected', { reason: 'invalid_request' });
      if (purchasingUsers.has(user.id)) return socket.emit('economy:purchaseRejected', { reason: 'unavailable' });
      const player = store.getPlayer(roomId, user.id);
      if (!player || player.ballsRemaining + GAME_RULES.purchasedBalls > GAME_RULES.maximumStoredBalls) {
        return socket.emit('economy:purchaseRejected', { reason: 'limit' });
      }
      purchasingUsers.add(user.id);
      try {
        const transactionId = `pachinko:${parsed.data.clientRequestId}`;
        const purchase = await purchaseFromBotEconomy(config, { guildId: socket.data.guildId, userId: user.id, transactionId });
        if (purchase.kind === 'insufficient_funds') {
          socket.emit('economy:purchaseRejected', { reason: 'insufficient_funds', balance: purchase.balance });
          return;
        }
        if (purchase.kind !== 'accepted') {
          socket.emit('economy:purchaseRejected', { reason: 'unavailable' });
          return;
        }
        const credit = store.addPurchasedBalls(user, transactionId, GAME_RULES.purchasedBalls);
        if (credit.kind === 'limit') {
          socket.emit('economy:purchaseRejected', { reason: 'limit' });
          return;
        }
        socket.emit('economy:purchaseAccepted', {
          ballsRemaining: credit.ballsRemaining,
          ballsAdded: GAME_RULES.purchasedBalls,
          cost: purchase.cost,
          balance: purchase.balance,
        });
        emitRoomState(roomId);
      } finally {
        purchasingUsers.delete(user.id);
      }
    });

    socket.on('disconnect', () => {
      emitRoomState(roomId);
      setImmediate(() => {
        if (!io.sockets.adapter.rooms.has(roomId)) characterStateByRoom.delete(roomId);
      });
    });
  });

  return {
    io,
    publishCharacterState(roomId, guildId, state) {
      const hasMatchingParticipant = [...io.sockets.sockets.values()].some(
        (socket) => socket.data.roomId === roomId && socket.data.guildId === guildId,
      );
      if (!hasMatchingParticipant) return false;
      characterStateByRoom.set(roomId, state);
      io.to(roomId).emit('character:state', state);
      return true;
    },
  } satisfies ActivitySocketRuntime;
}

function getParticipants(io: ActivitySocketServer, roomId: string): Participant[] {
  const socketIds = io.sockets.adapter.rooms.get(roomId);
  if (!socketIds) return [];
  const users = new Map<string, User>();
  for (const socketId of socketIds) {
    const user = io.sockets.sockets.get(socketId)?.data.user;
    if (user) users.set(user.id, user);
  }
  return [...users.values()].map((user) => ({ ...user, active: true }));
}
