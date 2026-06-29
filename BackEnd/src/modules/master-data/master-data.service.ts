import { eq, and, sql, desc, count } from 'drizzle-orm';
import { db, pool } from '@/db/client';
import {
  fields as fieldsTable,
  users as usersTable,
  userFields as userFieldsTable,
  subBlocks as subBlocksTable,
  embankments as embankmentsTable,
  devices as devicesTable,
  deviceAssignments as deviceAssignmentsTable,
  sensorCalibrations as sensorCalibrationsTable,
  flowPaths as flowPathsTable,
  cropCycles as cropCyclesTable,
  irrigationRuleProfiles as ruleProfilesTable,
  irrigationPoints as irrigationPointsTable,
} from '@/db/schema/mst';
import { managementEvents as managementEventsTable } from '@/db/schema';
import { telemetryRecords as telemetryRecordsTable } from '@/db/schema/trx';
import { recalibrateFieldElevations } from '../telemetry/elevation-calibration';
import { AppError } from '@/middleware/error.middleware';
import { parsePagination, buildPaginationMeta } from '@/shared/utils/pagination.util';
import type {
  CreateFieldSchema,
  UpdateFieldSchema,
  AssignUserFieldSchema,
  CreateSubBlockSchema,
  UpdateSubBlockSchema,
  ImportSubBlocksSchema,
  CreateDeviceSchema,
  AssignDeviceSchema,
  CalibrateDeviceSchema,
  CreateFlowPathSchema,
  UpdateFlowPathSchema,
  CreateCropCycleSchema,
  UpdateCropCyclePhaseSchema,
  CreateRuleProfileSchema,
  CreateIrrigationPointSchema,
  UpdateIrrigationPointSchema,
  CreateEmbankmentSchema,
  UpdateEmbankmentSchema,
  ImportEmbankmentSchema,
} from './master-data.schema';
import type { z } from 'zod';
import { config } from '@/config';

type CreateFieldInput          = z.infer<typeof CreateFieldSchema>;
type UpdateFieldInput          = z.infer<typeof UpdateFieldSchema>;
type AssignUserFieldInput      = z.infer<typeof AssignUserFieldSchema>;
type CreateSubBlockInput       = z.infer<typeof CreateSubBlockSchema>;
type UpdateSubBlockInput       = z.infer<typeof UpdateSubBlockSchema>;
type ImportSubBlocksInput      = z.infer<typeof ImportSubBlocksSchema>;
type CreateDeviceInput         = z.infer<typeof CreateDeviceSchema>;
type AssignDeviceInput         = z.infer<typeof AssignDeviceSchema>;
type CalibrateDeviceInput      = z.infer<typeof CalibrateDeviceSchema>;
type CreateFlowPathInput       = z.infer<typeof CreateFlowPathSchema>;
type UpdateFlowPathInput       = z.infer<typeof UpdateFlowPathSchema>;
type CreateCropCycleInput      = z.infer<typeof CreateCropCycleSchema>;
type UpdateCropCyclePhaseInput = z.infer<typeof UpdateCropCyclePhaseSchema>;
type CreateRuleProfileInput    = z.infer<typeof CreateRuleProfileSchema>;
type CreateIrrigationPointInput = z.infer<typeof CreateIrrigationPointSchema>;
type UpdateIrrigationPointInput = z.infer<typeof UpdateIrrigationPointSchema>;
type CreateEmbankmentInput      = z.infer<typeof CreateEmbankmentSchema>;
type UpdateEmbankmentInput      = z.infer<typeof UpdateEmbankmentSchema>;
type ImportEmbankmentInput      = z.infer<typeof ImportEmbankmentSchema>;

// ===========================================================================
// FIELDS
// ===========================================================================

export const fieldsService = {
  async list(userId: string, isAdmin: boolean, query: Record<string, unknown>) {
    const { page, limit, offset } = parsePagination(query);

    // Admin melihat semua field; user lain hanya yang punya akses
    let rows: (typeof fieldsTable.$inferSelect)[];
    let total = 0;

    if (isAdmin) {
      [rows, [{ value: total }]] = await Promise.all([
        db.select().from(fieldsTable).where(eq(fieldsTable.isActive, true))
          .orderBy(fieldsTable.name).limit(limit).offset(offset),
        db.select({ value: count() }).from(fieldsTable).where(eq(fieldsTable.isActive, true)),
      ]);
    } else {
      const userFieldsSubQuery = db
        .select({ fieldId: userFieldsTable.fieldId })
        .from(userFieldsTable)
        .where(eq(userFieldsTable.userId, userId));

      [rows, [{ value: total }]] = await Promise.all([
        db.select().from(fieldsTable)
          .where(and(
            eq(fieldsTable.isActive, true),
            sql`${fieldsTable.id} IN (${userFieldsSubQuery})`,
          ))
          .orderBy(fieldsTable.name).limit(limit).offset(offset),
        db.select({ value: count() }).from(fieldsTable)
          .where(and(
            eq(fieldsTable.isActive, true),
            sql`${fieldsTable.id} IN (${userFieldsSubQuery})`,
          )),
      ]);
    }

    return { rows, meta: buildPaginationMeta({ page, limit, offset }, total) };
  },

  async getById(fieldId: string) {
    const [field] = await db
      .select()
      .from(fieldsTable)
      .where(and(eq(fieldsTable.id, fieldId), eq(fieldsTable.isActive, true)))
      .limit(1);
    if (!field) throw new AppError(404, 'FIELD_NOT_FOUND', 'Field tidak ditemukan');
    return field;
  },

  async create(input: CreateFieldInput, createdByUserId: string) {
    const GISPROC_API_BASE_URI = config.GISPROC_API_BASE_URI as string
    const [field] = await db
      .insert(fieldsTable)
      .values({
        name:                   input.name,
        description:            input.description,
        adm4Code:               input.adm4_code,
        waterSourceType:        input.water_source_type,
        areaHectares:           input.area_hectares?.toString(),
        operatorCountDefault:   input.operator_count_default,
        decisionCycleMode:      input.decision_cycle_mode,
        notes:                  input.notes,
        mapVisualUrl:           `${GISPROC_API_BASE_URI}/webodm/display?project_name=${createdByUserId}&task_name=${input.name}&asset_type=orthophoto.tif`,
        assignedFileName:       input.assigned_file_name,
        mapHeaders:             input.map_headers,
        irrigationEdges:        input.irrigation_edges,
        irrigationNodes:        input.irrigation_nodes,
      })
      .returning();

    // Auto-grant manager access to creator (jika bukan system_admin)
    await db.insert(userFieldsTable).values({
      userId:    createdByUserId,
      fieldId:   field!.id,
      fieldRole: 'manager',
      grantedBy: createdByUserId,
    }).onConflictDoNothing();

    return field!;
  },

  async update(fieldId: string, input: UpdateFieldInput) {
    const [updated] = await db
      .update(fieldsTable)
      .set({
        ...(input.name                  !== undefined && { name: input.name }),
        ...(input.description           !== undefined && { description: input.description }),
        ...(input.adm4_code             !== undefined && { adm4Code: input.adm4_code }),
        ...(input.water_source_type     !== undefined && { waterSourceType: input.water_source_type }),
        ...(input.area_hectares         !== undefined && { areaHectares: input.area_hectares.toString() }),
        ...(input.operator_count_default !== undefined && { operatorCountDefault: input.operator_count_default }),
        ...(input.decision_cycle_mode   !== undefined && { decisionCycleMode: input.decision_cycle_mode }),
        ...(input.is_source_depleted    !== undefined && { isSourceDepleted: input.is_source_depleted }),
        ...(input.notes                 !== undefined && { notes: input.notes }),
        ...(input.assigned_file_name    !== undefined && { assignedFileName: input.assigned_file_name }),
        ...(input.map_headers           !== undefined && { mapHeaders: input.map_headers }),
        ...(input.irrigation_edges      !== undefined && { irrigationEdges: input.irrigation_edges }),
        ...(input.irrigation_nodes      !== undefined && { irrigationNodes: input.irrigation_nodes }),
        updatedAt: new Date(),
      })
      .where(eq(fieldsTable.id, fieldId))
      .returning();

    if (!updated) throw new AppError(404, 'FIELD_NOT_FOUND', 'Field tidak ditemukan');
    return updated;
  },

  async updateDroughtStatus(fieldId: string, isSourceDepleted: boolean) {
    const [updated] = await db
      .update(fieldsTable)
      .set({
        isSourceDepleted,
        updatedAt: new Date(),
      })
      .where(eq(fieldsTable.id, fieldId))
      .returning();

    if (!updated) throw new AppError(404, 'FIELD_NOT_FOUND', 'Field tidak ditemukan');
    return updated;
  },

  async assignUser(fieldId: string, input: AssignUserFieldInput, grantedBy: string) {
    // Cek user exists
    const [user] = await db.select({ id: usersTable.id })
      .from(usersTable).where(eq(usersTable.id, input.user_id)).limit(1);
    if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User tidak ditemukan');

    await db.insert(userFieldsTable)
      .values({
        userId:    input.user_id,
        fieldId,
        fieldRole: input.field_role,
        grantedBy,
      })
      .onConflictDoUpdate({
        target:  [userFieldsTable.userId, userFieldsTable.fieldId],
        set:     { fieldRole: input.field_role, grantedBy, grantedAt: new Date() },
      });
  },

  async revokeUser(fieldId: string, userId: string) {
    await db.delete(userFieldsTable)
      .where(and(
        eq(userFieldsTable.fieldId, fieldId),
        eq(userFieldsTable.userId, userId),
      ));
  },

  async delete(fieldId: string) {
    await db.update(fieldsTable)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(fieldsTable.id, fieldId));
  },
};

