import type { Database, Statement } from 'better-sqlite3';
import type { CatalogInput, CatalogTree, Coverage, Direction, Issue, IssueCode, Severity } from '../domain/types.js';
import { expectedDirection } from '../domain/locale.js';
import type { ScanSummary } from '../http/contract.js';

export interface ProjectRecord {
  id: number;
  name: string;
  baseLocale: string;
  budgets: Record<string, number>;
  createdAt: string;
}

export interface CatalogRecord {
  locale: string;
  direction: Direction;
  strings: CatalogTree;
  updatedAt: string;
}

export interface ScanInput {
  issues: readonly Issue[];
  counts: Record<Severity, number>;
  coverage: Coverage;
}

interface ProjectRow {
  id: number;
  name: string;
  base_locale: string;
  budgets_json: string;
  created_at: string;
}
interface CatalogRow {
  locale: string;
  direction: Direction;
  strings_json: string;
  updated_at: string;
}
interface ScanRow {
  id: number;
  issue_count: number;
  blocker_count: number;
  warning_count: number;
  info_count: number;
  translated_count: number | null;
  expected_count: number | null;
  created_at: string;
}
interface IssueRow {
  locale: string;
  key: string;
  severity: Severity;
  code: IssueCode | null;
  kind: string;
  detail: string;
}

const now = (): string => new Date().toISOString();

const toScanSummary = (row: ScanRow): ScanSummary => ({
  id: row.id,
  issueCount: row.issue_count,
  blockerCount: row.blocker_count,
  warningCount: row.warning_count,
  infoCount: row.info_count,
  coverage:
    row.translated_count === null || row.expected_count === null
      ? null
      : {
          translated: row.translated_count,
          expected: row.expected_count,
          ratio: row.expected_count ? row.translated_count / row.expected_count : 1,
        },
  createdAt: row.created_at,
});

const toProject = (row: ProjectRow): ProjectRecord => ({
  id: row.id,
  name: row.name,
  baseLocale: row.base_locale,
  budgets: JSON.parse(row.budgets_json) as Record<string, number>,
  createdAt: row.created_at,
});

/** Synchronous SQLite repository; every multi-statement write runs in a transaction. */
export class Repository {
  private readonly statements: {
    listProjects: Statement<[], ProjectRow>;
    getProject: Statement<[number], ProjectRow>;
    countProjects: Statement<[], { n: number }>;
    countCatalogs: Statement<[], { n: number }>;
    countProjectCatalogs: Statement<[number], { n: number }>;
    listCatalogs: Statement<[number], CatalogRow>;
    insertProject: Statement<[string, string, string, string]>;
    upsertCatalog: Statement<[number, string, Direction, string, string]>;
    updateBudgets: Statement<[string, number]>;
    insertScan: Statement<[number, number, number, number, number, number, number, string]>;
    insertIssue: Statement<[number | bigint, string, string, Severity, string, string, string]>;
    latestScan: Statement<[], ScanRow>;
    latestProjectScan: Statement<[number], ScanRow>;
    getScan: Statement<[number, number], ScanRow>;
    listIssues: Statement<[number], IssueRow>;
  };

