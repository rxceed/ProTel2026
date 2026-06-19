import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';

// ---------------------------------------------------------------------------
// Generic request validation middleware factory
// Passes ZodError to errorMiddleware on failure (handled as 422)
// ---------------------------------------------------------------------------

type RequestSource = 'body' | 'query' | 'params';

export function validate<T>(
  schema: ZodSchema<T>,
  source: RequestSource = 'body',
) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      // ZodError → errorMiddleware → 422 Unprocessable Entity
      next(result.error);
      return;
    }

    // Replace with parsed + coerced data (e.g. trimmed strings, defaults)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any)[source] = result.data;
    next();
  };
}