// ===========================================================================
// SUB-BLOCKS
// ===========================================================================

/** Calculate connected sub-blocks based on polygon overlap using ST_Intersects */
async function calculateIntersectingSubBlocks(fieldId: string, polygonGeom: any): Promise<string[]> {
  if (!polygonGeom) return [];
  const geomJson = typeof polygonGeom === 'string' ? polygonGeom : JSON.stringify(polygonGeom);
  
  const result = await db.select({ id: subBlocksTable.id })
    .from(subBlocksTable)
    .where(and(
      eq(subBlocksTable.fieldId, fieldId),
      eq(subBlocksTable.isActive, true),
      sql`ST_Intersects(${subBlocksTable.polygonGeom}::geometry, ST_GeomFromGeoJSON(${geomJson}))`
    ));
  
  return result.map(row => row.id);
}

/** Recalculate connected sub-blocks for all active embankments in a field */
async function recalculateFieldEmbankments(fieldId: string): Promise<void> {
  const embs = await db.select({ id: embankmentsTable.id, polygonGeom: embankmentsTable.polygonGeom })
    .from(embankmentsTable)
    .where(and(
      eq(embankmentsTable.fieldId, fieldId),
      eq(embankmentsTable.isActive, true)
    ));

  for (const emb of embs) {
    const connectedSubBlocks = await calculateIntersectingSubBlocks(fieldId, emb.polygonGeom);
    await db.update(embankmentsTable)
      .set({ connectedSubBlocks, updatedAt: new Date() })
      .where(eq(embankmentsTable.id, emb.id));
  }
}

type RawSubBlock = typeof subBlocksTable.$inferSelect;

/** Coerce numeric string columns returned by PostgreSQL into JS numbers. */
function parseSubBlockNumerics(sb: RawSubBlock) {
  return {
    ...sb,
    areaM2:    sb.areaM2    != null ? parseFloat(sb.areaM2)    : null,
    elevationM: sb.elevationM != null ? parseFloat(sb.elevationM) : null,
    elevationCalibration: sb.elevationCalibration != null ? parseFloat(sb.elevationCalibration) : null,
  };
}

