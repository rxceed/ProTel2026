import { syncAllForecasts } from '@/modules/weather/bmkg.service';
import { logger } from '@/shared/utils/logger.util';

/**
 * BMKG Sync Job
 * - forecast: every 3 hours (main weather data)
 * - Called by scheduler.service.ts
 */
export async function runBmkgSyncJob(): Promise<void> {
  logger.info('BMKG sync job started');
  try {
    await syncAllForecasts();
    logger.info('BMKG sync job complete');
  } catch (err) {
    // Errors per-field are already logged inside syncAllForecasts
    logger.error({ err }, 'BMKG sync job encountered fatal error');
  }
}
