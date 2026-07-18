import { z } from 'zod';

export const ROOM_ID_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/;
export const INSTANCE_ID_SCHEMA = z.string().regex(ROOM_ID_PATTERN, 'Invalid Activity instance ID');

export const CharacterPhaseSchema = z.enum(['idle', 'listening', 'thinking', 'speaking']);
export type CharacterPhase = z.infer<typeof CharacterPhaseSchema>;

export const CharacterEmotionSchema = z.enum(['neutral', 'happy', 'sad', 'angry', 'surprised']);
export type CharacterEmotion = z.infer<typeof CharacterEmotionSchema>;

export const CharacterStateSchema = z.object({
  phase: CharacterPhaseSchema,
  emotion: CharacterEmotionSchema.default('neutral'),
  text: z.string().max(2_000).default(''),
  turnId: z.string().max(100).nullable().default(null),
  updatedAt: z.string().datetime(),
});
export type CharacterState = z.infer<typeof CharacterStateSchema>;

export const PocketIdSchema = z.enum(['left', 'right', 'center']);
export type PocketId = z.infer<typeof PocketIdSchema>;

export const PocketDefinitionSchema = z.object({
  id: PocketIdSchema,
  label: z.string(),
  points: z.number().int().positive(),
  color: z.string(),
});

export const POCKETS: Record<PocketId, z.infer<typeof PocketDefinitionSchema>> = {
  left: { id: 'left', label: '左ポケット', points: 100, color: '#5eead4' },
  right: { id: 'right', label: '右ポケット', points: 250, color: '#fbbf24' },
  center: { id: 'center', label: 'センターポケット', points: 500, color: '#fb7185' },
};

export const GAME_RULES = {
  initialBalls: 20,
  maximumBalls: 20,
  ballRechargeMs: 60_000,
  purchasedBalls: 10,
  purchasedBallCost: 100,
  maximumStoredBalls: 200,
  refillAmount: 10,
  refillCooldownMs: 30_000,
  launchCooldownMs: 900,
  minimumPocketDelayMs: 350,
  maximumPocketDelayMs: 20_000,
  bonusChancePercent: 12,
  bonusMultiplier: 2,
} as const;

export const UserSchema = z.object({
  id: z.string().min(1).max(64),
  username: z.string().min(1).max(100),
  displayName: z.string().min(1).max(100),
  avatar: z.string().max(200).nullable(),
});
export type User = z.infer<typeof UserSchema>;

export const ParticipantSchema = UserSchema.extend({
  active: z.boolean(),
});
export type Participant = z.infer<typeof ParticipantSchema>;

export const PlayerScoreSchema = z.object({
  userId: z.string(),
  displayName: z.string(),
  avatar: z.string().nullable(),
  score: z.number().int().nonnegative(),
  ballsRemaining: z.number().int().nonnegative(),
});
export type PlayerScore = z.infer<typeof PlayerScoreSchema>;

export const RoomStateSchema = z.object({
  roomId: INSTANCE_ID_SCHEMA,
  players: z.array(PlayerScoreSchema),
  participants: z.array(ParticipantSchema),
});
export type RoomState = z.infer<typeof RoomStateSchema>;

export const LaunchRequestSchema = z.object({
  power: z.number().min(0.25).max(1),
  clientLaunchId: z.string().uuid(),
});
export type LaunchRequest = z.infer<typeof LaunchRequestSchema>;

export const RefillRequestSchema = z.object({
  clientRequestId: z.string().uuid(),
});

export const PurchaseBallsRequestSchema = z.object({
  clientRequestId: z.string().uuid(),
});
export type PurchaseBallsRequest = z.infer<typeof PurchaseBallsRequestSchema>;

export const PurchaseBallsResultSchema = z.object({
  ballsRemaining: z.number().int().nonnegative(),
  ballsAdded: z.number().int().positive(),
  cost: z.number().int().positive(),
  balance: z.number().int().nonnegative(),
});
export type PurchaseBallsResult = z.infer<typeof PurchaseBallsResultSchema>;
export type RefillRequest = z.infer<typeof RefillRequestSchema>;