export const subBlocksService = {
  async listByField(fieldId: string) {
    const rows = await db.select({
      id: subBlocksTable.id,
      fieldId: subBlocksTable.fieldId,
      name: subBlocksTable.name,
      code: subBlocksTable.code,
      uniqueCode: subBlocksTable.uniqueCode,
      polygonGeom: subBlocksTable.polygonGeom,
      areaM2: subBlocksTable.areaM2,
      centroid: subBlocksTable.centroid,
      elevationM: subBlocksTable.elevationM,
      elevationCalibration: subBlocksTable.elevationCalibration,
      soilType: subBlocksTable.soilType,
      displayOrder: subBlocksTable.displayOrder,
      isActive: subBlocksTable.isActive,
      notes: subBlocksTable.notes,
      createdAt: subBlocksTable.createdAt,
      updatedAt: subBlocksTable.updatedAt,
    })
      .from(subBlocksTable)
      .where(and(eq(subBlocksTable.fieldId, fieldId), eq(subBlocksTable.isActive, true)))
      .orderBy(subBlocksTable.displayOrder, subBlocksTable.name);

    const assignments = await db.select({
      subBlockId: deviceAssignmentsTable.subBlockId,
      deviceId: devicesTable.id,
      deviceCode: devicesTable.deviceCode,
      deviceType: devicesTable.deviceType,
      notes: devicesTable.notes,
    })
      .from(deviceAssignmentsTable)
      .innerJoin(devicesTable, eq(deviceAssignmentsTable.deviceId, devicesTable.id))
      .where(and(
        eq(deviceAssignmentsTable.fieldId, fieldId),
        sql`${deviceAssignmentsTable.unassignedAt} IS NULL`
      ));

    const parsedRows = rows.map(parseSubBlockNumerics);
    return parsedRows.map(row => ({
      ...row,
      devices: assignments
        .filter(a => a.subBlockId === row.id)
        .map(a => ({ id: a.deviceId, deviceCode: a.deviceCode, deviceType: a.deviceType, notes: a.notes })),
    }));
  },

  async getById(subBlockId: string) {
    const [sb] = await db.select({
      id: subBlocksTable.id,
      fieldId: subBlocksTable.fieldId,
      name: subBlocksTable.name,
      code: subBlocksTable.code,
      uniqueCode: subBlocksTable.uniqueCode,
      polygonGeom: subBlocksTable.polygonGeom,
      areaM2: subBlocksTable.areaM2,
      centroid: subBlocksTable.centroid,
      elevationM: subBlocksTable.elevationM,
      elevationCalibration: subBlocksTable.elevationCalibration,
      soilType: subBlocksTable.soilType,
      displayOrder: subBlocksTable.displayOrder,
      isActive: subBlocksTable.isActive,
      notes: subBlocksTable.notes,
      createdAt: subBlocksTable.createdAt,
      updatedAt: subBlocksTable.updatedAt,
    }).from(subBlocksTable)
      .where(and(eq(subBlocksTable.id, subBlockId), eq(subBlocksTable.isActive, true)))
      .limit(1);
    if (!sb) throw new AppError(404, 'SUB_BLOCK_NOT_FOUND', 'Sub-block tidak ditemukan');

    const assignments = await db.select({
      deviceId: devicesTable.id,
      deviceCode: devicesTable.deviceCode,
      deviceType: devicesTable.deviceType,
      notes: devicesTable.notes,
    })
      .from(deviceAssignmentsTable)
      .innerJoin(devicesTable, eq(deviceAssignmentsTable.deviceId, devicesTable.id))
      .where(and(
        eq(deviceAssignmentsTable.subBlockId, subBlockId),
        sql`${deviceAssignmentsTable.unassignedAt} IS NULL`
      ));

    return {
      ...parseSubBlockNumerics(sb),
      devices: assignments.map(a => ({ id: a.deviceId, deviceCode: a.deviceCode, deviceType: a.deviceType, notes: a.notes })),
    };
  },

  async create(fieldId: string, input: CreateSubBlockInput) {
    const geomJson = JSON.stringify(input.polygon_geom);
    
    // Self-healing: bersihkan kode unik pada sub-block lama yang sudah dihapus (inactive) agar tidak memicu 409 Conflict
    if (input.code) {
      await db.update(subBlocksTable)
        .set({ code: sql`code || '_del_' || floor(extract(epoch from now()))`, updatedAt: new Date() })
        .where(and(eq(subBlocksTable.fieldId, fieldId), eq(subBlocksTable.code, input.code), eq(subBlocksTable.isActive, false)));
    }

    try {
      const [inserted] = await db.insert(subBlocksTable).values({
        fieldId,
        name:                 input.name,
        code:                 input.code,
        polygonGeom:          geomJson,
        elevationM:           input.elevation_m?.toString(),
        elevationCalibration: input.elevation_calibration?.toString(),
        soilType:             input.soil_type,
        displayOrder:         input.display_order,
        notes:                input.notes,
      }).returning();

      if (!inserted) throw new AppError(500, 'CREATE_FAILED', 'Gagal membuat sub-block');
      
      // Recalculate connected sub-blocks for embankments in this field
      await recalculateFieldEmbankments(fieldId);
      
      return inserted;
    } catch (e: any) {
      if (e?.code === '23505') {
        throw new AppError(409, 'DUPLICATE_CODE', `Kode petak '${input.code}' sudah digunakan di lahan ini. Silakan gunakan kode lain.`);
      }
      throw e;
    }
  },

  async update(subBlockId: string, input: UpdateSubBlockInput) {
    const setParts: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name                  !== undefined) setParts['name']                  = input.name;
    if (input.code                  !== undefined) setParts['code']                  = input.code;
    if (input.elevation_m           !== undefined) setParts['elevationM']            = input.elevation_m;
    if (input.elevation_calibration !== undefined) setParts['elevationCalibration']  = input.elevation_calibration?.toString();
    if (input.soil_type             !== undefined) setParts['soilType']              = input.soil_type;
    if (input.display_order         !== undefined) setParts['displayOrder']          = input.display_order;
    if (input.notes                 !== undefined) setParts['notes']                 = input.notes;
    if (input.polygon_geom          !== undefined) setParts['polygonGeom']           = JSON.stringify(input.polygon_geom);

    const [updated] = await db.update(subBlocksTable)
      .set(setParts as Parameters<typeof db.update>[0] extends never ? never : Record<string, unknown>)
      .where(eq(subBlocksTable.id, subBlockId))
      .returning();
    if (!updated) throw new AppError(404, 'SUB_BLOCK_NOT_FOUND', 'Sub-block tidak ditemukan');
    
    // Recalculate field embankments if polygon geom changed
    if (input.polygon_geom !== undefined) {
      await recalculateFieldEmbankments(updated.fieldId);
    }
    
    return updated;
  },

  /** Bulk import dari GeoJSON FeatureCollection */
  async importFromGeoJson(fieldId: string, input: ImportSubBlocksInput) {
    const insertedIds: string[] = [];

    for (const feature of input.geojson.features) {
      const props  = feature.properties ?? {};
      const name   = String(props[input.name_field] ?? `Sub-block ${insertedIds.length + 1}`);
      const code   = input.code_field ? String(props[input.code_field] ?? '') : undefined;
      const geomJson = JSON.stringify(feature.geometry);

      const [inserted] = await db.insert(subBlocksTable).values({
        fieldId,
        name,
        code,
        polygonGeom: geomJson,
      }).returning();

      if (inserted) insertedIds.push(inserted.id);
    }

    if (insertedIds.length > 0) {
      await recalculateFieldEmbankments(fieldId);
    }

    return { inserted: insertedIds.length, ids: insertedIds };
  },

  async delete(subBlockId: string) {
    const [updated] = await db.update(subBlocksTable)
      .set({ 
        isActive: false, 
        code: sql`code || '_del_' || floor(extract(epoch from now()))`,
        updatedAt: new Date() 
      })
      .where(eq(subBlocksTable.id, subBlockId))
      .returning();
      
    if (updated) {
      await recalculateFieldEmbankments(updated.fieldId);
    }
  },

  async resolveEmbankmentBreak(subBlockId: string, resolvedBy: string) {
    // Cari semua event snooze_dss bertipe pematang jebol untuk subBlock ini
    // yang expiresAt nya masih > now
    await db.update(managementEventsTable)
      .set({
        flagExpiresAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(
        eq(managementEventsTable.subBlockId, subBlockId),
        eq(managementEventsTable.eventType, 'snooze_dss'),
        eq(managementEventsTable.attentionFlagText, 'Pematang Jebol/Bocor'),
        sql`${managementEventsTable.flagExpiresAt} > NOW()`
      ));
  },
};

// ===========================================================================
// DEVICES
// ===========================================================================

