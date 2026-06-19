import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth }        from '@/middleware/auth.middleware';
import { requireFieldAccess } from '@/middleware/rbac.middleware';
import { successResponse }    from '@/shared/utils/response.util';
import { archiveService }     from './archive.service';

export const archiveRouter = Router();

const h = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction): void => { fn(req, res).catch(next); };

// POST /crop-cycles/:id/complete
archiveRouter.post(
  '/crop-cycles/:id/complete',
  requireAuth,
  h(async (req, res) => {
    const result = await archiveService.archiveCycle(req.params['id']!, req.user!.id);
    res.json(successResponse(result));
  }),
);

// GET /fields/:fieldId/archives
archiveRouter.get(
  '/fields/:fieldId/archives',
  requireAuth,
  requireFieldAccess('viewer'),
  h(async (req, res) => {
    const rows = await archiveService.listArchives(req.params['fieldId']!);
    res.json(successResponse(rows));
  }),
);
