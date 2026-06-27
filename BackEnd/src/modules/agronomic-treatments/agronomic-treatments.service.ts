import { db } from '@/db/client';
import { agronomicTreatments } from '@/db/schema';
import { eq, and, gt } from 'drizzle-orm';
import { AppError } from '@/shared/utils/error.util';

export class AgronomicTreatmentsService {
  /**
   * Create a new agronomic treatment that will act as a DSS override.
   */
  async createTreatment(
    fieldId: string,
    data: {
      subBlockId?: string;
      cropCycleId?: string;
      treatmentType: string;
      productName: string;
      targetWaterLevelCm: number;
      activeDurationHours: number;
      notes?: string;
    },
    userId?: string
  ) {
    const overrideExpiresAt = new Date(Date.now() + data.activeDurationHours * 60 * 60 * 1000);

    const [treatment] = await db
      .insert(agronomicTreatments)
      .values({
        fieldId,
        subBlockId: data.subBlockId || null,
        cropCycleId: data.cropCycleId || null,
        treatmentType: data.treatmentType,
        productName: data.productName,
        targetWaterLevelCm: data.targetWaterLevelCm.toString(),
        activeDurationHours: data.activeDurationHours,
        overrideExpiresAt,
        reportedBy: userId || null,
        notes: data.notes || null,
      })
      .returning();

    return treatment;
  }

  /**
   * Get active treatments for a field.
   */
  async getActiveTreatments(fieldId: string) {
    const now = new Date();
    return db
      .select()
      .from(agronomicTreatments)
      .where(
        and(
          eq(agronomicTreatments.fieldId, fieldId),
          gt(agronomicTreatments.overrideExpiresAt, now)
        )
      );
  }
}

export const agronomicTreatmentsService = new AgronomicTreatmentsService();
