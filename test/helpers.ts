import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/http/app.js';
import { IN_MEMORY, openDatabase } from '../src/store/database.js';
import { seedDemo } from '../src/store/demo.js';
import { Repository } from '../src/store/repository.js';

export const PUBLIC_DIR = new URL('../public', import.meta.url).pathname;

export async function testApp(options: { seed?: boolean; rateLimitMax?: number } = {}): Promise<FastifyInstance> {
  const db = openDatabase(IN_MEMORY);
  if (options.seed ?? true) seedDemo(new Repository(db));
  return buildApp({
    db,
    logger: false,
    staticRoots: [PUBLIC_DIR],
    config: {
      env: 'test',
      logLevel: 'silent',
      trustProxy: false,
      bodyLimit: 800 * 1024,
      rateLimit: { max: options.rateLimitMax ?? 1000, timeWindow: '1 minute' },
    },
  });
}
