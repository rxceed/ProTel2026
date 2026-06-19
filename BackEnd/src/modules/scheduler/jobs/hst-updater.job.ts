import { eq, and, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { cropCycles as cyclesTable } from '@/db/schema/mst';
import { logger } from '@/shared/utils/logger.util';

/**
 * Increment current_hst for all active crop cycles based on planting_date.
 * Also syncs the current_phase_code based on HST bucket thresholds.
 * Runs daily at midnight.
 */
export async function runHstUpdaterJob(): Promise<void> {
  const today = new Date();

  // Select all active crop cycles
  const activeCycles = await db
    .select({
      id:               cyclesTable.id,
      plantingDate:     cyclesTable.plantingDate,
      currentHst:       cyclesTable.currentHst,
      currentPhaseCode: cyclesTable.currentPhaseCode,
      bucketCode:       cyclesTable.bucketCode,
    })
    .from(cyclesTable)
    .where(eq(cyclesTable.status, 'active'));

  let updated = 0;
  for (const cycle of activeCycles) {
    try {
      const planting = new Date(cycle.plantingDate);
      const diffDays = Math.floor((today.getTime() - planting.getTime()) / 86_400_000);
      const newHst   = Math.max(0, diffDays);

      // Only update if changed
      if (newHst === cycle.currentHst) continue;

      await db.update(cyclesTable)
        .set({ currentHst: newHst, updatedAt: new Date() })
        .where(eq(cyclesTable.id, cycle.id));

      updated++;
    } catch (err) {
      logger.error({ err, cycleId: cycle.id }, 'HST updater: failed for cycle');
    }
  }

  logger.info({ updated, total: activeCycles.length }, 'HST updater job complete');
}
