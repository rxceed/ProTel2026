import { Router } from 'express';
import { validate } from '@/middleware/validate.middleware';
import { requireAuth } from '@/middleware/auth.middleware';
import { createTreatmentSchema } from './agronomic-treatments.schema';
import { agronomicTreatmentsService } from './agronomic-treatments.service';
import { AppError } from '@/middleware/error.middleware';

export const agronomicTreatmentsRouter = Router();

/**
 * @route POST /fields/:id/agronomic-treatments
 * @desc Create a new agronomic treatment that overrides DSS target water level
 */
agronomicTreatmentsRouter.post(
  '/:fieldId/agronomic-treatments',
  requireAuth,
  validate(createTreatmentSchema),
  async (req, res, next) => {
    try {
      const { fieldId } = req.params;
      const data = req.body;
      const userId = req.user?.id;

      const treatment = await agronomicTreatmentsService.createTreatment(fieldId, data, userId);

      res.status(201).json({
        success: true,
        data: treatment,
      });
    } catch (error) {
      next(error);
    }
  }
);
