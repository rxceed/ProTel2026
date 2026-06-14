import { eq, and, sql, desc, count } from 'drizzle-orm';
import { db, pool } from '@/db/client';
import {
  fields as fieldsTable,
  users as usersTable,
  userFields as userFieldsTable,
  subBlocks as subBlocksTable,
  devices as devicesTable,
  deviceAssignments as deviceAssignmentsTable,
  sensorCalibrations as sensorCalibrationsTable,
  flowPaths as flowPathsTable,
  cropCycles as cropCyclesTable,
  irrigationRuleProfiles as ruleProfilesTable,
} from '@/db/schema/mst';
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
  CreateCropCycleSchema,
  UpdateCropCyclePhaseSchema,
  CreateRuleProfileSchema,
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
type CreateCropCycleInput      = z.infer<typeof CreateCropCycleSchema>;
type UpdateCropCyclePhaseInput = z.infer<typeof UpdateCropCyclePhaseSchema>;
type CreateRuleProfileInput    = z.infer<typeof CreateRuleProfileSchema>;

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
        ...(input.notes                 !== undefined && { notes: input.notes }),
        ...(input.assigned_file_name    !== undefined && { assignedFileName: input.assigned_file_name }),
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

type RawSubBlock = typeof subBlocksTable.$inferSelect;

/** Coerce numeric string columns returned by PostgreSQL into JS numbers. */
function parseSubBlockNumerics(sb: RawSubBlock) {
  return {
    ...sb,
    areaM2:    sb.areaM2    != null ? parseFloat(sb.areaM2)    : null,
    elevationM: sb.elevationM != null ? parseFloat(sb.elevationM) : null,
  };
}

export const subBlocksService = {
  async listByField(fieldId: string) {
    const rows = await db.select()
      .from(subBlocksTable)
      .where(and(eq(subBlocksTable.fieldId, fieldId), eq(subBlocksTable.isActive, true)))
      .orderBy(subBlocksTable.displayOrder, subBlocksTable.name);
    return rows.map(parseSubBlockNumerics);
  },

  async getById(subBlockId: string) {
    const [sb] = await db.select().from(subBlocksTable)
      .where(and(eq(subBlocksTable.id, subBlockId), eq(subBlocksTable.isActive, true)))
      .limit(1);
    if (!sb) throw new AppError(404, 'SUB_BLOCK_NOT_FOUND', 'Sub-block tidak ditemukan');
    return parseSubBlockNumerics(sb);
  },

  async create(fieldId: string, input: CreateSubBlockInput) {
    const geomJson = JSON.stringify(input.polygon_geom);
    
    const [inserted] = await db.insert(subBlocksTable).values({
      fieldId,
      name:         input.name,
      code:         input.code,
      polygonGeom:  geomJson,
      elevationM:   input.elevation_m?.toString(),
      soilType:     input.soil_type,
      displayOrder: input.display_order,
      notes:        input.notes,
    }).returning();

    if (!inserted) throw new AppError(500, 'CREATE_FAILED', 'Gagal membuat sub-block');
    return inserted;
  },

  async update(subBlockId: string, input: UpdateSubBlockInput) {
    const setParts: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name          !== undefined) setParts['name']          = input.name;
    if (input.code          !== undefined) setParts['code']          = input.code;
    if (input.elevation_m   !== undefined) setParts['elevationM']    = input.elevation_m;
    if (input.soil_type     !== undefined) setParts['soilType']      = input.soil_type;
    if (input.display_order !== undefined) setParts['displayOrder']  = input.display_order;
    if (input.notes         !== undefined) setParts['notes']         = input.notes;
    if (input.polygon_geom  !== undefined) setParts['polygonGeom']   = JSON.stringify(input.polygon_geom);

    const [updated] = await db.update(subBlocksTable)
      .set(setParts as Parameters<typeof db.update>[0] extends never ? never : Record<string, unknown>)
      .where(eq(subBlocksTable.id, subBlockId))
      .returning();
    if (!updated) throw new AppError(404, 'SUB_BLOCK_NOT_FOUND', 'Sub-block tidak ditemukan');
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

    return { inserted: insertedIds.length, ids: insertedIds };
  },

  async delete(subBlockId: string) {
    await db.update(subBlocksTable)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(subBlocksTable.id, subBlockId));
  },
};

