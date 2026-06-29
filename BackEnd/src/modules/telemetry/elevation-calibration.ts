import { eq, and, sql, desc } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  subBlocks as subBlocksTable,
  devices as devicesTable,
} from '@/db/schema/mst';
import { telemetryRecords as telemetryRecordsTable } from '@/db/schema/trx';

export async function recalibrateFieldElevations(
  fieldId: string,
  incomingSubBlockId?: string | null,
  incomingPressure?: number | null
): Promise<void> {
  // 1. Fetch all subblocks in the field with their centroid coordinates
  const subBlocks = await db.select({
    id: subBlocksTable.id,
    elevationM: subBlocksTable.elevationM,
    x: sql<number | null>`ST_X(${subBlocksTable.centroid})`,
    y: sql<number | null>`ST_Y(${subBlocksTable.centroid})`,
  })
    .from(subBlocksTable)
    .where(eq(subBlocksTable.fieldId, fieldId));

  if (subBlocks.length === 0) return;

  // 2. Fetch all telemetry records with pressure for devices assigned to subblocks in this field, ordered by timestamp
  const telemetryRows = await db.select({
    subBlockId: devicesTable.subBlockId,
    pressure: telemetryRecordsTable.pressure,
  })
    .from(telemetryRecordsTable)
    .innerJoin(devicesTable, eq(devicesTable.id, telemetryRecordsTable.deviceId))
    .where(and(
      eq(devicesTable.fieldId, fieldId),
      sql`${devicesTable.subBlockId} IS NOT NULL`,
      sql`${telemetryRecordsTable.pressure} IS NOT NULL`
    ))
    .orderBy(desc(telemetryRecordsTable.eventTimestamp));

  // 3. Map subBlockId to its latest pressure reading
  const subBlockPressureMap = new Map<string, number>();
  for (const row of telemetryRows) {
    if (row.subBlockId && row.pressure !== null && row.pressure !== undefined && !subBlockPressureMap.has(row.subBlockId)) {
      subBlockPressureMap.set(row.subBlockId, parseFloat(row.pressure.toString()));
    }
  }

  // 4. Incorporate incoming telemetry if present
  if (incomingSubBlockId && incomingPressure !== undefined && incomingPressure !== null) {
    subBlockPressureMap.set(incomingSubBlockId, incomingPressure);
  }

  // 5. Filter subblocks that have pressure data
  const subBlocksWithPressure = subBlocks.filter(sb => subBlockPressureMap.has(sb.id));

  // If there is no pressure data in the field, we cannot calibrate, so we return
  if (subBlocksWithPressure.length === 0) return;

  // 6. Calibrate each subblock
  for (const sb of subBlocks) {
    let sbNear = null;
    let minDistance = Infinity;

    // Find the nearest subblock that has pressure data
    for (const pSb of subBlocksWithPressure) {
      const dx = (sb.x || 0) - (pSb.x || 0);
      const dy = (sb.y || 0) - (pSb.y || 0);
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < minDistance) {
        minDistance = dist;
        sbNear = pSb;
      }
    }

    if (sbNear) {
      const pressureVal = subBlockPressureMap.get(sbNear.id)!;
      // Formula: elevationVal derived from atmospheric pressure
      const elevationVal = 44330 * (1 - Math.pow(pressureVal / 1013.25, 0.1903));
      const sbElevationM = sb.elevationM ? parseFloat(sb.elevationM.toString()) : 0;

      // Calibration is derived from: calibrated elevation using atmospheric pressure + elevation_m
      const calibratedElevation = elevationVal + sbElevationM;

      await db.update(subBlocksTable)
        .set({
          elevationCalibration: calibratedElevation.toFixed(2),
          updatedAt: new Date(),
        })
        .where(eq(subBlocksTable.id, sb.id));
    }
  }
}
