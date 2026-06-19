import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { systemSettings as systemSettingsTable } from '@/db/schema/mst';
import { AppError } from '@/middleware/error.middleware';

export const systemSettingsService = {
  async getSettings() {
    const [settings] = await db
      .select()
      .from(systemSettingsTable)
      .where(eq(systemSettingsTable.id, 'global'))
      .limit(1);

    if (!settings) {
      // Jika kosong, insert default dulu
      await db.insert(systemSettingsTable).values({ id: 'global' }).onConflictDoNothing();
      const [retry] = await db
        .select()
        .from(systemSettingsTable)
        .where(eq(systemSettingsTable.id, 'global'))
        .limit(1);
      return retry;
    }

    return settings;
  },

  async updateSettings(input: any) {
    const updateData: any = {};
    if (input.organizationName !== undefined) updateData.organizationName = input.organizationName;
    if (input.organizationLogo !== undefined) updateData.organizationLogo = input.organizationLogo;
    if (input.measurementUnits !== undefined) updateData.measurementUnits = input.measurementUnits;
    if (input.cloudflareApiUrl !== undefined) updateData.cloudflareApiUrl = input.cloudflareApiUrl;
    if (input.cloudflareApiKey !== undefined) updateData.cloudflareApiKey = input.cloudflareApiKey;

    updateData.updatedAt = new Date();

    await db
      .update(systemSettingsTable)
      .set(updateData)
      .where(eq(systemSettingsTable.id, 'global'));

    return this.getSettings();
  }
};
