import { z } from 'zod';

export const createTreatmentSchema = z.object({
  body: z.object({
    subBlockId: z.string().uuid().optional().nullable().or(z.literal('')),
    cropCycleId: z.string().uuid().optional().nullable().or(z.literal('')),
    treatmentType: z.enum(['fertilizer', 'pesticide', 'herbicide']),
    productName: z.string().min(1, 'Product name is required'),
    targetWaterLevelCm: z.coerce.number(),
    activeDurationHours: z.coerce.number().positive('Duration must be positive'),
    notes: z.string().optional().nullable(),
  }),
  params: z.object({
    fieldId: z.string().uuid(),
  }),
});
