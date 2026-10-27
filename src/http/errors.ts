import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import type { ErrorResponse } from './contract.js';
import { HttpError } from '../errors.js';

export function zodDetails(error: ZodError): string[] {
  return error.issues.map((issue) => (issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message));
}

const isFastifyError = (error: unknown): error is FastifyError =>
  error instanceof Error && typeof (error as Partial<FastifyError>).statusCode === 'number';

/** Maps every failure to `{ error, requestId }`; 5xx details are logged, never returned. */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler<Error>((error, request, reply) => {
    let status = 500;
    const body: ErrorResponse = { error: 'Internal server error.', requestId: request.id };
    if (error instanceof HttpError) {
      status = error.statusCode;
      body.error = error.message;
      if (error.details?.length) body.details = error.details;
    } else if (error instanceof ZodError) {
      status = 400;
      body.error = 'Invalid request.';
      body.details = zodDetails(error);
    } else if (isFastifyError(error) && error.statusCode !== undefined && error.statusCode >= 400 && error.statusCode < 500) {
      status = error.statusCode;
      body.error =
        error.code === 'FST_ERR_CTP_INVALID_JSON_BODY' || error.code === 'FST_ERR_CTP_EMPTY_JSON_BODY'
          ? 'Request body must be valid JSON.'
          : error.message;
    }
    if (status >= 500) request.log.error({ err: error }, 'request failed');
    else request.log.info({ statusCode: status, reason: body.error }, 'request rejected');
    return reply.status(status).send(body);
  });

  app.setNotFoundHandler((request, reply) => {
    const isApi = request.url === '/api' || request.url.startsWith('/api/');
    const body: ErrorResponse = { error: isApi ? 'API route not found.' : 'Not found.', requestId: request.id };
    return reply.status(404).send(body);
  });
}
