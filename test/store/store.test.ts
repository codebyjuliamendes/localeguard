import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { IN_MEMORY, openDatabase } from '../../src/store/database.js';
import { DEMO_PROJECT, seedDemo } from '../../src/store/demo.js';
import { migrate, MIGRATIONS } from '../../src/store/migrations.js';
import { Repository } from '../../src/store/repository.js';

const dirs: string[] = [];
const tempFile = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'localeguard-'));
  dirs.push(dir);
  return path.join(dir, 'nested', 'db.sqlite');
};
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('migrations', () => {
  it('migrates a fresh database to the latest version and is idempotent', () => {
    const db = openDatabase(IN_MEMORY);
    const latest = MIGRATIONS.at(-1)?.version;
    expect(db.pragma('user_version', { simple: true })).toBe(latest);
    expect(migrate(db)).toBe(latest);
    db.close();
  });

  it('upgrades a database created by the original Express server in place', () => {
    const file = tempFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const legacy = new BetterSqlite3(file);
    MIGRATIONS[0]?.up(legacy);
    legacy.prepare("INSERT INTO projects(name, base_locale, created_at) VALUES ('Old', 'en-US', '2025-01-02 03:04:05')").run();
    legacy.prepare("INSERT INTO catalogs(project_id, locale, direction, strings_json) VALUES (1, 'en-US', 'ltr', '{\"a\":\"A\"}')").run();
    legacy
      .prepare(
        "INSERT INTO scans(project_id, issue_count, blocker_count, warning_count, created_at) VALUES (1, 1, 1, 0, '2025-01-02 03:04:05')",
      )
      .run();
    legacy
      .prepare(
        "INSERT INTO scan_issues(scan_id, locale, key_name, severity, kind, detail) VALUES (1, 'de-DE', 'a', 'blocker', 'Missing translation', 'x')",
      )
      .run();
    legacy.close();

    const db = openDatabase(file);
    const repository = new Repository(db);
    const project = repository.getProject(1);
    expect(project).toMatchObject({ name: 'Old', createdAt: '2025-01-02T03:04:05Z' });
    expect(project?.budgets.app_name).toBe(14);
    const scan = repository.getScan(1, 1);
    expect(scan).toMatchObject({ createdAt: '2025-01-02T03:04:05Z', infoCount: 0, coverage: null });
    expect(scan?.issues[0]).toMatchObject({ code: 'legacy', kind: 'Missing translation' });
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    db.close();
  });
});

describe('repository', () => {
  it('seeds the demo only once', () => {
    const repository = new Repository(openDatabase(IN_MEMORY));
    expect(seedDemo(repository)).toBe(1);
    expect(seedDemo(repository)).toBeNull();
    expect(repository.catalogCount()).toBe(DEMO_PROJECT.catalogs.length);
    expect(repository.catalogCount(1)).toBe(3);
  });

  it('rolls back a scan transaction on failure', () => {
    const db = openDatabase(IN_MEMORY);
    const repository = new Repository(db);
    seedDemo(repository);
    expect(() =>
      repository.transaction(() => {
        repository.saveScan(1, {
          issues: [],
          counts: { blocker: 0, warning: 0, info: 0 },
          coverage: { translated: 0, expected: 0, ratio: 1 },
        });
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(repository.latestScan()).toBeNull();
  });

  it('reports false when updating budgets of a missing project', () => {
    expect(new Repository(openDatabase(IN_MEMORY)).setBudgets(5, {})).toBe(false);
  });
});
