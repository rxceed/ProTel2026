import { eq, and, sql, inArray } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  subBlocks        as subBlocksTable,
  flowPaths        as flowPathsTable,
  irrigationRuleProfiles as ruleProfilesTable,
  cropCycles       as cropCyclesTable,
  embankments      as embankmentsTable,
  fields           as fieldsTable,
} from '@/db/schema/mst';
import {
  subBlockCurrentStates as currentStatesTable,
  irrigationRecommendations as recsTable,
} from '@/db/schema/trx';
import { logger } from '@/shared/utils/logger.util';
import { config } from '@/config';
import {
  resolveWaterHeight,
  resolveOptimalHeight,
  computeFieldAvgWaterM,
} from './node-resolver';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RecommendationInput {
  sub_block_id:        string;
  recommendation_type: string;
  priority_score:      number;
}

interface RecommendationWithId extends RecommendationInput {
  recommendationId: string; // PK dari irrigation_recommendations
}

// ---------------------------------------------------------------------------
// Main routing orchestrator
// ---------------------------------------------------------------------------

/**
 * Orkestrasi routing air menggunakan algoritma Floyd-Warshall.
 *
 * Alur:
 * 1. Filter rekomendasi menjadi sources (DRAIN) dan targets (IRRIGATE)
 * 2. Ambil data graph (sub_blocks + flow_paths) dari DB
 * 3. Resolve water_height per node (4-level fallback via node-resolver)
 * 4. Bangun payload dan panggil gis-processing /api/floydwarshall/run
 * 5. Pilih pasangan source-target prioritas tertinggi
 * 6. Panggil /api/floydwarshall/matrix untuk rute detail
 * 7. Update irrigation_recommendations dengan route_path_ids + routing_score
 */