// ===========================================================================
// DEVICES
// ===========================================================================

export const devicesService = {
  async listAll(query: Record<string, unknown>) {
    const { page, limit, offset } = parsePagination(query);
    const [rows, [{ value: total }]] = await Promise.all([
      db.select().from(devicesTable)
        .orderBy(devicesTable.deviceCode)
        .limit(limit).offset(offset),
      db.select({ value: count() }).from(devicesTable),
    ]);
    return { rows, meta: buildPaginationMeta({ page, limit, offset }, total) };
  },

  async listByField(fieldId: string) {
    return db.select().from(devicesTable)
      .where(eq(devicesTable.fieldId, fieldId))
      .orderBy(devicesTable.deviceCode);
  },

  async getById(deviceId: string) {
    const [dev] = await db.select().from(devicesTable)
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
    }).returning();
    return dev!;
  },

  async update(deviceId: string, input: Partial<CreateDeviceInput>) {
    const [updated] = await db.update(devicesTable)
      .set({
        ...(input.device_type      !== undefined && { deviceType: input.device_type }),
        ...(input.connection_type  !== undefined && { connectionType: input.connection_type }),
        ...(input.hardware_model   !== undefined && { hardwareModel: input.hardware_model }),
        ...(input.firmware_version !== undefined && { firmwareVersion: input.firmware_version }),
        ...(input.notes            !== undefined && { notes: input.notes }),
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
  },

  async unassign(deviceId: string, unassignedBy: string) {
    await db.update(deviceAssignmentsTable)
      .set({ unassignedAt: new Date(), unassignedBy })
      .where(and(
        eq(deviceAssignmentsTable.deviceId, deviceId),
        sql`${deviceAssignmentsTable.unassignedAt} IS NULL`,
      ));

    await db.update(devicesTable)
      .set({ subBlockId: null, updatedAt: new Date() })
      .where(eq(devicesTable.id, deviceId));
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
        sql`${flowPathsTable.fromSubBlockId} IN (
          SELECT id FROM mst.sub_blocks WHERE field_id = ${fieldId}
        )`,
        eq(flowPathsTable.isActive, true),
      ));
  },

  async create(fieldId: string, input: CreateFlowPathInput) {
    // Validasi kedua sub-block ada dan milik field ini
    const [from] = await db.select({ fieldId: subBlocksTable.fieldId })
      .from(subBlocksTable).where(eq(subBlocksTable.id, input.from_sub_block_id)).limit(1);
    const [to]   = await db.select({ fieldId: subBlocksTable.fieldId })
      .from(subBlocksTable).where(eq(subBlocksTable.id, input.to_sub_block_id)).limit(1);

    if (!from || from.fieldId !== fieldId) throw new AppError(400, 'INVALID_FROM_SUB_BLOCK', 'from_sub_block_id tidak valid');
    if (!to   || to.fieldId   !== fieldId) throw new AppError(400, 'INVALID_TO_SUB_BLOCK',   'to_sub_block_id tidak valid');

    const [fp] = await db.insert(flowPathsTable).values({
      fromSubBlockId: input.from_sub_block_id,
      toSubBlockId:   input.to_sub_block_id,
      flowType:       input.flow_type,
      notes:          input.notes,
    }).returning();
    return fp!;
  },

  async delete(flowPathId: string) {
    await db.update(flowPathsTable)
      .set({ isActive: false })
      .where(eq(flowPathsTable.id, flowPathId));
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

/** Coerce numeric string columns returned by PostgreSQL into JS numbers. */
function parseRuleProfileNumerics(profile: RawRuleProfile) {
  return {
    ...profile,
    awdLowerThresholdCm: parseFloat(profile.awdLowerThresholdCm),
    awdUpperTargetCm:    parseFloat(profile.awdUpperTargetCm),
    droughtAlertCm:      profile.droughtAlertCm != null ? parseFloat(profile.droughtAlertCm) : null,
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
      awdLowerThresholdCm:    input.awd_lower_threshold_cm.toString(),
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
        ...(input.awd_lower_threshold_cm !== undefined && { awdLowerThresholdCm: input.awd_lower_threshold_cm.toString() }),
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
