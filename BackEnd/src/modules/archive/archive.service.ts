import { eq, and, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { cropCycles as cyclesTable } from '@/db/schema/mst';
import { AppError } from '@/middleware/error.middleware';
import { logger } from '@/shared/utils/logger.util';

export const archiveService = {
  /**
   * Finalize and archive a crop cycle.
   * This marks the cycle as completed/archived.
   * Business logic: ensures today's data is captured before closing.
   */
  async archiveCycle(cycleId: string, userId: string) {
    const [cycle] = await db.select().from(cyclesTable).where(eq(cyclesTable.id, cycleId)).limit(1);
    if (!cycle) throw new AppError(404, 'CYCLE_NOT_FOUND', 'Crop cycle tidak ditemukan');
    if (cycle.status !== 'active') throw new AppError(400, 'CYCLE_NOT_ACTIVE', 'Hanya cycle aktif yang bisa diarsipkan');

    const [updated] = await db.update(cyclesTable).set({
      status:      'completed',
      completedAt: new Date(),
      updatedAt:   new Date(),
    }).where(eq(cyclesTable.id, cycleId)).returning();

    logger.info({ cycleId, userId }, 'Crop cycle archived/completed');
    return updated;
  },

  /**
   * List archived cycles for a sub-block or field.
   */
  async listArchives(fieldId: string) {
    return db.select()
      .from(cyclesTable)
      .where(and(
        eq(cyclesTable.fieldId, fieldId),
        eq(cyclesTable.status, 'completed'),
      ))
      .orderBy(sql`${cyclesTable.completedAt} DESC`);
  },
};
