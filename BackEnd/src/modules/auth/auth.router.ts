import { Router, Request, Response, NextFunction } from 'express';
import { validate } from '@/middleware/validate.middleware';
import { requireAuth } from '@/middleware/auth.middleware';
import { authService } from './auth.service';
import { LoginSchema, RefreshSchema, UpdateProfileSchema } from './auth.schema';
import { successResponse } from '@/shared/utils/response.util';

export const authRouter = Router();

// ---------------------------------------------------------------------------
// POST /auth/login
// Body: { email, password }
// Response: { access_token, refresh_token, token_type, expires_in }
// ---------------------------------------------------------------------------
authRouter.post(
  '/login',
  validate(LoginSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tokens = await authService.login(req.body, {
        ip:        req.ip,
        userAgent: req.headers['user-agent'],
      });
      res.status(200).json(successResponse(tokens));
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /auth/refresh
// Body: { refresh_token }
// Response: { access_token, token_type, expires_in }
// ---------------------------------------------------------------------------
authRouter.post(
  '/refresh',
  validate(RefreshSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await authService.refresh(req.body.refresh_token as string);
      res.json(successResponse(result));
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /auth/logout
// Body: { refresh_token }
// Response: { message }
// ---------------------------------------------------------------------------
authRouter.post(
  '/logout',
  validate(RefreshSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await authService.logout(req.body.refresh_token as string);
      res.json(successResponse({ message: 'Logout berhasil' }));
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /auth/me
// Header: Authorization: Bearer <access_token>
// Response: user profile (no password hash)
// ---------------------------------------------------------------------------
authRouter.get(
  '/me',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = await authService.getMe(req.user!.id);
      res.json(successResponse(user));
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// PATCH /auth/me
// Header: Authorization: Bearer <access_token>
// Body: { fullName, email, password }
// Response: updated user profile
// ---------------------------------------------------------------------------
authRouter.patch(
  '/me',
  requireAuth,
  validate(UpdateProfileSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = await authService.updateMe(req.user!.id, req.body);
      res.json(successResponse(user));
    } catch (err) {
      next(err);
    }
  },
);
