import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/http/app.js';
import { IN_MEMORY, openDatabase } from '../../src/store/database.js';

describe('failure handling', () => {
  it('reports degraded health and hides internal errors when the database is unavailable', async () => {
    const db = openDatabase(IN_MEMORY);
    const app = await buildApp({
      db,
      logger: false,
      staticRoots: [],
      config: { env: 'test', logLevel: 'silent', trustProxy: false, bodyLimit: 1024, rateLimit: { max: 10, timeWindow: '1 minute' } },
    });
    db.close();
    const health = await app.inject('/api/health');
    expect(health.statusCode).toBe(503);
    expect(health.json()).toMatchObject({ ok: false, status: 'degraded' });

    const workspace = await app.inject('/api/workspace');
    expect(workspace.statusCode).toBe(500);
    expect(workspace.json()).toEqual({ error: 'Internal server error.', requestId: expect.any(String) });
    await app.close();
  });
});
