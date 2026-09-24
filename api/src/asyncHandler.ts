import type { NextFunction, Request, RequestHandler, Response } from 'express';

// Express 4 does not catch a rejected promise returned from an async route
// handler — an unawaited rejection (e.g. a thrown error from the scrypt-based
// crypto layer in POST /auth/login) becomes an unhandled rejection instead of
// reaching Express's error-handling middleware, which at best hangs the
// request open and at worst crashes the process. Wrapping every async
// handler in this forwards any rejection to `next(err)`, where the global
// error handler (see app.ts) turns it into a safe generic 500.
export function asyncHandler<Req extends Request = Request, Res extends Response = Response>(
  fn: (req: Req, res: Res, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req as Req, res as Res, next)).catch(next);
  };
}
