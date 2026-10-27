import type { Database } from 'better-sqlite3';

/** Budgets the original server applied to every project; legacy projects keep them after upgrading. */
const LEGACY_GLOBAL_BUDGETS = JSON.stringify({
  app_name: 14,
  'dashboard.title': 24,
  'dashboard.welcome': 36,
  'nav.settings': 18,
  'nav.billing': 18,
  'button.start_trial': 20,
  'button.save_changes': 22,
  'table.empty': 30,
  'trial.days_left': 28,
  'billing.renewal': 40,
  'notice.export': 18,
  'notice.delete': 20,
});

export interface Migration {
  version: number;
  name: string;
  up: (db: Database) => void;
}

/**
 * Append-only list; never edit a released migration. Version 1 matches the schema created by the
 * original Express server (IF NOT EXISTS), so existing databases upgrade in place.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'initial schema',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS projects(
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          base_locale TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS catalogs(
          id INTEGER PRIMARY KEY,
          project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          locale TEXT NOT NULL,
          direction TEXT NOT NULL CHECK(direction IN ('ltr','rtl')),
          strings_json TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(project_id, locale)
        );
        CREATE TABLE IF NOT EXISTS scans(
          id INTEGER PRIMARY KEY,
          project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          issue_count INTEGER NOT NULL,
          blocker_count INTEGER NOT NULL,
          warning_count INTEGER NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS scan_issues(
          id INTEGER PRIMARY KEY,
          scan_id INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
          locale TEXT NOT NULL,
          key_name TEXT NOT NULL,
          severity TEXT NOT NULL,
          kind TEXT NOT NULL,
          detail TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 2,
    name: 'issue codes, info severity, coverage, budgets, ISO timestamps',
    up: (db) => {
      db.exec(`
        ALTER TABLE projects ADD COLUMN budgets_json TEXT NOT NULL DEFAULT '{}';
        ALTER TABLE scans ADD COLUMN info_count INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE scans ADD COLUMN translated_count INTEGER;
        ALTER TABLE scans ADD COLUMN expected_count INTEGER;
        ALTER TABLE scan_issues ADD COLUMN code TEXT;
        CREATE INDEX IF NOT EXISTS idx_scans_project ON scans(project_id, id DESC);
        CREATE INDEX IF NOT EXISTS idx_scan_issues_scan ON scan_issues(scan_id);
        -- SQLite CURRENT_TIMESTAMP is UTC without a zone; browsers parse it as local time.
        UPDATE projects SET created_at = replace(created_at, ' ', 'T') || 'Z' WHERE created_at NOT LIKE '%Z';
        UPDATE catalogs SET updated_at = replace(updated_at, ' ', 'T') || 'Z' WHERE updated_at NOT LIKE '%Z';
        UPDATE scans SET created_at = replace(created_at, ' ', 'T') || 'Z' WHERE created_at NOT LIKE '%Z';
      `);
      db.prepare('UPDATE projects SET budgets_json = ?').run(LEGACY_GLOBAL_BUDGETS);
    },
  },
];

/** Applies pending migrations inside one transaction each, tracked with PRAGMA user_version. */
export function migrate(db: Database, migrations: readonly Migration[] = MIGRATIONS): number {
  const current = Number(db.pragma('user_version', { simple: true }));
  let version = current;
  for (const migration of migrations) {
    if (migration.version <= current) continue;
    db.transaction(() => {
      migration.up(db);
      db.pragma(`user_version = ${migration.version}`);
    })();
    version = migration.version;
  }
  return version;
}
