/**
 * HTTP contract shared by the API and the browser client (type-only, no runtime code).
 * Fields marked "added" are additive extensions of the original v1 contract.
 */
import type { CatalogTree, Coverage, Direction, Issue } from '../domain/types.js';

export type { CatalogTree, Coverage, Direction, Issue, Severity } from '../domain/types.js';

export interface ProjectSummary {
  id: number;
  name: string;
  baseLocale: string;
}

export interface ScanSummary {
  id: number;
  issueCount: number;
  blockerCount: number;
  warningCount: number;
  /** added */
  infoCount: number;
  /** added; null for scans recorded before coverage was stored */
  coverage: Coverage | null;
  /** ISO 8601, UTC */
  createdAt: string;
}

export interface WorkspaceResponse {
  projects: ProjectSummary[];
  localeCount: number;
  latestScan: ScanSummary | null;
}

export interface CatalogDto {
  locale: string;
  direction: Direction;
  strings: CatalogTree;
  updatedAt: string;
}

export interface ProjectResponse {
  project: ProjectSummary & { budgets: Record<string, number> };
  catalogs: CatalogDto[];
  /** Live inspection of the current catalogs (not persisted). */
  issues: Issue[];
  /** added */
  coverage: Coverage;
  latestScan: ScanSummary | null;
}

export interface ScanDetailResponse extends ScanSummary {
  issues: Issue[];
}

export interface ScanResultResponse {
  scanId: number;
  issueCount: number;
  blockerCount: number;
  warningCount: number;
  infoCount: number;
  coverage: Coverage;
  createdAt: string;
  issues: Issue[];
}

export interface CreateProjectRequest {
  name: string;
  baseLocale: string;
  catalogs: Record<string, CatalogTree>;
  budgets?: Record<string, number>;
}

export interface UpdateCatalogRequest {
  strings: CatalogTree;
  direction?: Direction;
}

export interface CreateProjectResponse {
  id: number;
}

export interface BudgetsResponse {
  budgets: Record<string, number>;
}

export interface ErrorResponse {
  error: string;
  requestId?: string;
  details?: string[];
}

export interface HealthResponse {
  ok: boolean;
  status: 'ok' | 'degraded';
  version: string;
  uptimeSeconds: number;
}
