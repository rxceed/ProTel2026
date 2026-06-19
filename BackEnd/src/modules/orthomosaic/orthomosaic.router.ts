import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth }        from '@/middleware/auth.middleware';
import { requireFieldAccess } from '@/middleware/rbac.middleware';
import { validate }           from '@/middleware/validate.middleware';
import { successResponse }    from '@/shared/utils/response.util';
import { orthomosaicService } from './orthomosaic.service';

export const orthomosaicRouter = Router();

const h = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction): void => { fn(req, res).catch(next); };

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const UploadRequestSchema = z.object({
  filename:     z.string().min(1),
  content_type: z.string().startsWith('image/'),
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// POST /fields/:fieldId/orthomosaic/upload-url
orthomosaicRouter.post(
  '/fields/:fieldId/orthomosaic/upload-url',
  requireAuth,
  requireFieldAccess('manager'),
  validate(UploadRequestSchema),
  h(async (req, res) => {
    const result = await orthomosaicService.requestUpload(
      req.params['fieldId']!,
      req.body.filename,
      req.body.content_type,
    );
    res.json(successResponse(result));
  }),
);

// POST /orthomosaic/finalize/:uploadId
orthomosaicRouter.post(
  '/orthomosaic/finalize/:uploadId',
  requireAuth,
  h(async (req, res) => {
    const result = await orthomosaicService.finalizeAndConvert(
      req.params['uploadId']!,
      req.user!.id,
    );
    res.json(successResponse(result));
  }),
);

// GET /fields/:fieldId/map-layers
orthomosaicRouter.get(
  '/fields/:fieldId/map-layers',
  requireAuth,
  requireFieldAccess('viewer'),
  h(async (req, res) => {
    const rows = await orthomosaicService.listLayers(req.params['fieldId']!);
    res.json(successResponse(rows));
  }),
);

// POST /map-layers/:id/publish
orthomosaicRouter.post(
  '/map-layers/:id/publish',
  requireAuth,
  h(async (req, res) => {
    await orthomosaicService.publishLayer(req.params['id']!);
    res.json(successResponse({ status: 'published' }));
  }),
);
