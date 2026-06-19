import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth }        from '@/middleware/auth.middleware';
import { requireFieldAccess } from '@/middleware/rbac.middleware';
import { validate }           from '@/middleware/validate.middleware';
import { successResponse }    from '@/shared/utils/response.util';
import { mapVisualService }   from './map-visual.service';

export const mapVisualRouter = Router();

const h = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction): void => { fn(req, res).catch(next); };

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const MapVisualUploadSchema = z.object({
  filename:     z.string().min(1),
  content_type: z.string().regex(/^image\/(png|jpeg|jpg|webp|tiff|x-tiff|tif)$/),
});

const MapBoundsSchema = z.object({
  bounds: z.array(z.array(z.number())).length(2), // [[lat, lng], [lat, lng]] or similar
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

import fs from 'fs';
import path from 'path';

// POST /fields/:id/map-visual/upload-url
mapVisualRouter.post(
  '/fields/:id/map-visual/upload-url',
  requireAuth,
  requireFieldAccess('manager'),
  validate(MapVisualUploadSchema),
  h(async (req, res) => {
    const result = await mapVisualService.requestUpload(
      req.params['id']!,
      req.body.filename,
      req.body.content_type,
    );
    res.json(successResponse(result));
  }),
);

// PUT /fields/:id/map-visual/local-upload
mapVisualRouter.put(
  '/fields/:id/map-visual/local-upload',
  h(async (req, res) => {
    const fieldId = req.params['id'];
    const filename = (req.query.filename as string) || 'visual.png';

    const uploadDir = path.join(process.cwd(), 'uploads', 'map-visuals', fieldId);
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const filePath = path.join(uploadDir, filename);
    const fileStream = fs.createWriteStream(filePath);

    req.pipe(fileStream);

    await new Promise((resolve, reject) => {
      fileStream.on('finish', () => resolve(true));
      fileStream.on('error', (err) => reject(err));
    });

    res.json({ success: true, message: 'Local upload complete' });
  }),
);

// POST /fields/:id/map-visual/finalize
mapVisualRouter.post(
  '/fields/:id/map-visual/finalize',
  requireAuth,
  requireFieldAccess('manager'),
  h(async (req, res) => {
    const result = await mapVisualService.finalizeUpload(
      req.params['id']!,
      req.body.storage_key,
    );
    res.json(successResponse(result));
  }),
);

// PATCH /fields/:id/map-visual/bounds
mapVisualRouter.patch(
  '/fields/:id/map-visual/bounds',
  requireAuth,
  requireFieldAccess('manager'),
  validate(MapBoundsSchema),
  h(async (req, res) => {
    const result = await mapVisualService.updateBounds(
      req.params['id']!,
      req.body.bounds,
    );
    res.json(successResponse(result));
  }),
);

// DELETE /fields/:id/map-visual
mapVisualRouter.delete(
  '/fields/:id/map-visual',
  requireAuth,
  requireFieldAccess('manager'),
  h(async (req, res) => {
    await mapVisualService.deleteVisual(req.params['id']!);
    res.json(successResponse({ status: 'deleted' }));
  }),
);