  constructor(private readonly db: Database) {
    const scanColumns = 'id, issue_count, blocker_count, warning_count, info_count, translated_count, expected_count, created_at';
    this.statements = {
      listProjects: db.prepare('SELECT * FROM projects ORDER BY id'),
      getProject: db.prepare('SELECT * FROM projects WHERE id = ?'),
      countProjects: db.prepare('SELECT COUNT(*) AS n FROM projects'),
      countCatalogs: db.prepare('SELECT COUNT(*) AS n FROM catalogs'),
      countProjectCatalogs: db.prepare('SELECT COUNT(*) AS n FROM catalogs WHERE project_id = ?'),
      listCatalogs: db.prepare('SELECT locale, direction, strings_json, updated_at FROM catalogs WHERE project_id = ? ORDER BY locale'),
      insertProject: db.prepare('INSERT INTO projects(name, base_locale, budgets_json, created_at) VALUES (?, ?, ?, ?)'),
      upsertCatalog: db.prepare(
        `INSERT INTO catalogs(project_id, locale, direction, strings_json, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(project_id, locale) DO UPDATE SET direction = excluded.direction, strings_json = excluded.strings_json, updated_at = excluded.updated_at`,
      ),
      updateBudgets: db.prepare('UPDATE projects SET budgets_json = ? WHERE id = ?'),
      insertScan: db.prepare(
        `INSERT INTO scans(project_id, issue_count, blocker_count, warning_count, info_count, translated_count, expected_count, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ),
      insertIssue: db.prepare(
        'INSERT INTO scan_issues(scan_id, locale, key_name, severity, code, kind, detail) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ),
      latestScan: db.prepare(`SELECT ${scanColumns} FROM scans ORDER BY id DESC LIMIT 1`),
      latestProjectScan: db.prepare(`SELECT ${scanColumns} FROM scans WHERE project_id = ? ORDER BY id DESC LIMIT 1`),
      getScan: db.prepare(`SELECT ${scanColumns} FROM scans WHERE id = ? AND project_id = ?`),
      listIssues: db.prepare(
        `SELECT locale, key_name AS key, severity, code, kind, detail FROM scan_issues WHERE scan_id = ?
         ORDER BY CASE severity WHEN 'blocker' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, locale, key_name, id`,
      ),
    };
  }

  ping(): boolean {
    return this.db.prepare('SELECT 1 AS ok').get() !== undefined;
  }

  listProjects(): ProjectRecord[] {
    return this.statements.listProjects.all().map(toProject);
  }

  getProject(id: number): ProjectRecord | undefined {
    const row = this.statements.getProject.get(id);
    return row ? toProject(row) : undefined;
  }

  projectCount(): number {
    return this.statements.countProjects.get()?.n ?? 0;
  }

  catalogCount(projectId?: number): number {
    const row = projectId === undefined ? this.statements.countCatalogs.get() : this.statements.countProjectCatalogs.get(projectId);
    return row?.n ?? 0;
  }

  listCatalogs(projectId: number): CatalogRecord[] {
    return this.statements.listCatalogs.all(projectId).map((row) => ({
      locale: row.locale,
      direction: row.direction,
      strings: JSON.parse(row.strings_json) as CatalogTree,
      updatedAt: row.updated_at,
    }));
  }

  createProject(input: {
    name: string;
    baseLocale: string;
    catalogs: readonly CatalogInput[];
    budgets?: Record<string, number> | undefined;
  }): number {
    return this.db.transaction(() => {
      const timestamp = now();
      const { lastInsertRowid } = this.statements.insertProject.run(
        input.name,
        input.baseLocale,
        JSON.stringify(input.budgets ?? {}),
        timestamp,
      );
      const id = Number(lastInsertRowid);
      for (const catalog of input.catalogs) {
        const direction = catalog.direction ?? expectedDirection(catalog.locale);
        this.statements.upsertCatalog.run(id, catalog.locale, direction, JSON.stringify(catalog.strings), timestamp);
      }
      return id;
    })();
  }

  upsertCatalog(projectId: number, catalog: CatalogInput): void {
    const direction = catalog.direction ?? expectedDirection(catalog.locale);
    this.statements.upsertCatalog.run(projectId, catalog.locale, direction, JSON.stringify(catalog.strings), now());
  }

  /** Returns false when the project does not exist. */
  setBudgets(projectId: number, budgets: Record<string, number>): boolean {
    return this.statements.updateBudgets.run(JSON.stringify(budgets), projectId).changes > 0;
  }

  saveScan(projectId: number, scan: ScanInput): ScanSummary & { id: number } {
    return this.db.transaction(() => {
      const createdAt = now();
      const { counts, coverage, issues } = scan;
      const { lastInsertRowid } = this.statements.insertScan.run(
        projectId,
        issues.length,
        counts.blocker,
        counts.warning,
        counts.info,
        coverage.translated,
        coverage.expected,
        createdAt,
      );
      for (const issue of issues) {
        this.statements.insertIssue.run(lastInsertRowid, issue.locale, issue.key, issue.severity, issue.code, issue.kind, issue.detail);
      }
      return {
        id: Number(lastInsertRowid),
        issueCount: issues.length,
        blockerCount: counts.blocker,
        warningCount: counts.warning,
        infoCount: counts.info,
        coverage,
        createdAt,
      };
    })();
  }

  /** Runs `fn` atomically; used to keep "write catalog + record scan" consistent. */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  latestScan(projectId?: number): ScanSummary | null {
    const row = projectId === undefined ? this.statements.latestScan.get() : this.statements.latestProjectScan.get(projectId);
    return row ? toScanSummary(row) : null;
  }

  getScan(projectId: number, scanId: number): (ScanSummary & { issues: Issue[] }) | undefined {
    const row = this.statements.getScan.get(scanId, projectId);
    if (!row) return undefined;
    const issues = this.statements.listIssues.all(row.id).map((issue): Issue => ({
      locale: issue.locale,
      key: issue.key,
      severity: issue.severity,
      // Scans recorded before v2 have no code; keep them readable.
      code: issue.code ?? 'legacy',
      kind: issue.kind,
      detail: issue.detail,
    }));
    return { ...toScanSummary(row), issues };
  }
}
