import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '@/middleware/auth.middleware';
import { successResponse } from '@/shared/utils/response.util';
import { dashboardService } from './dashboard.service';

export const dashboardRouter = Router();

// Alias handlers untuk mengurangi boilerplate
const h = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };

// ===========================================================================
// GET /dashboard/summary
// ===========================================================================
dashboardRouter.get(
  '/summary',
  requireAuth,
  h(async (req, res) => {
    // Determine if the user is a system_admin to return all data or scoped data
    const isSystemAdmin = req.user!.role === 'system_admin';
    const summary = await dashboardService.getSummary(req.user!.id, isSystemAdmin);
    
    res.json(successResponse(summary));
  }),
);
