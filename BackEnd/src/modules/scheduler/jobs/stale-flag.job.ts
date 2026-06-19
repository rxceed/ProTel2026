import { eq, and, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { fields as fieldsTable } from '@/db/schema/mst';
import { subBlockCurrentStates as currentStatesTable } from '@/db/schema';
import { logger } from '@/shared/utils/logger.util';

const STALE_THRESHOLD_MS  = 2 * 60 * 60 * 1000;   // 2 jam → stale
const NO_DATA_THRESHOLD_MS = 8 * 60 * 60 * 1000;   // 8 jam → no_data

/**
 * Update freshness_status for all sub_block_current_states
 * based on last_observation_at vs current time.
 * Runs every 15 minutes.
 */
export async function runStaleFlagJob(): Promise<void> {
  const now = new Date();
  const staleThreshold  = new Date(now.getTime() - STALE_THRESHOLD_MS);
  const noDataThreshold = new Date(now.getTime() - NO_DATA_THRESHOLD_MS);

  // Mark as no_data
  const { rowCount: noDataCount } = await db.update(currentStatesTable)
    .set({ freshnessStatus: 'no_data', updatedAt: now })
    .where(and(
      sql`${currentStatesTable.lastObservationAt} IS NOT NULL`,
      sql`${currentStatesTable.lastObservationAt} < ${noDataThreshold}`,
      sql`${currentStatesTable.freshnessStatus} != 'no_data'`,
    ));

  // Mark as stale (between stale and no_data threshold)
  const { rowCount: staleCount } = await db.update(currentStatesTable)
    .set({ freshnessStatus: 'stale', updatedAt: now })
    .where(and(
      sql`${currentStatesTable.lastObservationAt} IS NOT NULL`,
      sql`${currentStatesTable.lastObservationAt} < ${staleThreshold}`,
      sql`${currentStatesTable.lastObservationAt} >= ${noDataThreshold}`,
      sql`${currentStatesTable.freshnessStatus} = 'fresh'`,
    ));

  if ((noDataCount ?? 0) + (staleCount ?? 0) > 0) {
    logger.info({ stale: staleCount ?? 0, noData: noDataCount ?? 0 }, 'Stale flag job complete');
  }
}
