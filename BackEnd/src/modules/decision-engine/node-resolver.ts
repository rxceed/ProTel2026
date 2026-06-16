import type { InferSelectModel } from 'drizzle-orm';
import type { subBlockCurrentStates, irrigationRuleProfiles, cropCycles } from '@/db/schema';

type CurrentState = Pick<
  InferSelectModel<typeof subBlockCurrentStates>,
  'subBlockId' | 'waterLevelCm' | 'stateSource' | 'freshnessStatus' | 'interpolationConfidence'
>;

type RuleProfile = Pick<InferSelectModel<typeof irrigationRuleProfiles>, 'awdUpperTargetCm'>;
type CropCycle  = Pick<InferSelectModel<typeof cropCycles>, 'subBlockId' | 'ruleProfileId'>;

// ---------------------------------------------------------------------------
// Resolusi water_height per node (dalam meter) — 4 level fallback
// ---------------------------------------------------------------------------

export interface NodeWaterResolution {
  waterHeightM: number;
  level:        1 | 2 | 3 | 4;
}

/**
 * Menentukan water_height (meter) untuk satu node berdasarkan ketersediaan data.
 *
 * L1: data observasi segar/stale          → gunakan langsung
 * L2: data estimasi (interpolasi tetangga) → gunakan langsung
 * L3: no_data tapi field punya data lain  → gunakan rata-rata field
 * L4: seluruh field no_data               → return null (skip routing)
 */
export function resolveWaterHeight(
  nodeState:    CurrentState,
  fieldAvgM:    number | null,  // rata-rata dari semua node L1/L2 dalam field (sudah dalam meter)
): NodeWaterResolution | null {
  const { stateSource, freshnessStatus, interpolationConfidence, waterLevelCm } = nodeState;

  // L1: data aktual dari sensor, masih segar atau stale (tapi masih usable)
  if (
    stateSource === 'observed' &&
    (freshnessStatus === 'fresh' || freshnessStatus === 'stale') &&
    waterLevelCm !== null
  ) {
    return { waterHeightM: parseFloat(waterLevelCm) / 100, level: 1 };
  }

  // L2: data hasil interpolasi dari tetangga via estimator.ts
  if (
    stateSource === 'estimated' &&
    interpolationConfidence !== null &&
    parseFloat(interpolationConfidence) > 0 &&
    waterLevelCm !== null
  ) {
    return { waterHeightM: parseFloat(waterLevelCm) / 100, level: 2 };
  }

  // L3: tidak ada data, tapi field secara keseluruhan punya data → pakai rata-rata
  if (fieldAvgM !== null) {
    return { waterHeightM: fieldAvgM, level: 3 };
  }

  // L4: seluruh field no_data → tidak ada informasi sama sekali
  return null;
}

/**
 * Hitung rata-rata water level (meter) dari semua node dalam satu field
 * yang punya data valid (L1 atau L2). Digunakan sebagai fallback L3.
 * Return null jika tidak ada node yang punya data (kondisi L4).
 */
export function computeFieldAvgWaterM(states: CurrentState[]): number | null {
  const validLevels = states.filter(s => {
    const isL1 = s.stateSource === 'observed' &&
      (s.freshnessStatus === 'fresh' || s.freshnessStatus === 'stale') &&
      s.waterLevelCm !== null;
    const isL2 = s.stateSource === 'estimated' &&
      s.interpolationConfidence !== null &&
      parseFloat(s.interpolationConfidence!) > 0 &&
      s.waterLevelCm !== null;
    return isL1 || isL2;
  });

  if (validLevels.length === 0) return null;

  const sumM = validLevels.reduce((acc, s) => acc + parseFloat(s.waterLevelCm!) / 100, 0);
  return sumM / validLevels.length;
}

// ---------------------------------------------------------------------------
// Resolusi optimal_height per node (dalam meter)
// ---------------------------------------------------------------------------

/**
 * Menentukan optimal_height (meter) untuk satu node.
 *
 * Hierarki:
 *   1. Crop cycle aktif dengan rule profile → awd_upper_target_cm / 100
 *   2. Tidak ada rule profile tapi ada crop cycle → defaultRule.awd_upper_target_cm / 100
 *   3. Tidak ada crop cycle → 0.05m (5cm, standar AWD minimum konservatif)
 */
export function resolveOptimalHeight(
  subBlockId:  string,
  cycleMap:    Map<string, CropCycle>,
  ruleMap:     Map<string, RuleProfile>,
  defaultRule: RuleProfile | null,
): number {
  const cycle = cycleMap.get(subBlockId);
  if (!cycle) return 0.05; // tidak ada crop cycle → fallback 5cm

  const rule = cycle.ruleProfileId ? ruleMap.get(cycle.ruleProfileId) : null;
  if (rule) return parseFloat(rule.awdUpperTargetCm) / 100;

  // Ada crop cycle tapi tidak ada rule profile spesifik → pakai default
  if (defaultRule) return parseFloat(defaultRule.awdUpperTargetCm) / 100;

  return 0.05; // ultimate fallback
}
