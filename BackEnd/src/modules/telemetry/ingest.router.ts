import { Router, Request, Response, NextFunction } from 'express';
import { validate }            from '@/middleware/validate.middleware';
import { requireAuth }         from '@/middleware/auth.middleware';
import { requireFieldAccess }  from '@/middleware/rbac.middleware';
import { successResponse }     from '@/shared/utils/response.util';
import { BatchPayloadSchema }  from './ingest.schema';
import { processBatch }        from './ingest.service';
import { buildFieldStates }    from '@/modules/state-builder/state-builder.service';

export const ingestRouter = Router();

const h = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction): void => { fn(req, res).catch(next); };

// ---------------------------------------------------------------------------
// POST /ingest/batch
//
// Endpoint menerima batch reading dari IoT gateway.
// Tidak ada JWT auth (gateway pakai mTLS atau private network).
// Field ID dalam payload wajib valid (validasi dilakukan oleh DB foreign key).
//
// Response: batch summary (batchId, processed, failed, skipped)
// ---------------------------------------------------------------------------
ingestRouter.post(
  '/batch',
  validate(BatchPayloadSchema),
  h(async (req, res) => {
    const result = await processBatch(req.body);

    // Trigger state builder async — tidak block response
    setImmediate(() => {
      buildFieldStates(req.body.field_id as string).catch(() => null);
    });

    res.status(202).json(successResponse(result));
  }),
);

// ---------------------------------------------------------------------------
// POST /ingest/trigger-state-build  (manual trigger untuk testing)
// ---------------------------------------------------------------------------
ingestRouter.post(
  '/trigger-state-build',
  requireAuth,
  requireFieldAccess('operator'),
  h(async (req, res) => {
    const fieldId = req.params['fieldId'] ?? req.body.field_id as string;
    const count = await buildFieldStates(fieldId);
    res.json(successResponse({ updated: count }));
  }),
);
