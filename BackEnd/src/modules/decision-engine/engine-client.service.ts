import { eq, and, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { db } from '@/db/client';
import {
  subBlocks as subBlocksTable,
  cropCycles as cropCyclesTable,
  irrigationRuleProfiles as ruleProfilesTable,
  flowPaths as flowPathsTable,
  users as usersTable,
} from '@/db/schema/mst';
import {
  decisionJobs as jobsTable,
  subBlockCurrentStates as currentStatesTable,
  irrigationRecommendations as recsTable,
  managementEvents as managementEventsTable,
} from '@/db/schema';
import { getLatestForecast, getActiveWarnings } from '@/modules/weather/bmkg.service';
import { buildFieldStates } from '@/modules/state-builder/state-builder.service';
import { runWaterRouting } from './routing.service';
import { config } from '@/config';
import { logger } from '@/shared/utils/logger.util';

// ---------------------------------------------------------------------------
// Server 2 API contract types (mirrors Pydantic schemas in Model service)
// ---------------------------------------------------------------------------

interface SubBlockStatePayload {
  water_level_cm: number | null;
  state_source: string;
  freshness_status: string;
  last_observation_at: string | null;
  interpolation_confidence: number | null;
}

interface RuleProfilePayload {
  id: string;
  awd_lower_threshold_cm: number;
  awd_upper_target_cm: number;
  drought_alert_cm: number | null;
  priority_weight: number;
  rain_delay_mm: number;
  target_confidence: string;
  rainfed_modifier_pct: number;
}

interface ManagementFlagPayload {
  event_type: string;
  flag_text: string | null;
  expires_at: string;
}

interface FlowPathPayload {
  to_sub_block_id: string;
  from_sub_block_id: string;
  flow_type: string;
}

interface SubBlockInputPayload {
  id: string;
  code: string | null;
  state: SubBlockStatePayload;
  crop_cycle: { bucket_code: string; phase_code: string; hst: number; variety_name: string | null } | null;
  rule_profile: RuleProfilePayload | null;
  management_flags: ManagementFlagPayload[];
  flow_paths: FlowPathPayload[];
}

interface EvaluateRequest {
  job_id: string;
  field_id: string;
  cycle_mode: string;
  field_context: { water_source_type: string; operator_count: number };
  sub_blocks: SubBlockInputPayload[];
  weather: {
    rain_events: any[]; // RainEvent[] dari full_response_json
    peak_intensity_mm: number | null;
    bmkg_category: string | null;
    temperature_c: number | null;
    humidity_pct: number | null;
    is_stale: boolean;
  };

  active_warnings: { warning_type: string | null; warning_level: string | null; dss_action: string; warning_text: string | null }[];
}

interface RecommendationResult {
  sub_block_id: string;
  recommendation_type: string;
  priority_rank: number;
  priority_score: number;
  from_sub_block_id: string | null;
  to_sub_block_id: string | null;
  command_template_code: string;
  command_text: string;
  reason_summary: string;
  confidence_level: string;
  attention_flags_json: object | null;
  operator_warning_text: string | null;
}

interface EvaluateResponse {
  job_id: string;
  engine_version: string;
  evaluated_at: string;
  recommendations: RecommendationResult[];
}

// ---------------------------------------------------------------------------
// Main function: run one decision cycle for a field
// ---------------------------------------------------------------------------
export async function runDecisionCycleForField(
  fieldId: string,
  cycleMode: string,
): Promise<void> {
  const jobId = randomUUID();

  // 1. Create decision_job record
  await db.insert(jobsTable).values({
    id: jobId,
    fieldId,
    cycleMode,
    status: 'pending',
    startedAt: new Date(),
  });

  try {
    logger.info({ jobId, fieldId, cycleMode }, 'Decision cycle starting');

    // 2. Refresh state for all sub-blocks (fresh data before evaluation)
    await buildFieldStates(fieldId);

    // 3. Load all active sub-blocks with full context
    const subBlocks = await db
      .select({
        id: subBlocksTable.id,
        code: subBlocksTable.code,
        waterSourceType: sql<string>`'irrigated'`, // from field, simplified
      })
      .from(subBlocksTable)
      .where(and(eq(subBlocksTable.fieldId, fieldId), eq(subBlocksTable.isActive, true)))
      .orderBy(subBlocksTable.displayOrder, subBlocksTable.name);

    if (subBlocks.length === 0) {
      await db.update(jobsTable).set({ status: 'skipped', completedAt: new Date() }).where(eq(jobsTable.id, jobId));
      return;
    }

    // 4. Load current states
    const stateRows = await db.select().from(currentStatesTable)
      .where(eq(currentStatesTable.fieldId, fieldId));
    const stateMap = new Map(stateRows.map(s => [s.subBlockId, s]));

    // 5. Load active crop cycles
    const cycles = await db.select().from(cropCyclesTable)
      .where(and(eq(cropCyclesTable.fieldId, fieldId), eq(cropCyclesTable.status, 'active')));
    const cycleMap = new Map(cycles.map(c => [c.subBlockId, c]));

    // 6. Load rule profiles (merge: crop-cycle specific → default)
    const ruleIds = [...new Set(cycles.map(c => c.ruleProfileId).filter(Boolean))] as string[];
    const ruleMap = new Map<string, typeof ruleProfilesTable.$inferSelect>();
    if (ruleIds.length > 0) {
      const rules = await db.select().from(ruleProfilesTable)
        .where(and(
          sql`${ruleProfilesTable.id} = ANY(${ruleIds})`,
          eq(ruleProfilesTable.isActive, true),
        ));
      rules.forEach(r => ruleMap.set(r.id, r));
    }

    // 7. Load management flags (active now)
    const flagRows = await db.select().from(managementEventsTable)
      .where(and(
        eq(managementEventsTable.fieldId, fieldId),
        sql`${managementEventsTable.flagExpiresAt} > NOW()`,
      ));
    const flagMap = new Map<string, typeof managementEventsTable.$inferSelect[]>();
    flagRows.forEach(f => {
      if (!f.subBlockId) return;
      const arr = flagMap.get(f.subBlockId) ?? [];
      arr.push(f);
      flagMap.set(f.subBlockId, arr);
    });

    // 8. Load flow paths / matrix for field
    const [flowPath] = await db.select().from(flowPathsTable)
      .where(and(
        eq(flowPathsTable.fieldId, fieldId),
        eq(flowPathsTable.isActive, true),
      ))
      .limit(1);

    const allFlowPaths = flowPath && flowPath.floydWarshallMatrix
      ? getDirectEdgesFromMatrix(flowPath.floydWarshallMatrix, subBlocks, flowPath.flowType)
      : [];

    // 9. Load weather + warnings
    const forecast = await getLatestForecast(fieldId);
    const warnings = await getActiveWarnings(fieldId);

    // 10. Build request payload for Server 2
    const subBlocksPayload: SubBlockInputPayload[] = subBlocks.map(sb => {
      const state = stateMap.get(sb.id);
      const cycle = cycleMap.get(sb.id);
      const rule = cycle?.ruleProfileId ? ruleMap.get(cycle.ruleProfileId) : null;
      const flags = flagMap.get(sb.id) ?? [];
      const sbFlows = allFlowPaths.filter(fp => fp.fromSubBlockId === sb.id || fp.toSubBlockId === sb.id);

      return {
        id: sb.id,
        code: sb.code,
        state: {
          water_level_cm: state?.waterLevelCm ? parseFloat(state.waterLevelCm) : null,
          state_source: state?.stateSource ?? 'no_data',
          freshness_status: state?.freshnessStatus ?? 'no_data',
          last_observation_at: state?.lastObservationAt?.toISOString() ?? null,
          interpolation_confidence: state?.interpolationConfidence ? parseFloat(state.interpolationConfidence) : null,
        },
        crop_cycle: cycle ? {
          bucket_code: cycle.bucketCode,
          phase_code: cycle.currentPhaseCode,
          hst: cycle.currentHst,
          variety_name: cycle.varietyName,
        } : null,
        rule_profile: rule ? {
          id: rule.id,
          awd_lower_threshold_cm: parseFloat(rule.awdLowerThresholdCm),
          awd_upper_target_cm: parseFloat(rule.awdUpperTargetCm),
          drought_alert_cm: rule.droughtAlertCm ? parseFloat(rule.droughtAlertCm) : null,
          priority_weight: parseFloat(rule.priorityWeight),
          rain_delay_mm: parseFloat(rule.rainDelayMm),
          target_confidence: rule.targetConfidence,
          rainfed_modifier_pct: parseFloat(rule.rainfedModifierPct),
        } : null,
        management_flags: flags.map(f => ({
          event_type: f.eventType,
          flag_text: f.attentionFlagText,
          expires_at: f.flagExpiresAt?.toISOString() ?? new Date().toISOString(),
        })),
        flow_paths: sbFlows.map(fp => ({
          from_sub_block_id: fp.fromSubBlockId,
          to_sub_block_id: fp.toSubBlockId,
          flow_type: fp.flowType,
        })),
      };
    });

    const isStale = !forecast || (Date.now() - (forecast.fetchedAt?.getTime() ?? 0)) > 6 * 3_600_000;
    const evalRequest: EvaluateRequest = {
      job_id: jobId,
      field_id: fieldId,
      cycle_mode: cycleMode,
      field_context: { water_source_type: 'irrigated', operator_count: 1 },
      sub_blocks: subBlocksPayload,
      weather: {
        rain_events: (forecast?.fullResponseJson as any)?.rain_events ?? [],
        peak_intensity_mm: forecast?.precipitationMm ? parseFloat(forecast.precipitationMm) : null,
        bmkg_category: forecast?.bmkgCategory ?? null,
        temperature_c: forecast?.temperatureC ? parseFloat(forecast.temperatureC) : null,
        humidity_pct: forecast?.humidityPct ? parseFloat(forecast.humidityPct) : null,
        is_stale: isStale,
      },

      active_warnings: warnings.map(w => ({
        warning_type: w.warningType,
        warning_level: w.warningLevel,
        dss_action: w.dssAction ?? 'none',
        warning_text: w.warningText,
      })),
    };

    // 11. POST to Server 2
    await db.update(jobsTable).set({ status: 'running' }).where(eq(jobsTable.id, jobId));

    const response = await fetch(`${config.DECISION_ENGINE_URL}/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(evalRequest),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Server 2 returned ${response.status}: ${body.slice(0, 200)}`);
    }

    const result = await response.json() as EvaluateResponse;

    // 12. Store recommendations
    const validUntil = new Date(Date.now() + (cycleMode === 'siaga' ? 30 : 60) * 60_000);

    for (const rec of result.recommendations) {
      await db.insert(recsTable).values({
        decisionJobId: jobId,
        fieldId,
        subBlockId: rec.sub_block_id,
        recommendationType: rec.recommendation_type,
        priorityRank: rec.priority_rank,
        priorityScore: rec.priority_score.toString(),
        fromSubBlockId: rec.from_sub_block_id,
        toSubBlockId: rec.to_sub_block_id,
        commandTemplateCode: rec.command_template_code,
        commandText: rec.command_text,
        reasonSummary: rec.reason_summary,
        confidenceLevel: rec.confidence_level,
        attentionFlagsJson: rec.attention_flags_json as object,
        operatorWarningText: rec.operator_warning_text,
        validUntil,
        engineVersion: result.engine_version,
        feedbackStatus: 'pending',
      }).onConflictDoNothing(); // idempotent re-runs
    }

    // 13. Mark job complete
    await db.update(jobsTable).set({
      status: 'completed',
      completedAt: new Date(),
      recommendationsGenerated: result.recommendations.length,
    }).where(eq(jobsTable.id, jobId));

    logger.info(
      { jobId, fieldId, recs: result.recommendations.length, engineVersion: result.engine_version },
      'Decision cycle complete',
    );

    // 14. Trigger water routing asynchronously (ideal case)
    setImmediate(() => {
      runWaterRouting(fieldId, jobId, result.recommendations).catch(err =>
        logger.error({ err, jobId, fieldId }, 'Water routing failed — non-blocking')
      );
    });
  } catch (err) {
    await db.update(jobsTable).set({
      status: 'failed',
      completedAt: new Date(),
      errorMessage: String(err),
    }).where(eq(jobsTable.id, jobId));

    logger.error({ err, jobId, fieldId }, 'Decision cycle failed');
    throw err;
  }
}

function getDirectEdgesFromMatrix(
  matrixJson: any,
  subBlocks: { id: string }[],
  flowType: string
): { fromSubBlockId: string; toSubBlockId: string; flowType: string }[] {
  if (!matrixJson || typeof matrixJson !== 'object') return [];

  const successor = Array.isArray(matrixJson.successor)
    ? matrixJson.successor
    : Array.isArray(matrixJson.successors)
      ? matrixJson.successors
      : null;

  if (!successor || !Array.isArray(successor)) return [];

  const edges: { fromSubBlockId: string; toSubBlockId: string; flowType: string }[] = [];

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
            fromSubBlockId: fromSb.id,
            toSubBlockId: toSb.id,
            flowType: flowType,
          });
        }
      }
    }
  }

  return edges;
}
