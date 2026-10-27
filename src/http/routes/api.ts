import type { FastifyPluginCallback, RouteShorthandOptions } from 'fastify';
import type { HealthResponse } from '../contract.js';
import {
  CatalogParamsSchema,
  CreateProjectSchema,
  ProjectParamsSchema,
  ScanParamsSchema,
  UpdateBudgetsSchema,
  UpdateCatalogSchema,
} from '../schemas.js';
import type { ProjectService } from '../../services/projects.js';
import type { Repository } from '../../store/repository.js';
import { VERSION } from '../../version.js';

export interface ApiRoutesOptions {
  service: ProjectService;
  repository: Repository;
  rateLimit: { max: number; timeWindow: string };
}

/** JSON API mounted under /api. Write routes are rate limited per client IP. */
export const apiRoutes: FastifyPluginCallback<ApiRoutesOptions> = (app, { service, repository, rateLimit }, done) => {
  const write: RouteShorthandOptions = { config: { rateLimit } };

  // Probed every few seconds by orchestrators; keep it out of info-level logs.
  app.get('/health', { logLevel: 'warn' }, (request, reply) => {
    let healthy = false;
    try {
      healthy = repository.ping();
    } catch (error) {
      request.log.error({ err: error }, 'database health check failed');
    }
    const body: HealthResponse = {
      ok: healthy,
      status: healthy ? 'ok' : 'degraded',
      version: VERSION,
      uptimeSeconds: Math.round(process.uptime()),
    };
    return reply
      .status(healthy ? 200 : 503)
      .header('cache-control', 'no-store')
      .send(body);
  });

  app.get('/workspace', () => service.workspace());

  app.get('/projects/:id', (request) => {
    const { id } = ProjectParamsSchema.parse(request.params);
    return service.project(id);
  });

  app.get('/projects/:id/scans/:scanId', (request) => {
    const { id, scanId } = ScanParamsSchema.parse(request.params);
    return service.getScan(id, scanId);
  });

  app.post('/projects', write, (request, reply) => {
    const body = CreateProjectSchema.parse(request.body);
    return reply.status(201).send(service.createProject(body));
  });

  app.put('/projects/:id/catalogs/:locale', write, (request) => {
    const { id, locale } = CatalogParamsSchema.parse(request.params);
    const { strings, direction } = UpdateCatalogSchema.parse(request.body);
    return service.updateCatalog(id, locale, strings, direction);
  });

  app.put('/projects/:id/budgets', write, (request) => {
    const { id } = ProjectParamsSchema.parse(request.params);
    const { budgets } = UpdateBudgetsSchema.parse(request.body);
    return service.setBudgets(id, budgets);
  });

  app.post('/projects/:id/scan', write, (request, reply) => {
    const { id } = ProjectParamsSchema.parse(request.params);
    return reply.status(201).send(service.scan(id));
  });
  done();
};
