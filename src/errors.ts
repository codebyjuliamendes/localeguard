/** Application errors carrying an HTTP status; thrown by services, mapped by the HTTP layer. */
export class HttpError extends Error {
  override readonly name = 'HttpError';
  constructor(
    readonly statusCode: number,
    message: string,
    readonly details?: string[],
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: string[]): HttpError => new HttpError(400, message, details);
export const notFound = (message: string): HttpError => new HttpError(404, message);