export const RefillAcceptedSchema = z.object({
  ballsRemaining: z.number().int().positive(),
  refillAmount: z.number().int().positive(),
  cooldownMs: z.number().int().positive(),
});
export type RefillAccepted = z.infer<typeof RefillAcceptedSchema>;

export const RefillRejectedSchema = z.object({
  reason: z.enum(['cooldown', 'not_empty', 'invalid_request']),
  retryAfterMs: z.number().int().nonnegative().optional(),
});
export type RefillRejected = z.infer<typeof RefillRejectedSchema>;

export const LaunchAcceptedSchema = z.object({
  launchId: z.string().uuid(),
  clientLaunchId: z.string().uuid(),
  power: z.number().min(0.25).max(1),
  ballsRemaining: z.number().int().nonnegative(),
});
export type LaunchAccepted = z.infer<typeof LaunchAcceptedSchema>;

export const PocketEventSchema = z.object({
  launchId: z.string().uuid(),
  pocketId: PocketIdSchema,
  clientEventId: z.string().uuid(),
});
export type PocketEvent = z.infer<typeof PocketEventSchema>;

export const ScoreAwardedSchema = z.object({
  eventId: z.string().uuid(),
  launchId: z.string().uuid(),
  userId: z.string(),
  displayName: z.string(),
  pocketId: PocketIdSchema,
  basePoints: z.number().int().positive(),
  bonusMultiplier: z.number().int().positive(),
  awardedPoints: z.number().int().positive(),
  bonusLabel: z.string().nullable(),
  score: z.number().int().nonnegative(),
  ballsRemaining: z.number().int().nonnegative(),
});
export type ScoreAwarded = z.infer<typeof ScoreAwardedSchema>;

export const LaunchRejectedSchema = z.object({
  reason: z.enum(['invalid_request', 'cooldown', 'no_balls', 'session_invalid', 'server_error']),
  retryAfterMs: z.number().int().nonnegative().optional(),
});
export type LaunchRejected = z.infer<typeof LaunchRejectedSchema>;

export interface ClientToServerEvents {
  'game:launch': (payload: LaunchRequest) => void;
  'game:pocket': (payload: PocketEvent) => void;
  'game:refill': (payload: RefillRequest) => void;
  'economy:purchaseBalls': (payload: PurchaseBallsRequest) => void;
}

export interface ServerToClientEvents {
  'character:state': (state: CharacterState) => void;
  'room:state': (state: RoomState) => void;
  'game:launchAccepted': (payload: LaunchAccepted) => void;
  'game:launchRejected': (payload: LaunchRejected) => void;
  'game:scoreAwarded': (payload: ScoreAwarded) => void;
  'game:refillAccepted': (payload: RefillAccepted) => void;
  'game:refillRejected': (payload: RefillRejected) => void;
  'economy:purchaseAccepted': (payload: PurchaseBallsResult) => void;
  'economy:purchaseRejected': (payload: { reason: 'insufficient_funds' | 'limit' | 'unavailable' | 'invalid_request'; balance?: number }) => void;
}

export interface InterServerEvents {
  ping: () => void;
}

export interface SocketData {
  roomId: string;
  user: User;
  guildId: string;
}

export function getPocketDefinition(pocketId: PocketId) {
  return POCKETS[pocketId];
}

export function calculateAward(pocketId: PocketId, bonusRoll: number) {
  const pocket = getPocketDefinition(pocketId);
  const hasBonus = bonusRoll < GAME_RULES.bonusChancePercent;
  const bonusMultiplier = hasBonus ? GAME_RULES.bonusMultiplier : 1;
  return {
    basePoints: pocket.points,
    bonusMultiplier,
    awardedPoints: pocket.points * bonusMultiplier,
    bonusLabel: hasBonus ? 'LUCKY ×2' : null,
  };
}

export function isPocketTimingValid(createdAt: number, now: number) {
  const elapsed = now - createdAt;
  return elapsed >= GAME_RULES.minimumPocketDelayMs && elapsed <= GAME_RULES.maximumPocketDelayMs;
}
