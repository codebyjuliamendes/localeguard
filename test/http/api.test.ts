import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  ErrorResponse,
  HealthResponse,
  ProjectResponse,
  ScanDetailResponse,
  ScanResultResponse,
  WorkspaceResponse,
} from '../../src/http/contract.js';
import { testApp } from '../helpers.js';

let app: FastifyInstance;
beforeEach(async () => {
  app = await testApp();
});
afterEach(async () => {
  await app.close();
});

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- typed view of a JSON body
const json = <T>(response: { json: () => unknown }): T => response.json() as T;

describe('GET /api/health', () => {
  it('reports ok with version and no caching', async () => {
    const response = await app.inject('/api/health');
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(json<HealthResponse>(response)).toMatchObject({ ok: true, status: 'ok', version: expect.any(String) });
  });
});

describe('workspace and projects', () => {
  it('lists the seeded demo workspace', async () => {
    const body = json<WorkspaceResponse>(await app.inject('/api/workspace'));
    expect(body).toEqual({ projects: [{ id: 1, name: 'Orbit Workspace', baseLocale: 'en-US' }], localeCount: 3, latestScan: null });
  });

  it('returns catalogs, live issues and coverage for a project', async () => {
    const body = json<ProjectResponse>(await app.inject('/api/projects/1'));
    expect(body.project).toMatchObject({ id: 1, name: 'Orbit Workspace', baseLocale: 'en-US' });
    expect(body.project.budgets.app_name).toBe(14);
    expect(body.catalogs.map((catalog) => [catalog.locale, catalog.direction])).toEqual([
      ['ar-SA', 'rtl'],
      ['de-DE', 'ltr'],
      ['en-US', 'ltr'],
    ]);
    expect(body.catalogs[0]?.updatedAt).toMatch(/Z$/);
    expect(body.issues).toContainEqual(expect.objectContaining({ locale: 'de-DE', key: 'trial.days_left', code: 'missing_translation' }));
    expect(body.coverage).toEqual({ translated: 23, expected: 24, ratio: 23 / 24 });
    expect(body.latestScan).toBeNull();
  });

  it.each([
    ['/api/projects/999', 404, 'Project not found.'],
    ['/api/projects/abc', 400, 'Invalid request.'],
    ['/api/projects/1/scans/999', 404, 'Scan not found.'],
    ['/api/unknown', 404, 'API route not found.'],
  ])('GET %s → %i', async (url, status, error) => {
    const response = await app.inject(url);
    expect(response.statusCode).toBe(status);
    expect(json<ErrorResponse>(response)).toMatchObject({ error, requestId: expect.any(String) });
  });
});

describe('scans', () => {
  it('records a scan and serves it back sorted by severity', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/projects/1/scan' });
    expect(created.statusCode).toBe(201);
    const scan = json<ScanResultResponse>(created);
    expect(scan).toMatchObject({ scanId: 1, blockerCount: 1, warningCount: 6, infoCount: 3, issueCount: 10 });
    expect(scan.createdAt).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/);

    const detail = json<ScanDetailResponse>(await app.inject('/api/projects/1/scans/1'));
    expect(detail).toMatchObject({ id: 1, issueCount: 10, blockerCount: 1, warningCount: 6, infoCount: 3, coverage: scan.coverage });
    expect(detail.issues).toEqual(scan.issues);
    expect(detail.issues[0]?.severity).toBe('blocker');

    const workspace = json<WorkspaceResponse>(await app.inject('/api/workspace'));
    expect(workspace.latestScan).toMatchObject({ id: 1, issueCount: 10 });
  });

  it('returns 404 when scanning an unknown project', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/projects/42/scan' })).statusCode).toBe(404);
  });

  it('does not leak scans across projects', async () => {
    await app.inject({ method: 'POST', url: '/api/projects/1/scan' });
    const other = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: 'Other', baseLocale: 'en', catalogs: { en: {} } },
    });
    const { id } = json<{ id: number }>(other);
    expect((await app.inject(`/api/projects/${id}/scans/1`)).statusCode).toBe(404);
  });
});

