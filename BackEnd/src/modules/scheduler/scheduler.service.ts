import cron from 'node-cron';
import { logger } from '@/shared/utils/logger.util';
import { runBmkgSyncJob }      from './jobs/bmkg-sync.job';
import { runDecisionCycleJob } from './jobs/decision-cycle.job';
import { runHstUpdaterJob }    from './jobs/hst-updater.job';
import { runStaleFlagJob }     from './jobs/stale-flag.job';
import { runStateBuilderJob }  from './jobs/state-builder.job';

// ---------------------------------------------------------------------------
// Guard: prevent concurrent overlapping runs per job
// ---------------------------------------------------------------------------
const runningJobs = new Set<string>();

function guarded(name: string, fn: () => Promise<void>): () => void {
  return async () => {
    if (runningJobs.has(name)) {
      logger.warn({ job: name }, 'Job still running — skipping this interval');
      return;
    }
    runningJobs.add(name);
    try {
      await fn();
    } catch (err) {
      logger.error({ err, job: name }, 'Scheduler job uncaught error');
    } finally {
      runningJobs.delete(name);
    }
  };
}

// ---------------------------------------------------------------------------
// Start all cron jobs
// ---------------------------------------------------------------------------
export function startScheduler(): void {
  // ── Stale flag — every 15 min ──────────────────────────────────────────
  cron.schedule('*/15 * * * *', guarded('stale_flag', runStaleFlagJob));

  // ── BMKG forecast sync — every 3 hours ────────────────────────────────
  cron.schedule('0 */3 * * *', guarded('bmkg_sync', runBmkgSyncJob));

  // ── Decision cycle — every 30 min ──────────────────────────────────────
  cron.schedule('*/30 * * * *', guarded('decision_cycle', runDecisionCycleJob));

  // ── HST updater — daily midnight ───────────────────────────────────────
  cron.schedule('0 0 * * *', guarded('hst_updater', runHstUpdaterJob));

  // ── State builder — every 10 min ──────────────────────────────────────
  cron.schedule('*/10 * * * *', guarded('state_builder', runStateBuilderJob));

  logger.info(
    {
      state_builder:  '*/10 * * * *',
      stale_flag:     '*/15 * * * *',
      bmkg_sync:      '0 */3 * * *',
      decision_cycle: '*/30 * * * *',
      hst_updater:    '0 0 * * *',
    },
    '✓ Scheduler started — 5 jobs registered',
  );
}

export function stopScheduler(): void {
  cron.getTasks().forEach(task => task.stop());
  logger.info('Scheduler stopped');
}
