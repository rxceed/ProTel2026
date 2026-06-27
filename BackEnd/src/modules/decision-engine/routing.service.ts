import { eq, and, sql, inArray } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  subBlocks as subBlocksTable,
  flowPaths as flowPathsTable,
  irrigationRuleProfiles as ruleProfilesTable,
  cropCycles as cropCyclesTable,
  embankments as embankmentsTable,
  fields as fieldsTable,
  irrigationPoints as irrigationPointsTable,
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
  sub_block_id: string;
  recommendation_type: string;
  priority_score: number;
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
  fieldId: string,
  jobId: string,
  recommendations: RecommendationInput[],
): Promise<void> {
  const logCtx = { fieldId, jobId };

  // ── 1. Filter: pisah DRAIN (sources) dan IRRIGATE (targets) ──────────────
  // Ambil ID rekomendasi dari DB untuk update nanti
  const savedRecs = await db.select({
    id: recsTable.id,
    subBlockId: recsTable.subBlockId,
    recommendationType: recsTable.recommendationType,
    priorityScore: recsTable.priorityScore,
    commandText: recsTable.commandText,
  })
    .from(recsTable)
    .where(and(
      eq(recsTable.fieldId, fieldId),
      eq(recsTable.decisionJobId, jobId),
    ));

  const recMap = new Map(savedRecs.map(r => [r.subBlockId, r]));

  const sources = recommendations
    .filter(r => r.recommendation_type === 'drain')
    .sort((a, b) => b.priority_score - a.priority_score);

  const targets = recommendations
    .filter(r => r.recommendation_type === 'irrigate')
    .sort((a, b) => b.priority_score - a.priority_score);

  // We don't skip if there's no imbalance anymore, because a DRAIN can go to an irrigation drain point,
  // and an IRRIGATE can come from an irrigation source point.
  if (sources.length === 0 && targets.length === 0) {
    logger.info(logCtx, 'Water routing skipped — no recommendations to process');
    return;
  }

  // ── 2. Ambil data graph dari DB ───────────────────────────────────────────
  // Sub-blocks: id, area, elevation, centroid sebagai EWKT
  const subBlockRows = await db
    .select({
      id:          subBlocksTable.id,
      code:        subBlocksTable.code,
      areaM2:      subBlocksTable.areaM2,
      elevationM:  subBlocksTable.elevationM,
      elevationCalibration: subBlocksTable.elevationCalibration,
      centroidEwkt: sql<string>`ST_AsEWKT(${subBlocksTable.centroid})`,
    })
    .from(subBlocksTable)
    .where(and(eq(subBlocksTable.fieldId, fieldId), eq(subBlocksTable.isActive, true)));

  if (subBlockRows.length < 1) {
    logger.warn(logCtx, 'Water routing skipped — no active sub-blocks');
    return;
  }

  // Load irrigation points
  const ipRows = await db
    .select({
      id: irrigationPointsTable.id,
      pointType: irrigationPointsTable.pointType,
      elevationM: irrigationPointsTable.elevationM,
      callibratedElevation: irrigationPointsTable.callibratedElevation,
      assignedSubBlocks: irrigationPointsTable.assignedSubBlocks,
      centroidEwkt: sql<string>`ST_AsEWKT(${irrigationPointsTable.coordinatePoint})`,
    })
    .from(irrigationPointsTable)
    .where(eq(irrigationPointsTable.fieldId, fieldId));

  const sourcePoints = ipRows.filter(ip => ip.pointType === 'source');
  const drainPoints = ipRows.filter(ip => ip.pointType === 'drain');

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
  const uuidToCode = new Map<string, string>();

  subBlockRows.forEach((sb) => {
    uuidToCode.set(sb.id, sb.code || sb.id.substring(0, 8));
  });

  const allNodes = [...subBlockRows, ...ipRows];

  allNodes.forEach((n, idx) => {
    uuidToIdx.set(n.id, idx);
    idxToUuid.set(idx, n.id);
  });

  const firstCalRow = subBlockRows.find(r => r.elevationCalibration !== null && r.elevationM !== null);
  const fieldCalibrationOffset = firstCalRow && firstCalRow.elevationCalibration && firstCalRow.elevationM
    ? parseFloat(firstCalRow.elevationCalibration.toString()) - parseFloat(firstCalRow.elevationM.toString())
    : 0;

  // Build nodes[] payload untuk Python
  const nodes = allNodes.map(n => {
    if ('pointType' in n) {
      return {
        area: 0.0001,
        water_height: fieldAvgM,
        optimal_height: fieldAvgM,
        elevation: n.callibratedElevation !== null
          ? parseFloat(n.callibratedElevation.toString())
          : parseFloat(n.elevationM ?? '0') + fieldCalibrationOffset,
      };
    }

    const state = stateMap.get(n.id);
    const waterRes = state
      ? resolveWaterHeight(state, fieldAvgM)
      : { waterHeightM: fieldAvgM, level: 3 as const };

    const waterHeightM = waterRes?.waterHeightM ?? fieldAvgM;
    const optimalHeightM = resolveOptimalHeight(n.id, cycleMap, ruleMap, defaultRule ?? null);

    return {
      area: parseFloat(n.areaM2 ?? '100'),
      water_height: waterHeightM,
      optimal_height: optimalHeightM,
      elevation: n.elevationCalibration !== null
        ? parseFloat(n.elevationCalibration.toString())
        : parseFloat(n.elevationM ?? '0'),
    };
  });

  // Build edges[] payload untuk Python (u, v, centroid_u, centroid_v)
  const edges: Array<{ u: number; v: number; centroid_u: string; centroid_v: string }> = [];
  const sbEwktMap = new Map(allNodes.map(n => [n.id, n.centroidEwkt]));

  for (const conn of derivedConnections) {
    const u = uuidToIdx.get(conn.from);
    const v = uuidToIdx.get(conn.to);
    const cu = sbEwktMap.get(conn.from);
    const cv = sbEwktMap.get(conn.to);

    if (u === undefined || v === undefined || !cu || !cv) continue;
    edges.push({ u, v, centroid_u: cu, centroid_v: cv });
  }

  // Add edges for irrigation points to their assigned sub-blocks
  ipRows.forEach(ip => {
    const ipIdx = uuidToIdx.get(ip.id);
    const ipEwkt = sbEwktMap.get(ip.id);
    if (ipIdx === undefined || !ipEwkt) return;

    (ip.assignedSubBlocks || []).forEach(sbId => {
      const sbIdx = uuidToIdx.get(sbId);
      const sbEwkt = sbEwktMap.get(sbId);
      if (sbIdx === undefined || !sbEwkt) return;

      if (ip.pointType === 'source') {
        edges.push({ u: ipIdx, v: sbIdx, centroid_u: ipEwkt, centroid_v: sbEwkt });
      } else if (ip.pointType === 'drain') {
        edges.push({ u: sbIdx, v: ipIdx, centroid_u: sbEwkt, centroid_v: ipEwkt });
      }
    });
  });

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
      method: 'POST',
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
    dist = runResult.dist;
    successor = runResult.successor;
  } catch (err) {
    logger.error({ err, ...logCtx }, 'Floyd-Warshall /run call failed — routing aborted');
    return;
  }

  // ── 6. Process routing for each IRRIGATE and DRAIN recommendation ────────────

  for (const target of targets) {
    const tgtIdx = uuidToIdx.get(target.sub_block_id);
    if (tgtIdx === undefined) continue;

    let bestSrcIdx = -1;
    let minWeight = Infinity;
    let bestSourceId = '';

    for (const srcPoint of sourcePoints) {
      const sIdx = uuidToIdx.get(srcPoint.id);
      if (sIdx !== undefined && dist[sIdx]?.[tgtIdx] !== null) {
        const w = dist[sIdx][tgtIdx] as number;
        if (w < minWeight) {
          minWeight = w;
          bestSrcIdx = sIdx;
          bestSourceId = srcPoint.id;
        }
      }
    }

    for (const srcSb of sources) {
      const sIdx = uuidToIdx.get(srcSb.sub_block_id);
      if (sIdx !== undefined && dist[sIdx]?.[tgtIdx] !== null) {
        const w = dist[sIdx][tgtIdx] as number;
        if (w < minWeight) {
          minWeight = w;
          bestSrcIdx = sIdx;
          bestSourceId = srcSb.sub_block_id;
        }
      }
    }

    if (bestSrcIdx === -1) continue;

    try {
      const matRes = await fetch(`${gisUrl}/api/floydwarshall/matrix`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matrix: dist, successor, source: bestSrcIdx, target: tgtIdx }),
      });
      if (!matRes.ok) continue;

      const matResult = await matRes.json() as { path: number[] | null; weight: number | null };
      if (matResult.path) {
        const routeUUIDs = matResult.path.map(idx => idxToUuid.get(idx)).filter(Boolean);
        const targetRec = recMap.get(target.sub_block_id);
        if (targetRec) {
          const isSourcePoint = sourcePoints.some(sp => sp.id === bestSourceId);
          let newCommandText = targetRec.commandText;
          const tgtCode = uuidToCode.get(target.sub_block_id);
          const srcCode = uuidToCode.get(bestSourceId);

          if (isSourcePoint) {
            newCommandText = `Buka pematang (sumber utama) untuk mengairi Kotak ${tgtCode}`;
          } else if (srcCode) {
            newCommandText = `Buka pematang antara Kotak ${srcCode} dan Kotak ${tgtCode} untuk mengalirkan air`;
          }

          await db.update(recsTable)
            .set({ routePathIds: routeUUIDs as object, routingScore: matResult.weight?.toFixed(4), fromSubBlockId: bestSourceId, commandText: newCommandText })
            .where(eq(recsTable.id, targetRec.id));
        }
      }
    } catch (err) {
      logger.error({ err }, 'Matrix fetch failed');
    }
  }

  for (const source of sources) {
    const srcIdx = uuidToIdx.get(source.sub_block_id);
    if (srcIdx === undefined) continue;

    let bestTgtIdx = -1;
    let minWeight = Infinity;
    let bestTargetId = '';

    for (const drainPoint of drainPoints) {
      const tIdx = uuidToIdx.get(drainPoint.id);
      if (tIdx !== undefined && dist[srcIdx]?.[tIdx] !== null) {
        const w = dist[srcIdx][tIdx] as number;
        if (w < minWeight) {
          minWeight = w;
          bestTgtIdx = tIdx;
          bestTargetId = drainPoint.id;
        }
      }
    }

    for (const tgtSb of targets) {
      const tIdx = uuidToIdx.get(tgtSb.sub_block_id);
      if (tIdx !== undefined && dist[srcIdx]?.[tIdx] !== null) {
        const w = dist[srcIdx][tIdx] as number;
        if (w < minWeight) {
          minWeight = w;
          bestTgtIdx = tIdx;
          bestTargetId = tgtSb.sub_block_id;
        }
      }
    }

    if (bestTgtIdx === -1) continue;

    try {
      const matRes = await fetch(`${gisUrl}/api/floydwarshall/matrix`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matrix: dist, successor, source: srcIdx, target: bestTgtIdx }),
      });
      if (!matRes.ok) continue;

      const matResult = await matRes.json() as { path: number[] | null; weight: number | null };
      if (matResult.path) {
        const routeUUIDs = matResult.path.map(idx => idxToUuid.get(idx)).filter(Boolean);
        const sourceRec = recMap.get(source.sub_block_id);
        if (sourceRec) {
          const isDrainPoint = drainPoints.some(dp => dp.id === bestTargetId);
          let newCommandText = sourceRec.commandText;
          const srcCode = uuidToCode.get(source.sub_block_id);
          const tgtCode = uuidToCode.get(bestTargetId);

          if (isDrainPoint) {
            newCommandText = `Buka pematang (pembuangan luar) untuk membuang genangan dari Kotak ${srcCode}`;
          } else if (tgtCode) {
            newCommandText = `Buka pematang antara Kotak ${srcCode} dan Kotak ${tgtCode} untuk membuang genangan`;
          }

          await db.update(recsTable)
            .set({ routePathIds: routeUUIDs as object, routingScore: matResult.weight?.toFixed(4), toSubBlockId: bestTargetId, commandText: newCommandText })
            .where(eq(recsTable.id, sourceRec.id));
        }
      }
    } catch (err) {
      logger.error({ err }, 'Matrix fetch failed');
    }
  }

  logger.info({ ...logCtx }, '✅ Water routing complete — recommendation enriched');
}
