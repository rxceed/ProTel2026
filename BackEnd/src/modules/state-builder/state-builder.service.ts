import { eq, and, desc, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { subBlocks as subBlocksTable, devices as devicesTable } from '@/db/schema/mst';
import {
  telemetryRecords as recordsTable,
  subBlockStates as statesTable,
  subBlockCurrentStates as currentStatesTable,
} from '@/db/schema';
import { logger } from '@/shared/utils/logger.util';
import { estimateFromNeighbors } from './estimator';

// ---------------------------------------------------------------------------
// Freshness thresholds
// ---------------------------------------------------------------------------
const FRESH_MS  = 2  * 60 * 60 * 1000;  // < 2 jam    → fresh
const STALE_MS  = 8  * 60 * 60 * 1000;  // 2-8 jam    → stale
// > 8 jam → no_data (trigger estimator)

type FreshnessStatus = 'fresh' | 'stale' | 'no_data';

function getFreshness(lastSeenAt: Date | null): FreshnessStatus {
  if (!lastSeenAt) return 'no_data';
  const age = Date.now() - lastSeenAt.getTime();
  if (age < FRESH_MS)  return 'fresh';
  if (age < STALE_MS)  return 'stale';
  return 'no_data';
}

// ---------------------------------------------------------------------------
// Build state for a single sub-block
// ---------------------------------------------------------------------------
interface BuiltState {
  subBlockId:               string;
  fieldId:                  string;
  waterLevelCm:             number | null;
  waterLevelRawCm:          number | null;
  temperatureC:             number | null;
  humidityPct:              number | null;
  stateSource:              string;
  freshnessStatus:          FreshnessStatus;
  lastObservationAt:        Date | null;
  interpolationConfidence:  number | null;
  estimatedFromSubBlockIds: string[] | null; // audit trail: tetangga yang dipakai estimasi
  recordId:                 string | null;
}

async function buildSubBlockState(
  subBlockId: string,
  fieldId:    string,
): Promise<BuiltState> {
  // 1. Get latest valid telemetry from devices assigned to this sub-block
  const [latest] = await db
    .select({
      id:              recordsTable.id,
      waterLevelCm:    recordsTable.waterLevelCm,
      waterLevelRawCm: recordsTable.waterLevelRawCm,
      temperatureC:    recordsTable.temperatureC,
      humidityPct:     recordsTable.humidityPct,
      eventTimestamp:  recordsTable.eventTimestamp,
    })
    .from(recordsTable)
    .where(and(
      eq(recordsTable.subBlockId, subBlockId),
      eq(recordsTable.isValid, true),
    ))
    .orderBy(desc(recordsTable.eventTimestamp))
    .limit(1);

  const freshness = getFreshness(latest?.eventTimestamp ?? null);

  // 2. If we have observed data
  if (latest && freshness !== 'no_data') {
    return {
      subBlockId,
      fieldId,
      waterLevelCm:             latest.waterLevelCm !== null ? parseFloat(latest.waterLevelCm) : null,
      waterLevelRawCm:          latest.waterLevelRawCm !== null ? parseFloat(latest.waterLevelRawCm) : null,
      temperatureC:             latest.temperatureC !== null ? parseFloat(latest.temperatureC) : null,
      humidityPct:              latest.humidityPct !== null ? parseFloat(latest.humidityPct) : null,
      stateSource:              'observed',
      freshnessStatus:          freshness,
      lastObservationAt:        latest.eventTimestamp,
      interpolationConfidence:  null,
      estimatedFromSubBlockIds: null,
      recordId:                 latest.id,
    };
  }

  // 3. No fresh data → try neighbor estimation
  const estimate = await estimateFromNeighbors(subBlockId);
  if (estimate) {
    return {
      subBlockId,
      fieldId,
      waterLevelCm:             estimate.waterLevelCm,
      waterLevelRawCm:          null,
      temperatureC:             null,
      humidityPct:              null,
      stateSource:              'estimated',
      freshnessStatus:          'no_data',
      lastObservationAt:        latest?.eventTimestamp ?? null,
      interpolationConfidence:  estimate.interpolationConfidence,
      estimatedFromSubBlockIds: estimate.usedNeighborIds,
      recordId:                 null,
    };
  }

  // 4. No data at all
  return {
    subBlockId,
    fieldId,
    waterLevelCm:             null,
    waterLevelRawCm:          null,
    temperatureC:             null,
    humidityPct:              null,
    stateSource:              'no_data',
    freshnessStatus:          'no_data',
    lastObservationAt:        null,
    interpolationConfidence:  null,
    estimatedFromSubBlockIds: null,
    recordId:                 null,
  };
}

// ---------------------------------------------------------------------------
// Build state for all sub-blocks in a field
// ---------------------------------------------------------------------------
export async function buildFieldStates(fieldId: string): Promise<number> {
  const subBlocks = await db
    .select({ id: subBlocksTable.id })
    .from(subBlocksTable)
    .where(and(eq(subBlocksTable.fieldId, fieldId), eq(subBlocksTable.isActive, true)));

  if (subBlocks.length === 0) return 0;

  let updated = 0;

    const now = new Date();

    for (const sb of subBlocks) {
      try {
        const state = await buildSubBlockState(sb.id, fieldId);

        // 1. History Record (trx.sub_block_states)
        await db.insert(statesTable).values({
          subBlockId:               state.subBlockId,
          fieldId:                  state.fieldId,
          stateTime:                state.lastObservationAt ?? now,
          waterLevelCm:             state.waterLevelCm?.toFixed(2),
          waterLevelTrend:          'stable', // placeholder logic
          stateSource:              state.stateSource,
          freshnessStatus:          state.freshnessStatus,
          lastObservationAt:        state.lastObservationAt,
          estimatedFromSubBlockIds: state.estimatedFromSubBlockIds ?? [],
          interpolationConfidence:  state.interpolationConfidence?.toFixed(2),
        });

        // 2. Current State (trx.sub_block_current_states) — Upsert
        await db.insert(currentStatesTable).values({
          subBlockId:               state.subBlockId,
          fieldId:                  state.fieldId,
          stateTime:                state.lastObservationAt ?? now,
          waterLevelCm:             state.waterLevelCm?.toFixed(2),
          stateSource:              state.stateSource,
          freshnessStatus:          state.freshnessStatus,
          lastObservationAt:        state.lastObservationAt,
          estimatedFromSubBlockIds: state.estimatedFromSubBlockIds ?? [],
          interpolationConfidence:  state.interpolationConfidence?.toFixed(2),
          updatedAt:                now,
        }).onConflictDoUpdate({
          target: currentStatesTable.subBlockId,
          set: {
            stateTime:               state.lastObservationAt ?? now,
            waterLevelCm:            state.waterLevelCm?.toFixed(2),
            stateSource:             state.stateSource,
            freshnessStatus:         state.freshnessStatus,
            lastObservationAt:       state.lastObservationAt,
            estimatedFromSubBlockIds: state.estimatedFromSubBlockIds ?? [],
            interpolationConfidence:  state.interpolationConfidence?.toFixed(2),
            updatedAt:               now,
          },
        });

      updated++;
    } catch (err) {
      logger.error({ err, subBlockId: sb.id }, 'State builder failed for sub-block');
    }
  }

  logger.debug({ fieldId, updated }, 'State builder complete');
  return updated;
}
