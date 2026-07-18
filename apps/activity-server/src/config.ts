import { z } from 'zod';

const booleanEnv = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SERVER_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  CLIENT_ORIGIN: z.string().url().default('http://localhost:5173'),
  DATABASE_PATH: z.string().min(1).default('./data/pachinko.sqlite'),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_CLIENT_SECRET: z.string().min(1),
  DISCORD_REDIRECT_URI: z.string().url().default('https://127.0.0.1'),
  DISCORD_BOT_TOKEN: z.string().min(1).optional(),
  SESSION_SECRET: z.string().min(32),
  DEV_AUTH_ENABLED: booleanEnv.default('false'),
  ECONOMY_API_URL: z.string().url().default('http://127.0.0.1:3099'),
  ECONOMY_API_SECRET: z.string().min(32),
  ACTIVITY_BOT_API_SECRET: z.string().min(32),
  DISCORD_API_BASE_URL: z.string().url().default('https://discord.com/api/v10'),
}).superRefine((value, context) => {
  if (value.NODE_ENV !== 'production') return;
  if (!value.DISCORD_BOT_TOKEN) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['DISCORD_BOT_TOKEN'], message: 'Required in production' });
  }
  if (value.DEV_AUTH_ENABLED) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['DEV_AUTH_ENABLED'], message: 'Must be false in production' });
  }
  for (const field of ['CLIENT_ORIGIN', 'DISCORD_REDIRECT_URI'] as const) {
    if (!value[field].startsWith('https://')) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: 'HTTPS is required in production' });
    }
  }
  if (value.DISCORD_API_BASE_URL !== 'https://discord.com/api/v10') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['DISCORD_API_BASE_URL'], message: 'Official Discord API is required in production' });
  }
});

export type AppConfig = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    const fields = result.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Invalid server environment: ${fields}`);
  }
  return result.data;
}
