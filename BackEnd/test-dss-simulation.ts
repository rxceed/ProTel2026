import {
  resolveWaterHeight,
  computeFieldAvgWaterM,
  resolveOptimalHeight
} from './src/modules/decision-engine/node-resolver';

// Dummy data simulasi 4 sub-block dalam 1 field
const states = [
  // L1: Fresh (Sensor nyala dan akurat)
  { subBlockId: 'SB-1', waterLevelCm: '2.50', stateSource: 'observed', freshnessStatus: 'fresh', interpolationConfidence: null },
  // L2: Estimated (Sensor mati, tapi estimator jalan)
  { subBlockId: 'SB-2', waterLevelCm: '3.00', stateSource: 'estimated', freshnessStatus: 'stale', interpolationConfidence: '0.95' },
  // L3: No Data (Sensor mati, estimator gagal, ambil rata-rata field)
  { subBlockId: 'SB-3', waterLevelCm: null, stateSource: 'no_data', freshnessStatus: 'no_data', interpolationConfidence: null },
  // L1: Fresh (Sensor nyala, kebanjiran)
  { subBlockId: 'SB-4', waterLevelCm: '10.0', stateSource: 'observed', freshnessStatus: 'fresh', interpolationConfidence: null },
] as any[];

console.log("=== UJI SIMULASI: FIELD DENGAN 4 NODE ===");

// Hitung field avg
const fieldAvgM = computeFieldAvgWaterM(states);
console.log(`\n1. Rata-Rata Tinggi Air Lapangan (M): ${fieldAvgM?.toFixed(4)}`);

// Resolusi tiap node
states.forEach(s => {
  const res = resolveWaterHeight(s, fieldAvgM);
  console.log(`Node ${s.subBlockId} | Source: ${s.stateSource.padEnd(9)} | Resolusi (M): ${res?.waterHeightM.toFixed(4)} | Level Fallback: L${res?.level}`);
});

// Simulasi L4: Lahan mati total
const deadStates = [
  { subBlockId: 'SB-1', waterLevelCm: null, stateSource: 'no_data', freshnessStatus: 'no_data', interpolationConfidence: null },
  { subBlockId: 'SB-2', waterLevelCm: null, stateSource: 'no_data', freshnessStatus: 'no_data', interpolationConfidence: null },
] as any[];

console.log("\n=== UJI SIMULASI L4: LAHAN MATI TOTAL ===");
const deadAvgM = computeFieldAvgWaterM(deadStates);
console.log(`Rata-Rata Lahan: ${deadAvgM}`);
const resDead = resolveWaterHeight(deadStates[0], deadAvgM);
console.log(`Resolusi Node: ${resDead === null ? 'NULL (Abaikan Routing / Abort)' : resDead}`);

console.log("\n=== UJI SIMULASI: OPTIMAL HEIGHT (AWD RULES) ===");
const cycleMap = new Map([
  ['SB-1', { subBlockId: 'SB-1', ruleProfileId: 'RULE-A' }],
  ['SB-2', { subBlockId: 'SB-2', ruleProfileId: null }],
] as any);

const ruleMap = new Map([
  ['RULE-A', { awdUpperTargetCm: '4.50' }]
] as any);

const defaultRule = { awdUpperTargetCm: '3.00' } as any;

console.log(`Node SB-1 (Punya Spesifik Rule 4.5cm)   : ${resolveOptimalHeight('SB-1', cycleMap as any, ruleMap as any, defaultRule)} m`);
console.log(`Node SB-2 (Tidak Punya, pakai Default 3cm): ${resolveOptimalHeight('SB-2', cycleMap as any, ruleMap as any, defaultRule)} m`);
console.log(`Node SB-3 (Tidak Ada Cycle, Fallback 5cm) : ${resolveOptimalHeight('SB-3', cycleMap as any, ruleMap as any, defaultRule)} m`);
