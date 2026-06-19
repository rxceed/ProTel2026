import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '@/shared/utils/logger.util';
import { errorResponse } from '@/shared/utils/response.util';

// ---------------------------------------------------------------------------
// AppError — custom error class untuk business logic errors
// Contoh: throw new AppError(404, 'FIELD_NOT_FOUND', 'Field tidak ditemukan')
// ---------------------------------------------------------------------------
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
    // Ensure stack trace is captured properly
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }
}

// ---------------------------------------------------------------------------
// Global error handler middleware
// Harus terdaftar PALING AKHIR di app.ts setelah semua routes
// ---------------------------------------------------------------------------
export function errorMiddleware(
  err: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  // Zod validation errors (422 Unprocessable Entity)
  if (err instanceof ZodError) {
    res.status(422).json(
      errorResponse(
        'VALIDATION_ERROR',
        'Input tidak valid',
        err.flatten().fieldErrors,
      ),
    );
    return;
  }

  // Known business logic errors
  if (err instanceof AppError) {
    res.status(err.statusCode).json(errorResponse(err.code, err.message));
    return;
  }

  // Unknown / unexpected errors
  logger.error(
    { err, method: req.method, path: req.path, ip: req.ip },
    'Unhandled server error',
  );
  res.status(500).json(
    errorResponse('INTERNAL_SERVER_ERROR', 'Terjadi kesalahan pada server'),
  );
}
