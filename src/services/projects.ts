import { inspectCatalogs } from '../domain/inspect.js';
import type { CatalogTree, Direction, InspectionResult } from '../domain/types.js';
import type {
  BudgetsResponse,
  CreateProjectResponse,
  ProjectResponse,
  ScanDetailResponse,
  ScanResultResponse,
  WorkspaceResponse,
} from '../http/contract.js';
import { badRequest, notFound } from '../errors.js';
import { LIMITS } from '../limits.js';
import type { ProjectRecord, Repository } from '../store/repository.js';

/** Application service: orchestrates persistence and the pure inspection domain. */
export class ProjectService {
  constructor(private readonly repository: Repository) {}

  workspace(): WorkspaceResponse {
    return {
      projects: this.repository.listProjects().map(({ id, name, baseLocale }) => ({ id, name, baseLocale })),
      localeCount: this.repository.catalogCount(),
      latestScan: this.repository.latestScan(),
    };
  }

  project(id: number): ProjectResponse {
    const project = this.requireProject(id);
    const catalogs = this.repository.listCatalogs(id);
    const result = this.inspect(project);
    return {
      project: { id: project.id, name: project.name, baseLocale: project.baseLocale, budgets: project.budgets },
      catalogs,
      issues: result.issues,
      coverage: result.coverage,
      latestScan: this.repository.latestScan(id),
    };
  }

  scan(id: number): ScanResultResponse {
    return this.repository.transaction(() => this.recordScan(this.requireProject(id)));
  }

  getScan(id: number, scanId: number): ScanDetailResponse {
    const scan = this.repository.getScan(id, scanId);
    if (!scan) throw notFound('Scan not found.');
    return scan;
  }

  createProject(input: {
    name: string;
    baseLocale: string;
    catalogs: Record<string, CatalogTree>;
    budgets?: Record<string, number> | undefined;
  }): CreateProjectResponse {
    const id = this.repository.createProject({
      name: input.name,
      baseLocale: input.baseLocale,
      budgets: input.budgets,
      catalogs: Object.entries(input.catalogs).map(([locale, strings]) => ({ locale, strings })),
    });
    return { id };
  }

  updateCatalog(id: number, locale: string, strings: CatalogTree, direction?: Direction): ScanResultResponse {
    return this.repository.transaction(() => {
      const project = this.requireProject(id);
      const exists = this.repository.listCatalogs(id).some((catalog) => catalog.locale === locale);
      if (!exists && this.repository.catalogCount(id) >= LIMITS.catalogsPerProject) {
        throw badRequest(`A project can have at most ${LIMITS.catalogsPerProject} catalogs.`);
      }
      this.repository.upsertCatalog(id, { locale, strings, direction });
      return this.recordScan(project);
    });
  }

  setBudgets(id: number, budgets: Record<string, number>): BudgetsResponse {
    if (!this.repository.setBudgets(id, budgets)) throw notFound('Project not found.');
    return { budgets };
  }

  private requireProject(id: number): ProjectRecord {
    const project = this.repository.getProject(id);
    if (!project) throw notFound('Project not found.');
    return project;
  }

  private inspect(project: ProjectRecord): InspectionResult {
    const catalogs = this.repository.listCatalogs(project.id);
    return inspectCatalogs(
      project.baseLocale,
      catalogs.map(({ locale, strings, direction }) => ({ locale, strings, direction })),
      { budgets: project.budgets },
    );
  }

  private recordScan(project: ProjectRecord): ScanResultResponse {
    const result = this.inspect(project);
    const scan = this.repository.saveScan(project.id, result);
    return {
      scanId: scan.id,
      issueCount: scan.issueCount,
      blockerCount: scan.blockerCount,
      warningCount: scan.warningCount,
      infoCount: scan.infoCount,
      coverage: result.coverage,
      createdAt: scan.createdAt,
      issues: result.issues,
    };
  }
}