describe('PUT /api/projects/:id/catalogs/:locale', () => {
  it('updates a catalog, rescans and fixes the missing key', async () => {
    const current = json<ProjectResponse>(await app.inject('/api/projects/1'));
    const de = current.catalogs.find((catalog) => catalog.locale === 'de-DE');
    const strings = { ...de?.strings, 'trial.days_left': 'Noch {count} Tage' };
    const response = await app.inject({ method: 'PUT', url: '/api/projects/1/catalogs/de-DE', payload: { strings } });
    expect(response.statusCode).toBe(200);
    const body = json<ScanResultResponse>(response);
    expect(body.scanId).toBe(1);
    expect(body.blockerCount).toBe(0);
    expect(body.issues.some((issue) => issue.locale === 'de-DE' && issue.code === 'missing_translation')).toBe(false);
  });

  it('adds a new RTL locale with the derived direction and accepts nested catalogs', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/projects/1/catalogs/he-IL',
      payload: { strings: { nav: { settings: 'הגדרות' } } },
    });
    expect(response.statusCode).toBe(200);
    const project = json<ProjectResponse>(await app.inject('/api/projects/1'));
    expect(project.catalogs.find((catalog) => catalog.locale === 'he-IL')).toMatchObject({
      direction: 'rtl',
      strings: { nav: { settings: 'הגדרות' } },
    });
    expect(
      json<ScanResultResponse>(response).issues.filter((issue) => issue.locale === 'he-IL' && issue.code === 'missing_translation'),
    ).toHaveLength(11);
  });

  it('flags an explicit direction override that contradicts the locale', async () => {
    const response = await app.inject({ method: 'PUT', url: '/api/projects/1/catalogs/ar-SA', payload: { strings: {}, direction: 'ltr' } });
    expect(json<ScanResultResponse>(response).issues).toContainEqual(
      expect.objectContaining({ locale: 'ar-SA', code: 'direction_mismatch' }),
    );
  });

  it.each([
    ['an invalid locale', '/api/projects/1/catalogs/de_DE', { strings: {} }, 400],
    ['a non-object catalog', '/api/projects/1/catalogs/de-DE', { strings: ['x'] }, 400],
    ['numeric values', '/api/projects/1/catalogs/de-DE', { strings: { a: 1 } }, 400],
    ['oversized strings', '/api/projects/1/catalogs/de-DE', { strings: { a: 'x'.repeat(2001) } }, 400],
    ['a reserved key', '/api/projects/1/catalogs/de-DE', { strings: { constructor: 'x' } }, 400],
    ['a missing body', '/api/projects/1/catalogs/de-DE', undefined, 400],
    ['an unknown project', '/api/projects/9/catalogs/de-DE', { strings: {} }, 404],
  ])('rejects %s', async (_label, url, payload, status) => {
    const response = await app.inject({ method: 'PUT', url, ...(payload === undefined ? {} : { payload }) });
    expect(response.statusCode).toBe(status);
    expect(json<ErrorResponse>(response).error).toEqual(expect.any(String));
  });

  it('rejects malformed JSON and prototype poisoning', async () => {
    const headers = { 'content-type': 'application/json' };
    const bad = await app.inject({ method: 'PUT', url: '/api/projects/1/catalogs/de-DE', headers, payload: '{bad' });
    expect(bad.statusCode).toBe(400);
    expect(json<ErrorResponse>(bad).error).toBe('Request body must be valid JSON.');
    const poisoned = await app.inject({
      method: 'PUT',
      url: '/api/projects/1/catalogs/de-DE',
      headers,
      payload: '{"strings":{"__proto__":{"x":"y"}}}',
    });
    expect(poisoned.statusCode).toBe(400);
  });

  it('enforces the body size limit', async () => {
    const strings = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`k${i}`, 'x'.repeat(1990)]));
    expect((await app.inject({ method: 'PUT', url: '/api/projects/1/catalogs/de-DE', payload: { strings } })).statusCode).toBe(413);
  });

  it('limits the number of catalogs per project', async () => {
    const locales = ['fr', 'es', 'it', 'nl', 'sv', 'da', 'fi', 'nb', 'pl', 'cs', 'sk', 'hu', 'ro', 'el', 'tr', 'ja', 'ko'];
    for (const locale of locales) await app.inject({ method: 'PUT', url: `/api/projects/1/catalogs/${locale}`, payload: { strings: {} } });
    const response = await app.inject({ method: 'PUT', url: '/api/projects/1/catalogs/zh', payload: { strings: {} } });
    expect(response.statusCode).toBe(400);
    expect(json<ErrorResponse>(response).error).toBe('A project can have at most 20 catalogs.');
    // Updating an existing catalog is still allowed at the limit.
    expect((await app.inject({ method: 'PUT', url: '/api/projects/1/catalogs/fr', payload: { strings: {} } })).statusCode).toBe(200);
  });
});