export const devicesService = {
  async listAll(query: Record<string, unknown>) {
    const { page, limit, offset } = parsePagination(query);
    const [rows, [{ value: total }]] = await Promise.all([
      db.select({
        id: devicesTable.id,
        deviceCode: devicesTable.deviceCode,
        deviceType: devicesTable.deviceType,
        connectionType: devicesTable.connectionType,
        hardwareModel: devicesTable.hardwareModel,
        serialNumber: devicesTable.serialNumber,
        firmwareVersion: devicesTable.firmwareVersion,
        fieldId: devicesTable.fieldId,
        subBlockId: devicesTable.subBlockId,
        subBlockName: subBlocksTable.name,
        status: devicesTable.status,
        batteryLevelPct: devicesTable.batteryLevelPct,
        batteryUpdatedAt: devicesTable.batteryUpdatedAt,
        installedAt: devicesTable.installedAt,
        lastSeenAt: devicesTable.lastSeenAt,
        notes: devicesTable.notes,
        topic: devicesTable.topic,
        parentStation: devicesTable.parentStation,
        coordinate: devicesTable.coordinate,
        createdAt: devicesTable.createdAt,
        updatedAt: devicesTable.updatedAt,
      })
        .from(devicesTable)
        .leftJoin(subBlocksTable, eq(devicesTable.subBlockId, subBlocksTable.id))
        .orderBy(devicesTable.deviceCode)
        .limit(limit).offset(offset),
      db.select({ value: count() }).from(devicesTable),
    ]);
    return { rows, meta: buildPaginationMeta({ page, limit, offset }, total) };
  },

  async listByField(fieldId: string) {
    return db.select({
      id: devicesTable.id,
      deviceCode: devicesTable.deviceCode,
      deviceType: devicesTable.deviceType,
      connectionType: devicesTable.connectionType,
      hardwareModel: devicesTable.hardwareModel,
      serialNumber: devicesTable.serialNumber,
      firmwareVersion: devicesTable.firmwareVersion,
      fieldId: devicesTable.fieldId,
      subBlockId: devicesTable.subBlockId,
      subBlockName: subBlocksTable.name,
      status: devicesTable.status,
      batteryLevelPct: devicesTable.batteryLevelPct,
      batteryUpdatedAt: devicesTable.batteryUpdatedAt,
      installedAt: devicesTable.installedAt,
      lastSeenAt: devicesTable.lastSeenAt,
      notes: devicesTable.notes,
      topic: devicesTable.topic,
      parentStation: devicesTable.parentStation,
      coordinate: devicesTable.coordinate,
      createdAt: devicesTable.createdAt,
      updatedAt: devicesTable.updatedAt,
    })
      .from(devicesTable)
      .leftJoin(subBlocksTable, eq(devicesTable.subBlockId, subBlocksTable.id))
      .where(eq(devicesTable.fieldId, fieldId))
      .orderBy(devicesTable.deviceCode);
  },

  async getById(deviceId: string) {
    const [dev] = await db.select({
      id: devicesTable.id,
      deviceCode: devicesTable.deviceCode,
      deviceType: devicesTable.deviceType,
      connectionType: devicesTable.connectionType,
      hardwareModel: devicesTable.hardwareModel,
      serialNumber: devicesTable.serialNumber,
      firmwareVersion: devicesTable.firmwareVersion,
      fieldId: devicesTable.fieldId,
      subBlockId: devicesTable.subBlockId,
      subBlockName: subBlocksTable.name,
      status: devicesTable.status,
      batteryLevelPct: devicesTable.batteryLevelPct,
      batteryUpdatedAt: devicesTable.batteryUpdatedAt,
      installedAt: devicesTable.installedAt,
      lastSeenAt: devicesTable.lastSeenAt,
      notes: devicesTable.notes,
      topic: devicesTable.topic,
      parentStation: devicesTable.parentStation,
      coordinate: devicesTable.coordinate,
      createdAt: devicesTable.createdAt,
      updatedAt: devicesTable.updatedAt,
    }).from(devicesTable)
      .leftJoin(subBlocksTable, eq(devicesTable.subBlockId, subBlocksTable.id))
      .where(eq(devicesTable.id, deviceId)).limit(1);
    if (!dev) throw new AppError(404, 'DEVICE_NOT_FOUND', 'Device tidak ditemukan');
    return dev;
  },

  async create(fieldId: string, input: CreateDeviceInput) {
    const [dev] = await db.insert(devicesTable).values({
      deviceCode:      input.device_code,
      deviceType:      input.device_type,
      connectionType:  input.connection_type,
      hardwareModel:   input.hardware_model,
      serialNumber:    input.serial_number,
      firmwareVersion: input.firmware_version,
      fieldId,
      status:          'active',
      notes:           input.notes,
      coordinate:      input.coordinate,
      parentStation:   input.device_type === 'sensor' ? input.parent_station : null,
    }).returning();
    return dev!;
  },

  async update(deviceId: string, input: Partial<CreateDeviceInput>) {
    let parentStationValue: string | null | undefined = undefined;
    if (input.device_type === 'station') {
      parentStationValue = null;
    } else if (input.parent_station !== undefined) {
      parentStationValue = input.parent_station;
    }

    const [updated] = await db.update(devicesTable)
      .set({
        ...(input.device_code      !== undefined && { deviceCode: input.device_code }),
        ...(input.device_type      !== undefined && { deviceType: input.device_type }),
        ...(input.connection_type  !== undefined && { connectionType: input.connection_type }),
        ...(input.hardware_model   !== undefined && { hardwareModel: input.hardware_model }),
        ...(input.firmware_version !== undefined && { firmwareVersion: input.firmware_version }),
        ...(input.notes            !== undefined && { notes: input.notes }),
        ...(input.coordinate       !== undefined && { coordinate: input.coordinate }),
        ...(parentStationValue     !== undefined && { parentStation: parentStationValue }),
        updatedAt: new Date(),
      })
      .where(eq(devicesTable.id, deviceId))
      .returning();
    if (!updated) throw new AppError(404, 'DEVICE_NOT_FOUND', 'Device tidak ditemukan');
    return updated;
  },

  async assign(deviceId: string, fieldId: string, input: AssignDeviceInput, assignedBy: string) {
    // Pastikan sub-block ada dan di field yang sama
    const [sb] = await db.select({ id: subBlocksTable.id, fieldId: subBlocksTable.fieldId })
      .from(subBlocksTable).where(eq(subBlocksTable.id, input.sub_block_id)).limit(1);
    if (!sb) throw new AppError(404, 'SUB_BLOCK_NOT_FOUND', 'Sub-block tidak ditemukan');
    if (sb.fieldId !== fieldId) throw new AppError(400, 'FIELD_MISMATCH', 'Sub-block bukan milik field ini');

    // Close existing assignment jika ada
    await db.update(deviceAssignmentsTable)
      .set({ unassignedAt: new Date(), unassignedBy: assignedBy })
      .where(and(
        eq(deviceAssignmentsTable.deviceId, deviceId),
        sql`${deviceAssignmentsTable.unassignedAt} IS NULL`,
      ));

    // Create new assignment
    await db.insert(deviceAssignmentsTable).values({
      deviceId, subBlockId: input.sub_block_id, fieldId, assignedBy, notes: input.notes,
    });

    // Update device.sub_block_id untuk quick lookup
    await db.update(devicesTable)
      .set({ subBlockId: input.sub_block_id, updatedAt: new Date() })
      .where(eq(devicesTable.id, deviceId));

    // Perform immediate auto-calibration if latest pressure record exists for this device
    const [device] = await db.select({
      id:            devicesTable.id,
      deviceCode:    devicesTable.deviceCode,
      deviceType:    devicesTable.deviceType,
      parentStation: devicesTable.parentStation,
      fieldId:       devicesTable.fieldId,
    })
      .from(devicesTable)
      .where(eq(devicesTable.id, deviceId))
      .limit(1);

    const [latestRecord] = await db.select({
      pressure: telemetryRecordsTable.pressure,
    })
      .from(telemetryRecordsTable)
      .innerJoin(devicesTable, eq(devicesTable.id, telemetryRecordsTable.deviceId))
      .where(and(
        eq(devicesTable.fieldId, fieldId),
        sql`${telemetryRecordsTable.pressure} IS NOT NULL`
      ))
      .orderBy(desc(telemetryRecordsTable.eventTimestamp))
      .limit(1);

    if (latestRecord && latestRecord.pressure && device) {
      const pressureVal = parseFloat(latestRecord.pressure.toString());
      const stationCode = (device.deviceType === 'station' || device.deviceType === 'weather_station')
        ? device.deviceCode
        : device.parentStation;

      let stationPoint = null;
      if (stationCode) {
        [stationPoint] = await db.select({
          coordinatePoint: irrigationPointsTable.coordinatePoint,
          elevationM: irrigationPointsTable.elevationM,
        })
          .from(irrigationPointsTable)
          .where(and(
            eq(irrigationPointsTable.fieldId, device.fieldId),
            eq(irrigationPointsTable.name, stationCode)
          ))
          .limit(1);
      }

      if (!stationPoint) {
        [stationPoint] = await db.select({
          coordinatePoint: irrigationPointsTable.coordinatePoint,
          elevationM: irrigationPointsTable.elevationM,
        })
          .from(irrigationPointsTable)
          .where(and(
            eq(irrigationPointsTable.fieldId, device.fieldId),
            sql`${irrigationPointsTable.pointType} IN ('station', 'weather_station')`
          ))
          .limit(1);
      }

      let refSubBlock = null;

      // 1. Get the station device and its assigned sub-block ID
      let stationDevice = null;
      if (stationCode) {
        [stationDevice] = await db.select({
          subBlockId: devicesTable.subBlockId,
        })
          .from(devicesTable)
          .where(and(
            eq(devicesTable.fieldId, device.fieldId),
            eq(devicesTable.deviceCode, stationCode),
            sql`${devicesTable.deviceType} IN ('station', 'weather_station')`
          ))
          .limit(1);
      }

      if (!stationDevice) {
        [stationDevice] = await db.select({
          subBlockId: devicesTable.subBlockId,
        })
          .from(devicesTable)
          .where(and(
            eq(devicesTable.fieldId, device.fieldId),
            sql`${devicesTable.deviceType} IN ('station', 'weather_station')`
          ))
          .limit(1);
      }

      // 2. If station has an assigned sub-block, use it as reference
      if (stationDevice && stationDevice.subBlockId) {
        [refSubBlock] = await db.select({
          id: subBlocksTable.id,
          elevationM: subBlocksTable.elevationM,
        })
          .from(subBlocksTable)
          .where(eq(subBlocksTable.id, stationDevice.subBlockId))
          .limit(1);
      }

      // 3. Fallback: if no assigned sub-block, find the nearest one to the station point
      if (!refSubBlock && stationPoint && stationPoint.coordinatePoint) {
        [refSubBlock] = await db.select({
          id: subBlocksTable.id,
          elevationM: subBlocksTable.elevationM,
        })
          .from(subBlocksTable)
          .where(eq(subBlocksTable.fieldId, device.fieldId))
          .orderBy(sql`ST_Distance(${subBlocksTable.centroid}, ${stationPoint.coordinatePoint})`)
          .limit(1);
      }

      // 4. Fallback: if still no sub-block, use any sub-block on this field
      if (!refSubBlock) {
        [refSubBlock] = await db.select({
          id: subBlocksTable.id,
          elevationM: subBlocksTable.elevationM,
        })
          .from(subBlocksTable)
          .where(eq(subBlocksTable.fieldId, device.fieldId))
          .limit(1);
      }

      let refElevationM = 0;
      if (refSubBlock && refSubBlock.elevationM !== null) {
        refElevationM = parseFloat(refSubBlock.elevationM.toString());
      } else if (stationPoint && stationPoint.elevationM !== null) {
        refElevationM = parseFloat(stationPoint.elevationM.toString());
      }

      await recalibrateFieldElevations(device.fieldId, input.sub_block_id, pressureVal);
    }
  },

  async unassign(deviceId: string, unassignedBy: string) {
    const [device] = await db.select({ fieldId: devicesTable.fieldId })
      .from(devicesTable)
      .where(eq(devicesTable.id, deviceId))
      .limit(1);

    await db.update(deviceAssignmentsTable)
      .set({ unassignedAt: new Date(), unassignedBy })
      .where(and(
        eq(deviceAssignmentsTable.deviceId, deviceId),
        sql`${deviceAssignmentsTable.unassignedAt} IS NULL`,
      ));

    await db.update(devicesTable)
      .set({ subBlockId: null, updatedAt: new Date() })
      .where(eq(devicesTable.id, deviceId));

    if (device) {
      await recalibrateFieldElevations(device.fieldId);
    }
  },

  async calibrate(deviceId: string, input: CalibrateDeviceInput, calibratedBy: string) {
    // Expire previous active calibration jika ada
    await db.update(sensorCalibrationsTable)
      .set({ validUntil: new Date(), isActive: false })
      .where(and(
        eq(sensorCalibrationsTable.deviceId, deviceId),
        eq(sensorCalibrationsTable.isActive, true),
        sql`${sensorCalibrationsTable.validUntil} IS NULL`,
      ));

    const [cal] = await db.insert(sensorCalibrationsTable).values({
      deviceId,
      waterLevelOffsetCm:  input.water_level_offset_cm?.toString() ?? '0.00',
      temperatureOffsetC:  input.temperature_offset_c?.toString()  ?? '0.00',
      humidityOffsetPct:   input.humidity_offset_pct?.toString()   ?? '0.00',
      validFrom:           input.valid_from ? new Date(input.valid_from) : new Date(),
      validUntil:          input.valid_until ? new Date(input.valid_until) : undefined,
      calibrationMethod:   input.calibration_method,
      referenceReadingCm:  input.reference_reading_cm?.toString(),
      calibratedBy,
      notes:               input.notes,
      isActive:            true,
    }).returning();

    return cal!;
  },

  async delete(deviceId: string) {
    // Hapus records di tabel-tabel dependent terlebih dahulu agar tidak melanggar FK constraints
    await db.delete(telemetryRecordsTable).where(eq(telemetryRecordsTable.deviceId, deviceId));
    await db.delete(sensorCalibrationsTable).where(eq(sensorCalibrationsTable.deviceId, deviceId));
    await db.delete(deviceAssignmentsTable).where(eq(deviceAssignmentsTable.deviceId, deviceId));
    await db.delete(devicesTable).where(eq(devicesTable.id, deviceId));
  },
};

