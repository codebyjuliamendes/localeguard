import path from 'node:path';
import { z } from 'zod';

const booleanFlag = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((value) => value === 'true' || value === '1' || value === 'yes');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3007),
  DATABASE_PATH: z.string().min(1).optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  SEED_DEMO: booleanFlag.default(true),
  TRUST_PROXY: booleanFlag.default(false),
  BODY_LIMIT_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(800 * 1024),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_WINDOW: z.string().min(1).default('1 minute'),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
});

export interface AppConfig {
  env: 'development' | 'test' | 'production';
  host: string;
  port: number;
  databasePath: string;
  logLevel: string;
  seedDemo: boolean;
  trustProxy: boolean;
  bodyLimit: number;
  rateLimit: { max: number; timeWindow: string };
  shutdownTimeoutMs: number;
}

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

/** Validates the environment once at boot; invalid configuration fails fast with every problem listed. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): AppConfig {
  // Treat empty strings like unset so `PORT=` in an env file falls back to the default.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined && value !== ''));
  const parsed = EnvSchema.safeParse(cleaned);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new ConfigError(`Invalid environment configuration: ${problems}`);
  }
  const values = parsed.data;
  return {
    env: values.NODE_ENV,
    host: values.HOST,
    port: values.PORT,
    databasePath: values.DATABASE_PATH ?? path.join(cwd, 'data', 'localeguard.sqlite'),
    logLevel: values.LOG_LEVEL,
    seedDemo: values.SEED_DEMO,
    trustProxy: values.TRUST_PROXY,
    bodyLimit: values.BODY_LIMIT_BYTES,
    rateLimit: { max: values.RATE_LIMIT_MAX, timeWindow: values.RATE_LIMIT_WINDOW },
    shutdownTimeoutMs: values.SHUTDOWN_TIMEOUT_MS,
  };
}
