import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '@/config';
import { AppError } from '@/middleware/error.middleware';
import type { JwtPayload } from '@/shared/types';

// ---------------------------------------------------------------------------
// requireAuth — verifikasi JWT access token
//
// Attach req.user = { id, role } jika valid.
// Throw AppError jika token tidak ada, expired, atau tidak valid.
// ---------------------------------------------------------------------------
export function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    next(new AppError(401, 'UNAUTHORIZED', 'Token autentikasi diperlukan'));
    return;
  }

  const token = authHeader.slice(7);

  try {
    const payload = jwt.verify(token, config.JWT_SECRET) as JwtPayload;
    req.user = { id: payload.sub, role: payload.role };
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      next(new AppError(401, 'TOKEN_EXPIRED', 'Token sudah kadaluarsa, refresh token diperlukan'));
    } else {
      next(new AppError(401, 'INVALID_TOKEN', 'Token tidak valid'));
    }
  }
}