// ===========================================================================
// FLOW PATHS
// ===========================================================================

export const flowPathsService = {
  async listByField(fieldId: string) {
    return db.select().from(flowPathsTable)
      .where(and(
        eq(flowPathsTable.fieldId, fieldId),
        eq(flowPathsTable.isActive, true),
      ));
  },

  async getById(id: string) {
    const [fp] = await db.select().from(flowPathsTable)
      .where(and(eq(flowPathsTable.id, id), eq(flowPathsTable.isActive, true)))
      .limit(1);
    if (!fp) throw new AppError(404, 'FLOW_PATH_NOT_FOUND', 'Flow path tidak ditemukan');
    return fp;
  },

  async create(fieldId: string, input: CreateFlowPathInput) {
    // Validasi field_id exists
    const [field] = await db.select({ id: fieldsTable.id })
      .from(fieldsTable).where(eq(fieldsTable.id, fieldId)).limit(1);
    if (!field) throw new AppError(404, 'FIELD_NOT_FOUND', 'Lahan tidak ditemukan');

    const [fp] = await db.insert(flowPathsTable).values({
      fieldId,
      flowType:             input.flow_type,
      floydWarshallMatrix:  input.floyd_warshall_matrix,
      notes:                input.notes,
    }).returning();
    return fp!;
  },

  async update(id: string, input: UpdateFlowPathInput) {
    const [updated] = await db.update(flowPathsTable)
      .set({
        ...(input.flow_type !== undefined && { flowType: input.flow_type }),
        ...(input.floyd_warshall_matrix !== undefined && { floydWarshallMatrix: input.floyd_warshall_matrix }),
        ...(input.notes !== undefined && { notes: input.notes }),
      })
      .where(eq(flowPathsTable.id, id))
      .returning();
    if (!updated) throw new AppError(404, 'FLOW_PATH_NOT_FOUND', 'Flow path tidak ditemukan');
    return updated;
  },

  async delete(flowPathId: string) {
    await db.update(flowPathsTable)
      .set({ isActive: false })
      .where(eq(flowPathsTable.id, flowPathId));
  },
};

