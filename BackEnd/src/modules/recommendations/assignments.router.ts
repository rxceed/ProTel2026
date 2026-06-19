import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth }        from '@/middleware/auth.middleware';
import { validate }           from '@/middleware/validate.middleware';
import { successResponse }    from '@/shared/utils/response.util';
import { db }                 from '@/db/client';
import { desc, eq, and, ne } from 'drizzle-orm';
import { z }                  from 'zod';
import {
  irrigationRecommendations as recsTable,
  fields as fieldsTable,
  subBlocks as sbTable,
} from '@/db/schema';
import { AppError } from '@/middleware/error.middleware';

export const assignmentsRouter = Router();

const h = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction): void => { fn(req, res).catch(next); };

// ---------------------------------------------------------------------------
// GET /assignments/pending
// Mengembalikan semua rekomendasi berstatus pending di seluruh lahan
// (diakses oleh operator untuk melihat tugas yang harus dikerjakan)
// ---------------------------------------------------------------------------
assignmentsRouter.get(
  '/pending',
  requireAuth,
  h(async (_req, res) => {
    const rows = await db.execute(`
      SELECT
        r.id,
        r.field_id,
        r.sub_block_id,
        r.recommendation_type,
        r.priority_rank,
        r.priority_score,
        r.command_template_code,
        r.command_text,
        r.reason_summary,
        r.confidence_level,
        r.water_level_cm_at_decision,
        r.valid_until,
        r.generated_at,
        r.feedback_status,
        f.name  AS field_name,
        sb.name AS sub_block_name,
        sb.code AS sub_block_code
      FROM trx.irrigation_recommendations r
      JOIN mst.fields    f  ON f.id  = r.field_id
      JOIN mst.sub_blocks sb ON sb.id = r.sub_block_id
      WHERE r.feedback_status = 'pending'
        AND r.valid_until > NOW()
      ORDER BY r.priority_score DESC, r.priority_rank ASC
    `);
    res.json(successResponse(rows.rows));
  }),
);

// ---------------------------------------------------------------------------
// GET /assignments/completed
// Rekomendasi yang sudah dieksekusi/dilewati (riwayat tindakan lapangan)
// ---------------------------------------------------------------------------
assignmentsRouter.get(
  '/completed',
  requireAuth,
  h(async (_req, res) => {
    const rows = await db.execute(`
      SELECT
        r.id,
        r.field_id,
        r.sub_block_id,
        r.recommendation_type,
        r.command_text,
        r.reason_summary,
        r.confidence_level,
        r.feedback_status,
        r.operator_notes,
        r.feedback_at,
        r.water_level_cm_at_decision,
        f.name  AS field_name,
        sb.name AS sub_block_name,
        sb.code AS sub_block_code
      FROM trx.irrigation_recommendations r
      JOIN mst.fields    f  ON f.id  = r.field_id
      JOIN mst.sub_blocks sb ON sb.id = r.sub_block_id
      WHERE r.feedback_status IN ('executed', 'skipped', 'deferred', 'acknowledged')
      ORDER BY r.feedback_at DESC NULLS LAST
      LIMIT 50
    `);
    res.json(successResponse(rows.rows));
  }),
);

// ---------------------------------------------------------------------------
// POST /assignments/:id/action
// Operator menandai tugas: executed / skipped / deferred
// ---------------------------------------------------------------------------
const ActionSchema = z.object({
  action:         z.enum(['executed', 'skipped', 'deferred']),
  operator_notes: z.string().max(1000).optional(),
});

assignmentsRouter.post(
  '/:id/action',
  requireAuth,
  validate(ActionSchema),
  h(async (req, res) => {
    const { id } = req.params;
    const { action, operator_notes } = req.body as z.infer<typeof ActionSchema>;

    const [rec] = await db
      .select({ id: recsTable.id, feedbackStatus: recsTable.feedbackStatus })
      .from(recsTable)
      .where(eq(recsTable.id, id!))
      .limit(1);

    if (!rec) throw new AppError(404, 'REC_NOT_FOUND', 'Tugas rekomendasi tidak ditemukan');
    if (rec.feedbackStatus !== 'pending') {
      throw new AppError(400, 'ALREADY_ACTIONED', 'Tugas ini sudah direspons sebelumnya');
    }

    const [updated] = await db
      .update(recsTable)
      .set({
        feedbackStatus:  action,
        operatorNotes:   operator_notes,
        feedbackBy:      req.user!.id,
        feedbackAt:      new Date(),
        hasFeedback:     true,
        lastFeedbackAt:  new Date(),
      })
      .where(eq(recsTable.id, id!))
      .returning();

    res.json(successResponse(updated));
  }),
);
