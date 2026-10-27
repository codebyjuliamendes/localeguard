import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import type { Database } from 'better-sqlite3';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { AppConfig } from '../config.js';
import { HttpError } from '../errors.js';
import { ProjectService } from '../services/projects.js';
import { Repository } from '../store/repository.js';
import { registerErrorHandling } from './errors.js';
import { apiRoutes } from './routes/api.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
/** Hand-written assets (index.html, logo) and the esbuild output (app.js, app.css, fonts). */
export const DEFAULT_STATIC_ROOTS = [`${ROOT}public`, `${ROOT}dist/web`];

const REQUEST_ID = /^[\w.-]{1,64}$/;

export interface BuildAppOptions {
  config: Pick<AppConfig, 'logLevel' | 'trustProxy' | 'bodyLimit' | 'rateLimit' | 'env'>;
  db: Database;
  /** Directories served as static files; missing ones are skipped. */
  staticRoots?: string[];
  logger?: FastifyServerOptions['logger'];
}

export async function buildApp({ config, db, staticRoots = DEFAULT_STATIC_ROOTS, logger }: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: logger ?? {
      level: config.logLevel,
      redact: { paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'], censor: '[redacted]' },
    },
    bodyLimit: config.bodyLimit,
    trustProxy: config.trustProxy,
    // Reuse a well-formed upstream request id (from a proxy) or mint one.
    requestIdHeader: false,
    genReqId: (req) => {
      const header = req.headers['x-request-id'];
      return typeof header === 'string' && REQUEST_ID.test(header) ? header : randomUUID();
    },
  });

  const repository = new Repository(db);
  const service = new ProjectService(repository);

  app.addHook('onRequest', (request, reply, done) => {
    reply.header('x-request-id', request.id);
    done();
  });
  app.addHook('onClose', (_instance, done) => {
    db.close();
    done();
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        fontSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    // TLS is terminated by the reverse proxy; HSTS belongs there.
    strictTransportSecurity: false,
    crossOriginEmbedderPolicy: false,
  });

  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_request, context) => new HttpError(429, `Too many requests; retry in ${context.after}.`),
  });

  registerErrorHandling(app);
  await app.register(apiRoutes, { prefix: '/api', service, repository, rateLimit: config.rateLimit });

  const roots = staticRoots.filter((root) => fs.existsSync(root));
  if (roots.length) {
    await app.register(fastifyStatic, {
      root: roots,
      wildcard: true,
      index: ['index.html'],
      setHeaders: (res, filePath) => {
        // Hashed font files are immutable; everything else revalidates via ETag.
        res.header('cache-control', /-[A-Z0-9]{8}\.woff2?$/.test(filePath) ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
  }

  return app;
}