// ===========================================================================
// IRRIGATION POINTS
// ===========================================================================

type RawIrrigationPoint = typeof irrigationPointsTable.$inferSelect;

function parseIrrigationPoint(ip: RawIrrigationPoint) {
  let coordinatePoint = null;
  if (ip.coordinatePoint) {
    try {
      coordinatePoint = JSON.parse(ip.coordinatePoint);
    } catch {
      coordinatePoint = ip.coordinatePoint;
    }
  }
  return {
    ...ip,
    coordinatePoint,
    elevationM: ip.elevationM != null ? parseFloat(ip.elevationM) : null,
    callibratedElevation: ip.callibratedElevation != null ? parseFloat(ip.callibratedElevation) : null,
  };
}

async function calculateAssignedSubBlocksForPoint(fieldId: string, coordinatePoint: any): Promise<string[]> {
  if (!coordinatePoint) return [];
  const geomJson = typeof coordinatePoint === 'string' ? coordinatePoint : JSON.stringify(coordinatePoint);

  const subBlockIds = new Set<string>();

  // 1. Check if the point intersects any embankments in the field
  const intersectingEmbankments = await db.select({
    connectedSubBlocks: embankmentsTable.connectedSubBlocks,
  })
  .from(embankmentsTable)
  .where(and(
    eq(embankmentsTable.fieldId, fieldId),
    eq(embankmentsTable.isActive, true),
    sql`ST_Intersects(ST_SetSRID(${embankmentsTable.polygonGeom}::geometry, 4326), ST_GeomFromGeoJSON(${geomJson}))`
  ));

  for (const emb of intersectingEmbankments) {
    const connected = emb.connectedSubBlocks ?? [];
    connected.forEach(id => subBlockIds.add(id));
  }

  // 2. Check if the point intersects any sub-blocks directly
  const intersectingSubBlocks = await db.select({
    id: subBlocksTable.id,
  })
  .from(subBlocksTable)
  .where(and(
    eq(subBlocksTable.fieldId, fieldId),
    eq(subBlocksTable.isActive, true),
    sql`ST_Intersects(ST_SetSRID(${subBlocksTable.polygonGeom}::geometry, 4326), ST_GeomFromGeoJSON(${geomJson}))`
  ));

  intersectingSubBlocks.forEach(row => subBlockIds.add(row.id));

  return Array.from(subBlockIds);
}

async function getFieldCalibrationOffset(fieldId: string): Promise<number> {
  const [firstCalSubBlock] = await db.select({
    elevationM: subBlocksTable.elevationM,
    elevationCalibration: subBlocksTable.elevationCalibration,
  })
  .from(subBlocksTable)
  .where(and(
    eq(subBlocksTable.fieldId, fieldId),
    sql`${subBlocksTable.elevationCalibration} IS NOT NULL`,
    sql`${subBlocksTable.elevationM} IS NOT NULL`
  ))
  .limit(1);

  if (firstCalSubBlock && firstCalSubBlock.elevationCalibration && firstCalSubBlock.elevationM) {
    return parseFloat(firstCalSubBlock.elevationCalibration.toString()) - parseFloat(firstCalSubBlock.elevationM.toString());
  }
  return 0;
}

export const irrigationPointsService = {
  async listByField(fieldId: string) {
    const rows = await db.select().from(irrigationPointsTable)
      .where(eq(irrigationPointsTable.fieldId, fieldId));
    return rows.map(parseIrrigationPoint);
  },

  async getById(id: string) {
    const [ip] = await db.select().from(irrigationPointsTable)
      .where(eq(irrigationPointsTable.id, id))
      .limit(1);
    if (!ip) throw new AppError(404, 'IRRIGATION_POINT_NOT_FOUND', 'Titik irigasi tidak ditemukan');
    return parseIrrigationPoint(ip);
  },

  async create(fieldId: string, input: CreateIrrigationPointInput) {
    // Validasi field_id exists
    const [field] = await db.select({ id: fieldsTable.id })
      .from(fieldsTable).where(eq(fieldsTable.id, fieldId)).limit(1);
    if (!field) throw new AppError(404, 'FIELD_NOT_FOUND', 'Lahan tidak ditemukan');

    // Calculate assigned sub-blocks automatically based on point containment
    let assignedSubBlocks: string[] = [];
    if (input.coordinate_point) {
      assignedSubBlocks = await calculateAssignedSubBlocksForPoint(fieldId, input.coordinate_point);
    }

    let callibratedElevation = input.callibrated_elevation?.toString() ?? null;
    if (callibratedElevation === null && input.elevation_m !== undefined && input.elevation_m !== null) {
      const offset = await getFieldCalibrationOffset(fieldId);
      callibratedElevation = (input.elevation_m + offset).toFixed(2);
    }

    const [ip] = await db.insert(irrigationPointsTable).values({
      fieldId,
      pointType:       input.point_type,
      coordinatePoint: input.coordinate_point ? JSON.stringify(input.coordinate_point) : null,
      elevationM:      input.elevation_m?.toString(),
      callibratedElevation,
      name:            input.name,
      assignedSubBlocks: assignedSubBlocks,
    }).returning();

    return parseIrrigationPoint(ip!);
  },

  async update(id: string, input: UpdateIrrigationPointInput) {
    const [existing] = await db.select({ 
      fieldId: irrigationPointsTable.fieldId, 
      coordinatePoint: irrigationPointsTable.coordinatePoint,
      elevationM: irrigationPointsTable.elevationM,
      callibratedElevation: irrigationPointsTable.callibratedElevation,
    })
      .from(irrigationPointsTable).where(eq(irrigationPointsTable.id, id)).limit(1);
    if (!existing) throw new AppError(404, 'IRRIGATION_POINT_NOT_FOUND', 'Titik irigasi tidak ditemukan');

    let assignedSubBlocks: string[] | undefined = undefined;
    if (input.coordinate_point !== undefined) {
      if (input.coordinate_point) {
        assignedSubBlocks = await calculateAssignedSubBlocksForPoint(existing.fieldId, input.coordinate_point);
      } else {
        assignedSubBlocks = [];
      }
    }

    let callibratedElevation: string | null | undefined = input.callibrated_elevation !== undefined 
      ? input.callibrated_elevation?.toString() 
      : undefined;

    if (callibratedElevation === undefined) {
      const targetElevationM = input.elevation_m !== undefined 
        ? input.elevation_m 
        : (existing.elevationM ? parseFloat(existing.elevationM) : null);

      if (targetElevationM !== null) {
        const offset = await getFieldCalibrationOffset(existing.fieldId);
        callibratedElevation = (targetElevationM + offset).toFixed(2);
      } else {
        callibratedElevation = null;
      }
    }

    const [updated] = await db.update(irrigationPointsTable)
      .set({
        ...(input.point_type !== undefined && { pointType: input.point_type }),
        ...(input.coordinate_point !== undefined && { 
          coordinatePoint: input.coordinate_point ? JSON.stringify(input.coordinate_point) : null 
        }),
        ...(input.elevation_m !== undefined && { elevationM: input.elevation_m?.toString() }),
        ...(callibratedElevation !== undefined && { callibratedElevation }),
        ...(input.name !== undefined && { name: input.name }),
        ...(assignedSubBlocks !== undefined && { assignedSubBlocks }),
      })
      .where(eq(irrigationPointsTable.id, id))
      .returning();

    if (!updated) throw new AppError(404, 'IRRIGATION_POINT_NOT_FOUND', 'Titik irigasi tidak ditemukan');
    return parseIrrigationPoint(updated);
  },

  async delete(id: string) {
    const [deleted] = await db.delete(irrigationPointsTable)
      .where(eq(irrigationPointsTable.id, id))
      .returning();
    if (!deleted) throw new AppError(404, 'IRRIGATION_POINT_NOT_FOUND', 'Titik irigasi tidak ditemukan');
  },
};

