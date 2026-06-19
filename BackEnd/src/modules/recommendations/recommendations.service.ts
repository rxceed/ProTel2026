import { eq, and, sql, desc, ne } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import {
  irrigationRecommendations as recsTable,
  decisionJobs as jobsTable,
  telemetryAlerts as alertsTable,
} from '@/db/schema';
import { AppError } from '@/middleware/error.middleware';
import { parsePagination, buildPaginationMeta } from '@/shared/utils/pagination.util';

// ---------------------------------------------------------------------------
// Recommendations
// ---------------------------------------------------------------------------

/** Latest active recommendations per field (latest decision cycle) */
export async function getFieldRecommendations(
  fieldId: string,
  query:   Record<string, unknown>,
) {
  const { page, limit, offset } = parsePagination(query);
  const now = new Date();

  // Get latest completed job for field
  const [latestJob] = await db
    .select({ id: jobsTable.id, completedAt: jobsTable.completedAt })
    .from(jobsTable)
    .where(and(eq(jobsTable.fieldId, fieldId), eq(jobsTable.status, 'completed')))
    .orderBy(desc(jobsTable.completedAt))
    .limit(1);

  if (!latestJob) return { rows: [], meta: buildPaginationMeta({ page, limit, offset }, 0), latestJobId: null };

  const rows = await db
    .select()
    .from(recsTable)
    .where(and(
      eq(recsTable.decisionJobId, latestJob.id),
      eq(recsTable.feedbackStatus, 'pending'),
    ))
    .orderBy(recsTable.priorityRank)
    .limit(limit)
    .offset(offset);

  return {
    rows,
    meta: buildPaginationMeta({ page, limit, offset }, rows.length),
    latestJobId:       latestJob.id,
    latestEvaluatedAt: latestJob.completedAt,
  };
}

/** Historical recommendations per field (executed, skipped, deferred) */
export async function getFieldRecommendationHistory(
  fieldId: string,
  query:   Record<string, unknown>,
) {
  const { page, limit, offset } = parsePagination(query);

  const [rows, [{ value: total }]] = await Promise.all([
    db
      .select({
        id: recsTable.id,
        decisionJobId: recsTable.decisionJobId,
        subBlockId: recsTable.subBlockId,
        recommendationType: recsTable.recommendationType,
        commandText: recsTable.commandText,
        reasonSummary: recsTable.reasonSummary,
        confidenceLevel: recsTable.confidenceLevel,
        feedbackStatus: recsTable.feedbackStatus,
        operatorNotes: recsTable.operatorNotes,
        feedbackAt: recsTable.feedbackAt,
        createdAt: recsTable.createdAt,
      })
      .from(recsTable)
      .leftJoin(jobsTable, eq(recsTable.decisionJobId, jobsTable.id))
      .where(and(
        eq(recsTable.fieldId, fieldId),
        ne(recsTable.feedbackStatus, 'pending')
      ))
      .orderBy(desc(recsTable.feedbackAt), desc(recsTable.createdAt))
      .limit(limit)
      .offset(offset),
      
    db
      .select({ value: sql<number>`count(*)` })
      .from(recsTable)
      .leftJoin(jobsTable, eq(recsTable.decisionJobId, jobsTable.id))
      .where(and(
         eq(recsTable.fieldId, fieldId),
         ne(recsTable.feedbackStatus, 'pending')
      ))
  ]);

  return { rows, meta: buildPaginationMeta({ page, limit, offset }, Number(total)) };
}

/** All recommendations for a specific sub-block */
export async function getSubBlockRecommendations(subBlockId: string) {
  return db
    .select()
    .from(recsTable)
    .where(and(
      eq(recsTable.subBlockId, subBlockId),
      eq(recsTable.feedbackStatus, 'pending'),
    ))
    .orderBy(recsTable.priorityRank)
    .limit(10);
}

/** Operator feedback on a recommendation */
export const FeedbackSchema = z.object({
  feedback_status: z.enum(['acknowledged', 'executed', 'skipped', 'deferred']),
  operator_notes:  z.string().max(1000).optional(),
});

export async function submitFeedback(
  recId:   string,
  userId:  string,
  input:   z.infer<typeof FeedbackSchema>,
) {
  const [rec] = await db
    .select({ id: recsTable.id })
    .from(recsTable)
    .where(eq(recsTable.id, recId))
    .limit(1);
  if (!rec) throw new AppError(404, 'REC_NOT_FOUND', 'Rekomendasi tidak ditemukan');

  const [updated] = await db
    .update(recsTable)
    .set({
      feedbackStatus:  input.feedback_status,
      operatorNotes:   input.operator_notes,
      feedbackBy:      userId,
      feedbackAt:      new Date(),
      hasFeedback:     true,
      lastFeedbackAt:  new Date(),
    })
    .where(eq(recsTable.id, recId))
    .returning();
  return updated;
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

export async function getFieldAlerts(
  fieldId:    string,
  query:      Record<string, unknown>,
) {
  const { page, limit, offset } = parsePagination(query);
  const onlyActive = String(query['active']) !== 'false'; // default: hanya active

  const rows = await db
    .select()
    .from(alertsTable)
    .where(and(
      eq(alertsTable.fieldId, fieldId),
      ...(onlyActive ? [eq(alertsTable.isResolved, false)] : []),
    ))
    .orderBy(desc(alertsTable.triggeredAt))
    .limit(limit)
    .offset(offset);

  return { rows, meta: buildPaginationMeta({ page, limit, offset }, rows.length) };
}

export async function acknowledgeAlert(alertId: string, userId: string) {
  const [alert] = await db
    .select({ id: alertsTable.id })
    .from(alertsTable)
    .where(eq(alertsTable.id, alertId))
    .limit(1);
  if (!alert) throw new AppError(404, 'ALERT_NOT_FOUND', 'Alert tidak ditemukan');

  const [updated] = await db
    .update(alertsTable)
    .set({
      isAcknowledged:   true,
      acknowledgedBy:   userId,
      acknowledgedAt:   new Date(),
    })
    .where(eq(alertsTable.id, alertId))
    .returning();
  return updated;
}
