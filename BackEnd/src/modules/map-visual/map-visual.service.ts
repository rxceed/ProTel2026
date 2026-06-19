import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { fields as fieldsTable } from '@/db/schema/mst';
import { r2Service } from '../orthomosaic/r2.service';
import { AppError } from '@/middleware/error.middleware';
import { config } from '@/config';

export const mapVisualService = {
  /**
   * Request a presigned URL or Local upload URL to upload a field visual.
   */
  async requestUpload(fieldId: string, filename: string, contentType: string) {
    const timestamp = Date.now();
    const safeFilename = filename.replace(/[^a-z0-9.]/gi, '_').toLowerCase();
    
    // Cek apakah R2 sudah dikonfigurasi
    const isR2Configured = config.R2_ACCESS_KEY_ID && 
                           !config.R2_ACCESS_KEY_ID.includes('YOUR_') && 
                           config.R2_ENDPOINT && 
                           !config.R2_ENDPOINT.includes('YOUR_ACCOUNT_ID');

    if (!isR2Configured) {
      // Local Upload Fallback
      const uploadUrl = `http://localhost:3000/fields/${fieldId}/map-visual/local-upload?filename=${timestamp}_${encodeURIComponent(safeFilename)}`;
      const storageKey = `http://localhost:3000/uploads/map-visuals/${fieldId}/${timestamp}_${safeFilename}`;
      
      return {
        uploadUrl,
        storageKey,
      };
    }

    const storageKey = `map-visuals/${fieldId}/${timestamp}_${safeFilename}`;
    const uploadUrl = await r2Service.getPresignedUploadUrl(storageKey, contentType);

    return {
      uploadUrl,
      storageKey,
    };
  },

  /**
   * Finalize the upload by updating the field record with the visual URL.
   */
  async finalizeUpload(fieldId: string, storageKey: string) {
    const publicUrl = storageKey.startsWith('http') 
      ? storageKey 
      : r2Service.getPublicUrl(storageKey);

    const [updated] = await db.update(fieldsTable)
      .set({
        mapVisualUrl: publicUrl,
        updatedAt: new Date(),
      })
      .where(eq(fieldsTable.id, fieldId))
      .returning();

    if (!updated) throw new AppError(404, 'FIELD_NOT_FOUND', 'Field tidak ditemukan');

    return updated;
  },

  /**
   * Update the map bounds (georeferencing) for the field.
   */
  async updateBounds(fieldId: string, bounds: any) {
    const [updated] = await db.update(fieldsTable)
      .set({
        mapBounds: bounds,
        updatedAt: new Date(),
      })
      .where(eq(fieldsTable.id, fieldId))
      .returning();

    if (!updated) throw new AppError(404, 'FIELD_NOT_FOUND', 'Field tidak ditemukan');

    return updated;
  },

  async deleteVisual(fieldId: string) {
    const [updated] = await db.update(fieldsTable)
      .set({
        mapVisualUrl: null,
        mapBounds: null,
        updatedAt: new Date(),
      })
      .where(eq(fieldsTable.id, fieldId))
      .returning();
    
    return updated;
  }
};
