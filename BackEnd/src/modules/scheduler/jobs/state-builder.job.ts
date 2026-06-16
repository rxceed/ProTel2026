import { db } from '@/db/client';
import { fields as fieldsTable, subBlocks as subBlocksTable } from '@/db/schema/mst';
import { eq, and } from 'drizzle-orm';
import { buildFieldStates } from '@/modules/state-builder/state-builder.service';
import { logger } from '@/shared/utils/logger.util';

/**
 * runStateBuilderJob — dijalankan oleh scheduler setiap 10 menit.
 *
 * Mengambil semua field yang punya sub_block aktif, lalu memperbarui
 * state estimasi (interpolasi, stale flag, dst.) untuk setiap field.
 *
 * CATATAN: `engine-client.service.ts` tetap memanggil `buildFieldStates(fieldId)`
 * secara langsung sebelum evaluasi DSS agar selalu menggunakan data paling segar.
 * Job ini melengkapi update berkala di luar siklus evaluasi.
 */
export async function runStateBuilderJob(): Promise<void> {
  // 1. Ambil semua field aktif yang punya minimal 1 sub_block aktif
  const activeFields = await db
    .selectDistinct({ id: fieldsTable.id, name: fieldsTable.name })
    .from(fieldsTable)
    .innerJoin(subBlocksTable, and(
      eq(subBlocksTable.fieldId, fieldsTable.id),
      eq(subBlocksTable.isActive, true),
    ));

  if (activeFields.length === 0) {
    logger.info('State builder job — no active fields found, skipping');
    return;
  }

  logger.info({ fieldCount: activeFields.length }, 'State builder job — starting');

  let ok = 0, failed = 0;

  for (const field of activeFields) {
    try {
      await buildFieldStates(field.id);
      ok++;
    } catch (err) {
      logger.error({ err, fieldId: field.id, fieldName: field.name },
        'State builder job — failed for field');
      failed++;
    }
  }

  logger.info({ ok, failed, total: activeFields.length }, 'State builder job — complete');
}
