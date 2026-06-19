import { eq, and, sql, desc } from 'drizzle-orm';
import axios from 'axios';
import { db } from '@/db/client';
import { mapLayers as layersTable } from '@/db/schema/mst';
import { orthomosaicUploads as uploadsTable } from '@/db/schema/trx';
import { config } from '@/config';
import { logger } from '@/shared/utils/logger.util';
import { r2Service } from './r2.service';
import { AppError } from '@/middleware/error.middleware';

export const orthomosaicService = {
  /**
   * Request an upload URL for a new orthomosaic GeoTIFF.
   */
  async requestUpload(fieldId: string, filename: string, contentType: string) {
    const timestamp = Date.now();
    const safeFilename = filename.replace(/[^a-z0-9.]/gi, '_').toLowerCase();
    const rawKey = `uploads/raw/${fieldId}/${timestamp}_${safeFilename}`;

    const uploadUrl = await r2Service.getPresignedUploadUrl(rawKey, contentType);

    // Save metadata
    const [upload] = await db.insert(uploadsTable).values({
      fieldId:          fieldId,
      originalFilename: filename,
      fileSizeBytes:    0,
      rawStorageKey:    rawKey,
      uploadStatus:     'pending',
      uploadedBy:       null, // filled by router later
    }).returning();

    return {
      uploadId:  upload!.id,
      uploadUrl,
      rawKey,
    };
  },

  /**
   * Finalize upload and trigger Server 2 for COG conversion.
   */
  async finalizeAndConvert(uploadId: string, userId: string) {
    const [upload] = await db.select().from(uploadsTable).where(eq(uploadsTable.id, uploadId)).limit(1);
    if (!upload) throw new AppError(404, 'UPLOAD_NOT_FOUND', 'Upload record tidak ditemukan');
    if (upload.uploadStatus !== 'pending') throw new AppError(400, 'INVALID_STATUS', 'Upload sudah diproses atau gagal');

    const cogKey = upload.rawStorageKey!.replace('uploads/raw/', 'tiles/cog/') + '.cog.tif';

    // Update status
    await db.update(uploadsTable).set({
      uploadStatus: 'processing',
      uploadedBy:   userId,
      updatedAt:    new Date(),
    }).where(eq(uploadsTable.id, uploadId));

    // Trigger Server 2
    try {
      const response = await axios.post(`${config.DECISION_ENGINE_URL}/cog/convert`, {
        raw_key:    upload.rawStorageKey,
        output_key: cogKey,
        field_id:   upload.fieldId,
      }, { timeout: 15000 });

      logger.info({ fieldId: upload.fieldId, uploadId, status: response.data.status }, 'COG conversion triggered on Server 2');
    } catch (err) {
      logger.error({ err, uploadId }, 'Failed to trigger Server 2 COG conversion');
      // Still return success to user, processing happens in background
    }

    return { status: 'processing', uploadId };
  },

  /**
   * Called by Server 2 (or polling) when conversion is done.
   * In this simplified version, we'll assume it's done or provide a manual trigger.
   */
  async markAsReady(uploadId: string, cogKey: string) {
    const [upload] = await db.update(uploadsTable).set({
      uploadStatus: 'ready',
      updatedAt:    new Date(),
    }).where(eq(uploadsTable.id, uploadId)).returning();

    if (!upload) return;

    // Create a new map layer automatically
    await db.insert(layersTable).values({
      fieldId:       upload.fieldId,
      name:          `Orthomosaic ${new Date(upload.createdAt).toLocaleDateString()}`,
      layerType:     'orthomosaic',
      cogStorageKey: cogKey,
      isActive:      false,
      displayOrder:  0,
    });
  },

  async listLayers(fieldId: string) {
    return db.select()
      .from(layersTable)
      .where(eq(layersTable.fieldId, fieldId))
      .orderBy(layersTable.displayOrder, desc(layersTable.createdAt));
  },

  async publishLayer(layerId: string) {
    // Deactivate others
    const [target] = await db.select({ fieldId: layersTable.fieldId }).from(layersTable).where(eq(layersTable.id, layerId)).limit(1);
    if (!target) throw new AppError(404, 'LAYER_NOT_FOUND', 'Layer tidak ditemukan');

    await db.update(layersTable).set({ isActive: false }).where(eq(layersTable.fieldId, target.fieldId));
    await db.update(layersTable).set({ isActive: true }).where(eq(layersTable.id, layerId));
  }
};
