import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '@/middleware/auth.middleware';
import { requireSystemRole } from '@/middleware/rbac.middleware';
import { systemSettingsService } from './system-settings.service';
import { successResponse } from '@/shared/utils/response.util';

export const systemSettingsRouter = Router();

const h = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };

// GET /system-settings
systemSettingsRouter.get(
  '/',
  requireAuth,
  h(async (req, res) => {
    const settings = await systemSettingsService.getSettings();
    
    // Mask sensitive credentials for non-admins
    if (req.user!.role !== 'system_admin') {
      if (settings.cloudflareApiKey) settings.cloudflareApiKey = '********';
      if (settings.cloudflareApiUrl) settings.cloudflareApiUrl = '********';
    }
    
    res.json(successResponse(settings));
  })
);

// PATCH /system-settings
systemSettingsRouter.patch(
  '/',
  requireAuth,
  requireSystemRole('system_admin'),
  h(async (req, res) => {
    const settings = await systemSettingsService.updateSettings(req.body);
    res.json(successResponse(settings));
  })
);
