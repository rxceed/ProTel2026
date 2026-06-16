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
  // 1. Dapatkan fieldId dari subBlockId
  const [sb] = await db.select({ fieldId: subBlocksTable.fieldId })
    .from(subBlocksTable).where(eq(subBlocksTable.id, subBlockId)).limit(1);
  if (!sb) return null;

  // 2. Ambil semua sub-blocks di field tersebut, diurutkan agar indeksnya cocok dengan matrix
  const subBlocks = await db.select({ id: subBlocksTable.id })
    .from(subBlocksTable)
    .where(and(eq(subBlocksTable.fieldId, sb.fieldId), eq(subBlocksTable.isActive, true)))
    .orderBy(subBlocksTable.displayOrder, subBlocksTable.name);

  // 3. Ambil flow_path matrix untuk field
  const [flowPath] = await db.select().from(flowPathsTable)
    .where(and(
      eq(flowPathsTable.fieldId, sb.fieldId),
      eq(flowPathsTable.isActive, true),
    ))
    .limit(1);

  if (!flowPath || !flowPath.floydWarshallMatrix) return null;

  // 4. Rekonstruksi direct edges dan filter yang terhubung dengan subBlockId
  const paths = getDirectEdgesFromMatrix(flowPath.floydWarshallMatrix, subBlocks)
    .filter(p => p.fromId === subBlockId || p.toId === subBlockId);

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

function getDirectEdgesFromMatrix(matrixJson: any, subBlocks: { id: string }[]): { fromId: string; toId: string }[] {
  if (!matrixJson || typeof matrixJson !== 'object') return [];
  
  const successor = Array.isArray(matrixJson.successor)
    ? matrixJson.successor
    : Array.isArray(matrixJson.successors)
    ? matrixJson.successors
    : null;
    
  if (!successor || !Array.isArray(successor)) return [];
  
  const edges: { fromId: string; toId: string }[] = [];
  
  for (let u = 0; u < successor.length; u++) {
    const row = successor[u];
    if (!Array.isArray(row)) continue;
    for (let v = 0; v < row.length; v++) {
      const nextHop = row[v];
      if (nextHop === v && u !== v) {
        const fromSb = subBlocks[u];
        const toSb = subBlocks[v];
        if (fromSb && toSb) {
          edges.push({
            fromId: fromSb.id,
            toId: toSb.id,
          });
        }
      }
    }
  }
  
  return edges;
}