// ===========================================================================
// CROP CYCLES
// ===========================================================================

export const cropCyclesService = {
  async listBySubBlock(subBlockId: string) {
    return db.select().from(cropCyclesTable)
      .where(eq(cropCyclesTable.subBlockId, subBlockId))
      .orderBy(desc(cropCyclesTable.createdAt));
  },

  async getActive(subBlockId: string) {
    const [cc] = await db.select().from(cropCyclesTable)
      .where(and(eq(cropCyclesTable.subBlockId, subBlockId), eq(cropCyclesTable.status, 'active')))
      .limit(1);
    return cc ?? null;
  },

  async create(subBlockId: string, fieldId: string, input: CreateCropCycleInput) {
    // Tidak boleh ada crop cycle aktif pada sub-block yang sama
    const existing = await this.getActive(subBlockId);
    if (existing) throw new AppError(409, 'CROP_CYCLE_ACTIVE', 'Sub-block ini sudah memiliki crop cycle yang aktif');

    const [cc] = await db.insert(cropCyclesTable).values({
      subBlockId,
      fieldId,
      bucketCode:           input.bucket_code,
      varietyName:          input.variety_name,
      ruleProfileId:        input.rule_profile_id,
      plantingDate:         input.planting_date,
      expectedHarvestDate:  input.expected_harvest_date,
      currentPhaseCode:     'land_prep',
      currentHst:           0,
      status:               'active',
      notes:                input.notes,
    }).returning();
    return cc!;
  },

  async advancePhase(cropCycleId: string, input: UpdateCropCyclePhaseInput) {
    const [cc] = await db.select().from(cropCyclesTable)
      .where(eq(cropCyclesTable.id, cropCycleId)).limit(1);
    if (!cc) throw new AppError(404, 'CROP_CYCLE_NOT_FOUND', 'Crop cycle tidak ditemukan');
    if (cc.status !== 'active') throw new AppError(400, 'CROP_CYCLE_NOT_ACTIVE', 'Crop cycle tidak aktif');

    const [updated] = await db.update(cropCyclesTable)
      .set({
        currentPhaseCode: input.current_phase_code,
        ...(input.rule_profile_id !== undefined && { ruleProfileId: input.rule_profile_id }),
        updatedAt: new Date(),
      })
      .where(eq(cropCyclesTable.id, cropCycleId))
      .returning();
    return updated!;
  },

  async complete(cropCycleId: string, actualHarvestDate?: string) {
    const [updated] = await db.update(cropCyclesTable)
      .set({
        status:             'completed',
        currentPhaseCode:   'harvested',
        actualHarvestDate:  actualHarvestDate,
        completedAt:        new Date(),
        updatedAt:          new Date(),
      })
      .where(eq(cropCyclesTable.id, cropCycleId))
      .returning();
    if (!updated) throw new AppError(404, 'CROP_CYCLE_NOT_FOUND', 'Crop cycle tidak ditemukan');
    return updated;
  },

  async getById(id: string) {
    const [cc] = await db.select().from(cropCyclesTable).where(eq(cropCyclesTable.id, id)).limit(1);
    if (!cc) throw new AppError(404, 'CROP_CYCLE_NOT_FOUND', 'Crop cycle tidak ditemukan');
    return cc;
  },

  async delete(id: string) {
    await db.delete(cropCyclesTable).where(eq(cropCyclesTable.id, id));
  },
};

// ===========================================================================
// RULE PROFILES
// ===========================================================================

type RawRuleProfile = typeof ruleProfilesTable.$inferSelect;

function parseRuleProfileNumerics(profile: RawRuleProfile) {
  const awdUpperTarget = parseFloat(profile.awdUpperTargetCm);
  return {
    ...profile,
    awdUpperTargetCm:    awdUpperTarget,
    droughtAlertCm:      profile.droughtAlertCm != null ? parseFloat(profile.droughtAlertCm) : (awdUpperTarget - 10),
    rainDelayMm:         parseFloat(profile.rainDelayMm),
    priorityWeight:      parseFloat(profile.priorityWeight),
  };
}

export const ruleProfilesService = {
  async list(query: Record<string, unknown>) {
    const { page, limit, offset } = parsePagination(query);
    const [rows, [{ value: total }]] = await Promise.all([
      db.select().from(ruleProfilesTable)
        .where(eq(ruleProfilesTable.isActive, true))
        .orderBy(ruleProfilesTable.name).limit(limit).offset(offset),
      db.select({ value: count() }).from(ruleProfilesTable)
        .where(eq(ruleProfilesTable.isActive, true)),
    ]);
    return { rows: rows.map(parseRuleProfileNumerics), meta: buildPaginationMeta({ page, limit, offset }, total) };
  },

  async create(input: CreateRuleProfileInput, createdBy: string) {
    const [profile] = await db.insert(ruleProfilesTable).values({
      name:                   input.name,
      description:            input.description,
      bucketCode:             input.bucket_code,
      phaseCode:              input.phase_code,
      awdUpperTargetCm:       input.awd_upper_target_cm.toString(),
      droughtAlertCm:         input.drought_alert_cm?.toString(),
      minSaturationDays:      input.min_saturation_days,
      rainDelayMm:            input.rain_delay_mm.toString(),
      priorityWeight:         input.priority_weight.toString(),
      rainfedModifierPct:     input.rainfed_modifier_pct.toString(),
      targetConfidence:       input.target_confidence,
      isDefault:              input.is_default,
      createdBy,
    }).returning();
    return parseRuleProfileNumerics(profile!);
  },

  async getById(id: string) {
    const [profile] = await db.select().from(ruleProfilesTable).where(eq(ruleProfilesTable.id, id)).limit(1);
    if (!profile) throw new AppError(404, 'RULE_PROFILE_NOT_FOUND', 'Profil aturan tidak ditemukan');
    return parseRuleProfileNumerics(profile);
  },

  async update(id: string, input: Partial<CreateRuleProfileInput>) {
    const [updated] = await db.update(ruleProfilesTable)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.bucket_code !== undefined && { bucketCode: input.bucket_code }),
        ...(input.phase_code !== undefined && { phaseCode: input.phase_code }),
        ...(input.awd_upper_target_cm !== undefined && { awdUpperTargetCm: input.awd_upper_target_cm.toString() }),
        ...(input.drought_alert_cm !== undefined && { droughtAlertCm: input.drought_alert_cm?.toString() }),
        ...(input.min_saturation_days !== undefined && { minSaturationDays: input.min_saturation_days }),
        ...(input.rain_delay_mm !== undefined && { rainDelayMm: input.rain_delay_mm.toString() }),
        ...(input.priority_weight !== undefined && { priorityWeight: input.priority_weight.toString() }),
        ...(input.rainfed_modifier_pct !== undefined && { rainfedModifierPct: input.rainfed_modifier_pct.toString() }),
        ...(input.target_confidence !== undefined && { targetConfidence: input.target_confidence }),
        ...(input.is_default !== undefined && { isDefault: input.is_default }),
        updatedAt: new Date(),
      })
      .where(eq(ruleProfilesTable.id, id))
      .returning();
    return parseRuleProfileNumerics(updated!);
  },

  async delete(id: string) {
    await db.update(ruleProfilesTable)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(ruleProfilesTable.id, id));
  },
};