describe('POST /api/projects', () => {
  it('creates a project with catalogs and budgets', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: {
        name: '  Mobile app  ',
        baseLocale: 'en-US',
        catalogs: { 'en-US': { ok: 'OK' }, 'fa-IR': { ok: 'باشه' } },
        budgets: { ok: 2 },
      },
    });
    expect(response.statusCode).toBe(201);
    const { id } = json<{ id: number }>(response);
    const project = json<ProjectResponse>(await app.inject(`/api/projects/${id}`));
    expect(project.project).toEqual({ id, name: 'Mobile app', baseLocale: 'en-US', budgets: { ok: 2 } });
    expect(project.catalogs.find((catalog) => catalog.locale === 'fa-IR')?.direction).toBe('rtl');
    expect(project.issues).toContainEqual(expect.objectContaining({ locale: 'fa-IR', code: 'length_budget' }));
  });

  it.each([
    ['a short name', { name: 'x', baseLocale: 'en', catalogs: { en: {} } }],
    ['a missing base catalog', { name: 'Valid', baseLocale: 'en', catalogs: { de: {} } }],
    ['an invalid catalog locale', { name: 'Valid', baseLocale: 'en', catalogs: { en: {}, 'not a locale': {} } }],
    [
      'too many catalogs',
      {
        name: 'Valid',
        baseLocale: 'en',
        catalogs: Object.fromEntries(
          'abcdefghijklmnopqrstu'
            .split('')
            .map((c) => [`a${c}`, {}])
            .concat([['en', {}]]),
        ),
      },
    ],
    ['invalid budgets', { name: 'Valid', baseLocale: 'en', catalogs: { en: {} }, budgets: { a: -1 } }],
  ])('rejects %s', async (_label, payload) => {
    const response = await app.inject({ method: 'POST', url: '/api/projects', payload });
    expect(response.statusCode).toBe(400);
    expect(json<ErrorResponse>(response).details?.length).toBeGreaterThan(0);
  });
});

describe('PUT /api/projects/:id/budgets', () => {
  it('replaces budgets used by later scans', async () => {
    const response = await app.inject({ method: 'PUT', url: '/api/projects/1/budgets', payload: { budgets: { app_name: 1 } } });
    expect(json(response)).toEqual({ budgets: { app_name: 1 } });
    const scan = json<ScanResultResponse>(await app.inject({ method: 'POST', url: '/api/projects/1/scan' }));
    expect(scan.issues.filter((issue) => issue.code === 'length_budget').map((issue) => issue.key)).toEqual([
      'app_name',
      'app_name',
      'app_name',
    ]);
    expect((await app.inject({ method: 'PUT', url: '/api/projects/7/budgets', payload: { budgets: {} } })).statusCode).toBe(404);
  });
});

describe('cross-cutting HTTP behaviour', () => {
  it('sets a strict CSP and security headers', async () => {
    const response = await app.inject('/');
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    const csp = String(response.headers['content-security-policy']);
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("style-src 'self'");
    expect(csp).not.toContain('unsafe-inline');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['cache-control']).toBe('no-cache');
  });

  it('propagates a safe x-request-id and replaces unsafe ones', async () => {
    const kept = await app.inject({ url: '/api/health', headers: { 'x-request-id': 'abc-123' } });
    expect(kept.headers['x-request-id']).toBe('abc-123');
    const replaced = await app.inject({ url: '/api/health', headers: { 'x-request-id': 'bad id\n' } });
    expect(replaced.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns JSON 404 for unknown static paths', async () => {
    const response = await app.inject('/missing.png');
    expect(response.statusCode).toBe(404);
    expect(json<ErrorResponse>(response).error).toBe('Not found.');
  });
});

describe('rate limiting', () => {
  it('limits write routes but not reads', async () => {
    const limited = await testApp({ rateLimitMax: 2 });
    try {
      const statuses = [];
      for (let i = 0; i < 3; i++) statuses.push((await limited.inject({ method: 'POST', url: '/api/projects/1/scan' })).statusCode);
      expect(statuses).toEqual([201, 201, 429]);
      const last = await limited.inject({ method: 'POST', url: '/api/projects/1/scan' });
      expect(json<ErrorResponse>(last).error).toMatch(/^Too many requests/);
      expect(last.headers['retry-after']).toBeDefined();
      for (let i = 0; i < 5; i++) expect((await limited.inject('/api/workspace')).statusCode).toBe(200);
    } finally {
      await limited.close();
    }
  });
});