export async function runWaterRouting(
  fieldId:         string,
  jobId:           string,
  recommendations: RecommendationInput[],
): Promise<void> {
  const logCtx = { fieldId, jobId };

  // ── 1. Filter: pisah DRAIN (sources) dan IRRIGATE (targets) ──────────────
  // Ambil ID rekomendasi dari DB untuk update nanti
  const savedRecs = await db.select({
    id:                 recsTable.id,
    subBlockId:         recsTable.subBlockId,
    recommendationType: recsTable.recommendationType,
    priorityScore:      recsTable.priorityScore,
  })
  .from(recsTable)
  .where(and(
    eq(recsTable.fieldId,       fieldId),
    eq(recsTable.decisionJobId, jobId),
  ));

  const recMap = new Map(savedRecs.map(r => [r.subBlockId, r]));

  const sources = recommendations
    .filter(r => r.recommendation_type === 'drain')
    .sort((a, b) => b.priority_score - a.priority_score);

  const targets = recommendations
    .filter(r => r.recommendation_type === 'irrigate')
    .sort((a, b) => b.priority_score - a.priority_score);

  if (sources.length === 0 || targets.length === 0) {
    logger.info(logCtx, 'Water routing skipped — no DRAIN/IRRIGATE imbalance in this cycle');
    return;
  }

  // ── 2. Ambil data graph dari DB ───────────────────────────────────────────
  // Sub-blocks: id, area, elevation, centroid sebagai EWKT
  const subBlockRows = await db
    .select({
      id:          subBlocksTable.id,
      areaM2:      subBlocksTable.areaM2,
      elevationM:  subBlocksTable.elevationM,
      elevationCalibration: subBlocksTable.elevationCalibration,
      centroidEwkt: sql<string>`ST_AsEWKT(${subBlocksTable.centroid})`,
    })
    .from(subBlocksTable)
    .where(and(eq(subBlocksTable.fieldId, fieldId), eq(subBlocksTable.isActive, true)));

  if (subBlockRows.length < 2) {
    logger.warn(logCtx, 'Water routing skipped — fewer than 2 active sub-blocks');
    return;
  }

  // Load embankments for this field to derive sub-block connections
  const embankmentRows = await db
    .select({
      connectedSubBlocks: embankmentsTable.connectedSubBlocks,
    })
    .from(embankmentsTable)
    .where(and(
      eq(embankmentsTable.fieldId, fieldId),
      eq(embankmentsTable.isActive, true)
    ));

  const derivedConnections: Array<{ from: string; to: string }> = [];

  for (const emb of embankmentRows) {
    const connected = emb.connectedSubBlocks ?? [];
    for (let i = 0; i < connected.length; i++) {
      for (let j = i + 1; j < connected.length; j++) {
        derivedConnections.push({ from: connected[i], to: connected[j] });
        derivedConnections.push({ from: connected[j], to: connected[i] });
      }
    }
  }

  // Fallback: if no embankment-derived connections, try loading from saved irrigationEdges on field
  if (derivedConnections.length === 0) {
    const [field] = await db
      .select({ irrigationEdges: fieldsTable.irrigationEdges })
      .from(fieldsTable)
      .where(eq(fieldsTable.id, fieldId))
      .limit(1);

    if (field?.irrigationEdges && Array.isArray(field.irrigationEdges)) {
      field.irrigationEdges.forEach((edge: any) => {
        if (edge && edge.from && edge.to) {
          derivedConnections.push({ from: edge.from, to: edge.to });
        }
      });
    }
  }

  if (derivedConnections.length === 0) {
    logger.warn(logCtx, 'Water routing skipped — no active flow paths/embankments defined for field');
    return;
  }

  // Current states
  const stateRows = await db.select().from(currentStatesTable)
    .where(eq(currentStatesTable.fieldId, fieldId));
  const stateMap = new Map(stateRows.map(s => [s.subBlockId, s]));

  // Crop cycles + rule profiles untuk optimal_height
  const cycles = await db.select().from(cropCyclesTable)
    .where(and(eq(cropCyclesTable.fieldId, fieldId), eq(cropCyclesTable.status, 'active')));
  const cycleMap = new Map(cycles.map(c => [c.subBlockId, c]));

  const ruleIds = [...new Set(cycles.map(c => c.ruleProfileId).filter(Boolean))] as string[];
  const ruleMap = new Map<string, typeof ruleProfilesTable.$inferSelect>();
  if (ruleIds.length > 0) {
    const rules = await db.select().from(ruleProfilesTable)
      .where(inArray(ruleProfilesTable.id, ruleIds));
    rules.forEach(r => ruleMap.set(r.id, r));
  }

  // Default rule (isDefault=true) sebagai fallback optimal_height
  const [defaultRule] = await db.select().from(ruleProfilesTable)
    .where(and(eq(ruleProfilesTable.isDefault, true), eq(ruleProfilesTable.isActive, true)))
    .limit(1);

  // ── 3. Resolve water_height dan optimal_height per node ───────────────────
  const fieldAvgM = computeFieldAvgWaterM(stateRows);

  if (fieldAvgM === null) {
    logger.warn(logCtx, 'Water routing skipped — all sub-blocks have no_data (L4)');
    return;
  }

  // ── 4. Bangun UUID ↔ index mapping ────────────────────────────────────────
  const uuidToIdx = new Map<string, number>();
  const idxToUuid = new Map<number, string>();
  subBlockRows.forEach((sb, idx) => {
    uuidToIdx.set(sb.id, idx);
    idxToUuid.set(idx, sb.id);
  });

  // Build nodes[] payload untuk Python
  const nodes = subBlockRows.map(sb => {
    const state = stateMap.get(sb.id);
    const waterRes = state
      ? resolveWaterHeight(state, fieldAvgM)
      : { waterHeightM: fieldAvgM, level: 3 as const };

    const waterHeightM  = waterRes?.waterHeightM ?? fieldAvgM;
    const optimalHeightM = resolveOptimalHeight(sb.id, cycleMap, ruleMap, defaultRule ?? null);

    return {
      area:           parseFloat(sb.areaM2 ?? '100'),  // default 100m² jika null
      water_height:   waterHeightM,
      optimal_height: optimalHeightM,
      elevation:      parseFloat(sb.elevationM ?? '0') + parseFloat(sb.elevationCalibration ?? '0'),
    };
  });

  // Build edges[] payload untuk Python (u, v, centroid_u, centroid_v)
  const edges: Array<{ u: number; v: number; centroid_u: string; centroid_v: string }> = [];
  const sbEwktMap = new Map(subBlockRows.map(sb => [sb.id, sb.centroidEwkt]));

  for (const conn of derivedConnections) {
    const u = uuidToIdx.get(conn.from);
    const v = uuidToIdx.get(conn.to);
    const cu = sbEwktMap.get(conn.from);
    const cv = sbEwktMap.get(conn.to);

    if (u === undefined || v === undefined || !cu || !cv) continue;
    edges.push({ u, v, centroid_u: cu, centroid_v: cv });
  }

  if (edges.length === 0) {
    logger.warn(logCtx, 'Water routing skipped — no valid edges could be built');
    return;
  }

  // ── 5. Panggil POST /api/floydwarshall/run ────────────────────────────────
  const gisUrl = config.GISPROC_API_BASE_URI;
  let dist: Array<Array<number | null>>;
  let successor: Array<Array<number | null>>;

  try {
    const runRes = await fetch(`${gisUrl}/api/floydwarshall/run`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        num_nodes: subBlockRows.length,
        nodes,
        edges,
        directed: true,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!runRes.ok) {
      const body = await runRes.text();
      throw new Error(`Floyd-Warshall /run returned ${runRes.status}: ${body.slice(0, 200)}`);
    }

    const runResult = await runRes.json() as { dist: typeof dist; successor: typeof successor };
    dist      = runResult.dist;
    successor = runResult.successor;
  } catch (err) {
    logger.error({ err, ...logCtx }, 'Floyd-Warshall /run call failed — routing aborted');
    return;
  }

  // ── 6. Pilih pasangan source-target prioritas tertinggi ───────────────────
  const source  = sources[0]!;
  const target  = targets[0]!;

  const srcIdx = uuidToIdx.get(source.sub_block_id);
  const tgtIdx = uuidToIdx.get(target.sub_block_id);

  if (srcIdx === undefined || tgtIdx === undefined) {
    logger.warn({ ...logCtx, source: source.sub_block_id, target: target.sub_block_id },
      'Water routing — source or target not found in sub-block index');
    return;
  }

  if (dist[srcIdx]?.[tgtIdx] === null || dist[srcIdx]?.[tgtIdx] === undefined) {
    logger.warn({ ...logCtx, srcIdx, tgtIdx },
      'Water routing — no reachable path from source (DRAIN) to target (IRRIGATE)');
    return;
  }

  // ── 7. Panggil POST /api/floydwarshall/matrix untuk rute detail ───────────
  let routePath: number[] | null;
  let routeWeight: number | null;

  try {
    const matRes = await fetch(`${gisUrl}/api/floydwarshall/matrix`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        matrix:    dist,
        successor,
        source:    srcIdx,
        target:    tgtIdx,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!matRes.ok) {
      const body = await matRes.text();
      throw new Error(`Floyd-Warshall /matrix returned ${matRes.status}: ${body.slice(0, 200)}`);
    }

    const matResult = await matRes.json() as { path: number[] | null; weight: number | null };
    routePath   = matResult.path;
    routeWeight = matResult.weight;
  } catch (err) {
    logger.error({ err, ...logCtx }, 'Floyd-Warshall /matrix call failed — routing aborted');
    return;
  }

  if (!routePath || routePath.length === 0) {
    logger.warn({ ...logCtx, srcIdx, tgtIdx }, 'Water routing — empty path returned');
    return;
  }

  // ── 8. Konversi path indeks → UUID ────────────────────────────────────────
  const routeUUIDs = routePath.map(idx => idxToUuid.get(idx)).filter((id): id is string => !!id);

  // ── 9. Update irrigation_recommendations baris IRRIGATE target ────────────
  const targetRec = recMap.get(target.sub_block_id);
  if (!targetRec) {
    logger.warn({ ...logCtx, targetSubBlock: target.sub_block_id },
      'Water routing — target recommendation row not found in DB');
    return;
  }

  await db.update(recsTable)
    .set({
      routePathIds:    routeUUIDs as unknown as object,
      routingScore:    routeWeight?.toFixed(4),
      fromSubBlockId:  source.sub_block_id,
    })
    .where(eq(recsTable.id, targetRec.id));

  logger.info(
    {
      ...logCtx,
      source:       source.sub_block_id,
      target:       target.sub_block_id,
      routeSteps:   routeUUIDs.length,
      routingScore: routeWeight,
    },
    '✅ Water routing complete — recommendation enriched',
  );
}