// ===========================================================================
// EMBANKMENTS
// ===========================================================================

type RawEmbankment = typeof embankmentsTable.$inferSelect;

/** Coerce numeric string columns returned by PostgreSQL into JS numbers. */
function parseEmbankmentNumerics(emb: RawEmbankment) {
  let polygonGeom: unknown = emb.polygonGeom;
  if (typeof polygonGeom === 'string') {
    try { polygonGeom = JSON.parse(polygonGeom); } catch { /* keep as string */ }
  }
  let centroid: unknown = emb.centroid;
  if (typeof centroid === 'string') {
    try { centroid = JSON.parse(centroid); } catch { /* keep as string */ }
  }
  return {
    ...emb,
    polygonGeom,
    centroid,
    areaM2:     emb.areaM2     != null ? parseFloat(emb.areaM2)     : null,
    elevationM: emb.elevationM != null ? parseFloat(emb.elevationM) : null,
  };
}

export const embankmentsService = {
  async listByField(fieldId: string) {
    const rows = await db.select()
      .from(embankmentsTable)
      .where(and(
        eq(embankmentsTable.fieldId, fieldId),
        eq(embankmentsTable.isActive, true),
      ))
      .orderBy(embankmentsTable.displayOrder, embankmentsTable.name);
    return rows.map(parseEmbankmentNumerics);
  },

  async getById(id: string) {
    const [emb] = await db.select()
      .from(embankmentsTable)
      .where(and(
        eq(embankmentsTable.id, id),
        eq(embankmentsTable.isActive, true),
      ))
      .limit(1);
    if (!emb) throw new AppError(404, 'EMBANKMENT_NOT_FOUND', 'Pematang tidak ditemukan');
    return parseEmbankmentNumerics(emb);
  },

  async create(fieldId: string, input: CreateEmbankmentInput) {
    // Validate field exists
    const [field] = await db.select({ id: fieldsTable.id })
      .from(fieldsTable)
      .where(eq(fieldsTable.id, fieldId))
      .limit(1);
    if (!field) throw new AppError(404, 'FIELD_NOT_FOUND', 'Lahan tidak ditemukan');

    const geomJson = JSON.stringify(input.polygon_geom);
    
    // Dynamically calculate connected sub-blocks based on polygon overlap
    const connectedSubBlocks = await calculateIntersectingSubBlocks(fieldId, input.polygon_geom);

    const [inserted] = await db.insert(embankmentsTable).values({
      fieldId,
      name:               input.name,
      code:               input.code,
      polygonGeom:        geomJson,
      elevationM:         input.elevation_m?.toString(),
      soilType:           input.soil_type,
      displayOrder:       input.display_order,
      notes:              input.notes,
      connectedSubBlocks: connectedSubBlocks,
    }).returning();

    if (!inserted) throw new AppError(500, 'CREATE_FAILED', 'Gagal membuat data pematang');
    return parseEmbankmentNumerics(inserted);
  },

  async update(id: string, input: UpdateEmbankmentInput) {
    const setParts: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name                 !== undefined) setParts['name']               = input.name;
    if (input.code                 !== undefined) setParts['code']               = input.code;
    if (input.elevation_m          !== undefined) setParts['elevationM']         = input.elevation_m?.toString();
    if (input.soil_type            !== undefined) setParts['soilType']           = input.soil_type;
    if (input.display_order        !== undefined) setParts['displayOrder']       = input.display_order;
    if (input.notes                !== undefined) setParts['notes']              = input.notes;
    
    if (input.polygon_geom         !== undefined) {
      setParts['polygonGeom'] = JSON.stringify(input.polygon_geom);
      // Recalculate dynamic overlap
      const [emb] = await db.select({ fieldId: embankmentsTable.fieldId })
        .from(embankmentsTable)
        .where(eq(embankmentsTable.id, id))
        .limit(1);
      if (emb) {
        setParts['connectedSubBlocks'] = await calculateIntersectingSubBlocks(emb.fieldId, input.polygon_geom);
      }
    } else if (input.connected_sub_blocks !== undefined) {
      setParts['connectedSubBlocks'] = input.connected_sub_blocks;
    }

    const [updated] = await db.update(embankmentsTable)
      .set(setParts as Parameters<typeof db.update>[0] extends never ? never : Record<string, unknown>)
      .where(eq(embankmentsTable.id, id))
      .returning();
    if (!updated) throw new AppError(404, 'EMBANKMENT_NOT_FOUND', 'Pematang tidak ditemukan');
    return parseEmbankmentNumerics(updated);
  },

  /** Bulk import from GeoJSON FeatureCollection */
  async importFromGeoJson(fieldId: string, input: ImportEmbankmentInput) {
    // Validate field exists
    const [field] = await db.select({ id: fieldsTable.id })
      .from(fieldsTable)
      .where(eq(fieldsTable.id, fieldId))
      .limit(1);
    if (!field) throw new AppError(404, 'FIELD_NOT_FOUND', 'Lahan tidak ditemukan');

    const insertedIds: string[] = [];

    for (const feature of input.geojson.features) {
      const props    = feature.properties ?? {};
      const name     = String(props[input.name_field] ?? `Pematang ${insertedIds.length + 1}`);
      const code     = input.code_field ? String(props[input.code_field] ?? '') : undefined;
      const geomJson = JSON.stringify(feature.geometry);

      const connectedSubBlocks = await calculateIntersectingSubBlocks(fieldId, feature.geometry);

      const [inserted] = await db.insert(embankmentsTable).values({
        fieldId,
        name,
        code,
        polygonGeom: geomJson,
        connectedSubBlocks: connectedSubBlocks,
      }).returning();

      if (inserted) insertedIds.push(inserted.id);
    }

    return { inserted: insertedIds.length, ids: insertedIds };
  },

  async delete(id: string) {
    await db.update(embankmentsTable)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(embankmentsTable.id, id));
  },
};
