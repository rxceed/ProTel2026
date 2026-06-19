import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth }        from '@/middleware/auth.middleware';
import { requireFieldAccess } from '@/middleware/rbac.middleware';
import { validate }           from '@/middleware/validate.middleware';
import { successResponse }    from '@/shared/utils/response.util';
import {
  getFieldRecommendations,
  getFieldRecommendationHistory,
  getSubBlockRecommendations,
  submitFeedback,
  FeedbackSchema,
  getFieldAlerts,
  acknowledgeAlert,
} from './recommendations.service';

export const recommendationsRouter = Router();

const h = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction): void => { fn(req, res).catch(next); };

// ---------------------------------------------------------------------------
// Recommendations
// ---------------------------------------------------------------------------

// GET /fields/:fieldId/recommendations — latest cycle recs for field
recommendationsRouter.get(
  '/fields/:fieldId/recommendations',
  requireAuth,
  requireFieldAccess('viewer'),
  h(async (req, res) => {
    const result = await getFieldRecommendations(
      req.params['fieldId']!,
      req.query as Record<string, unknown>,
    );
    res.json(successResponse(result.rows, {
      ...result.meta,
      latestJobId:       result.latestJobId,
      latestEvaluatedAt: result.latestEvaluatedAt,
    }));
  }),
);

// GET /fields/:fieldId/recommendations/history — historical recommendations
recommendationsRouter.get(
  '/fields/:fieldId/recommendations/history',
  requireAuth,
  requireFieldAccess('viewer'),
  h(async (req, res) => {
    const result = await getFieldRecommendationHistory(
      req.params['fieldId']!,
      req.query as Record<string, unknown>,
    );
    res.json(successResponse(result.rows, result.meta));
  }),
);

// GET /sub-blocks/:id/recommendations — per sub-block
recommendationsRouter.get(
  '/sub-blocks/:id/recommendations',
  requireAuth,
  h(async (req, res) => {
    const rows = await getSubBlockRecommendations(req.params['id']!);
    res.json(successResponse(rows));
  }),
);

// POST /recommendations/:id/feedback — operator executes / skips recommendation
recommendationsRouter.post(
  '/recommendations/:id/feedback',
  requireAuth,
  validate(FeedbackSchema),
  h(async (req, res) => {
    const updated = await submitFeedback(req.params['id']!, req.user!.id, req.body);
    res.json(successResponse(updated));
  }),
);

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

// GET /fields/:fieldId/alerts
recommendationsRouter.get(
  '/fields/:fieldId/alerts',
  requireAuth,
  requireFieldAccess('viewer'),
  h(async (req, res) => {
    const result = await getFieldAlerts(
      req.params['fieldId']!,
      req.query as Record<string, unknown>,
    );
    res.json(successResponse(result.rows, result.meta));
  }),
);

// POST /alerts/:id/acknowledge
recommendationsRouter.post(
  '/alerts/:id/acknowledge',
  requireAuth,
  h(async (req, res) => {
    const alert = await acknowledgeAlert(req.params['id']!, req.user!.id);
    res.json(successResponse(alert));
  }),
);
