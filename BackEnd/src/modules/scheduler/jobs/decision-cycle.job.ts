import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { fields as fieldsTable } from '@/db/schema/mst';
import { runDecisionCycleForField } from '@/modules/decision-engine/engine-client.service';
import { logger } from '@/shared/utils/logger.util';

/**
 * Decision cycle job — runs every 30 min.
 *
 * Logi:
 * - 'siaga' fields: trigger setiap 30 menit
 * - 'normal' fields: trigger setiap 60 menit (hanya pada menit ke-00, bukan ke-30)
 *
 * Node-cron memanggil job ini setiap 30 menit.
 * Job sendiri yang memilih field mana yang perlu diproses.
 */
export async function runDecisionCycleJob(): Promise<void> {
  const now     = new Date();
  const minute  = now.getMinutes(); // 0 atau 30
  const isEven  = minute === 0;    // true pada jam:00 (bukan jam:30)

  // Ambil semua field aktif
  const activeFields = await db
    .select({
      id:                fieldsTable.id,
      name:              fieldsTable.name,
      decisionCycleMode: fieldsTable.decisionCycleMode,
    })
    .from(fieldsTable)
    .where(eq(fieldsTable.isActive, true));

  const toProcess = activeFields.filter(f => {
    if (f.decisionCycleMode === 'siaga') return true;    // setiap 30 menit
    return isEven;                                         // normal: hanya saat menit ke-00
  });

  if (toProcess.length === 0) {
    logger.debug('Decision cycle: no fields to process this interval');
    return;
  }

  logger.info({ count: toProcess.length, minute }, 'Decision cycle job started');

  for (const field of toProcess) {
    try {
      await runDecisionCycleForField(field.id, field.decisionCycleMode ?? 'normal');
    } catch (err) {
      logger.error({ err, fieldId: field.id }, 'Decision cycle failed for field');
    }
  }

  logger.info({ count: toProcess.length }, 'Decision cycle job complete');
}
