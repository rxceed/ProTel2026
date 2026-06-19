import { eq, and, sql, desc } from 'drizzle-orm';
import { db } from '@/db/client';
import { subBlocks as subBlocksTable, flowPaths as flowPathsTable } from '@/db/schema/mst';
import { subBlockCurrentStates as currentStatesTable } from '@/db/schema';

// ---------------------------------------------------------------------------
// Estimator: interpolasi level air dari sub-block tetangga
// Dipakai state-builder saat sub-block tidak punya sensor / data stale
// ---------------------------------------------------------------------------

export interface NeighborState {
  subBlockId:      string;
  waterLevelCm:    number | null;
  freshnessStatus: string;
  stateSource:     string;
}

export interface EstimationResult {
  waterLevelCm:            number | null;
  stateSource:             'estimated';
  interpolationConfidence: number;  // 0.0 – 1.0
  usedNeighborCount:       number;
  usedNeighborIds:         string[]; // UUID[] untuk estimated_from_sub_block_ids (audit trail)
}

/**
 * Estimasi water level untuk sub-block yang tidak punya data,
 * berdasarkan level air dari tetangga yang terhubung via flow_paths.
 *
 * Confidence:
 *   - 1.0 jika semua tetangga 'fresh'
 *   - 0.6 jika semua tetangga 'stale'
 *   - 0.0 jika tidak ada tetangga dengan data
 */
export async function estimateFromNeighbors(subBlockId: string): Promise<EstimationResult | null> {
  // 1. Ambil flow_paths yang terhubung ke subBlock ini (sebagai from atau to)
  const paths = await db.select({
    fromId: flowPathsTable.fromSubBlockId,
    toId:   flowPathsTable.toSubBlockId,
  })
    .from(flowPathsTable)
    .where(and(
      eq(flowPathsTable.isActive, true),
      sql`(${flowPathsTable.fromSubBlockId} = ${subBlockId} OR ${flowPathsTable.toSubBlockId} = ${subBlockId})`,
    ));

  if (paths.length === 0) return null;

  // 2. Kumpulkan neighbor IDs (max 1-hop)
  const neighborIds = [...new Set(
    paths.flatMap(p => [p.fromId, p.toId]).filter(id => id !== subBlockId),
  )];

  if (neighborIds.length === 0) return null;

  // 3. Dapatkan current state tetangga
  const neighborStates: NeighborState[] = [];
  for (const nId of neighborIds) {
    const [state] = await db.select({
      subBlockId:      currentStatesTable.subBlockId,
      waterLevelCm:    currentStatesTable.waterLevelCm,
      freshnessStatus: currentStatesTable.freshnessStatus,
      stateSource:     currentStatesTable.stateSource,
    })
      .from(currentStatesTable)
      .where(eq(currentStatesTable.subBlockId, nId))
      .limit(1);
    if (state) neighborStates.push({
      subBlockId:      state.subBlockId,
      waterLevelCm:    state.waterLevelCm !== null ? parseFloat(state.waterLevelCm) : null,
      freshnessStatus: state.freshnessStatus,
      stateSource:     state.stateSource,
    });
  }

  // 4. Hanya pakai tetangga dengan data (fresh atau stale)
  const usable = neighborStates.filter(
    n => n.waterLevelCm !== null && ['fresh', 'stale'].includes(n.freshnessStatus),
  );

  if (usable.length === 0) return null;

  // 5. Weighted average (fresh weight = 1.0, stale weight = 0.5)
  let totalWeight = 0;
  let weightedSum = 0;
  let freshCount  = 0;

  for (const n of usable) {
    const w = n.freshnessStatus === 'fresh' ? 1.0 : 0.5;
    weightedSum  += n.waterLevelCm! * w;
    totalWeight  += w;
    if (n.freshnessStatus === 'fresh') freshCount++;
  }

  const waterLevelCm = Math.round((weightedSum / totalWeight) * 100) / 100;
  const confidence   = freshCount / usable.length; // 1.0 = semua fresh

  return {
    waterLevelCm,
    stateSource:             'estimated',
    interpolationConfidence: Math.round(confidence * 100) / 100,
    usedNeighborCount:       usable.length,
    usedNeighborIds:         usable.map(n => n.subBlockId),
  };
}
