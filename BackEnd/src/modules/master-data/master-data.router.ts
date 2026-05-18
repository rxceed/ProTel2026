import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '@/middleware/auth.middleware';
import { requireFieldAccess, requireSystemRole } from '@/middleware/rbac.middleware';
import { validate } from '@/middleware/validate.middleware';
import { successResponse } from '@/shared/utils/response.util';
import {
  fieldsService,
  subBlocksService,
  devicesService,
  flowPathsService,
  cropCyclesService,
  ruleProfilesService,
} from './master-data.service';
import {
  CreateFieldSchema,
  UpdateFieldSchema,
  AssignUserFieldSchema,
  CreateSubBlockSchema,
  UpdateSubBlockSchema,
  ImportSubBlocksSchema,
  CreateDeviceSchema,
  UpdateDeviceSchema,
  AssignDeviceSchema,
  CalibrateDeviceSchema,
  CreateFlowPathSchema,
  CreateCropCycleSchema,
  UpdateCropCyclePhaseSchema,
  CreateRuleProfileSchema,
  UpdateRuleProfileSchema,
} from './master-data.schema';

export const masterDataRouter = Router();

// Alias handlers untuk mengurangi boilerplate
const h = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };

// ===========================================================================
// FIELDS  —  /fields
// ===========================================================================

// GET /fields — list semua field milik user (atau semua jika admin)
masterDataRouter.get(
  '/fields',
  requireAuth,
  h(async (req, res) => {
    const { rows, meta } = await fieldsService.list(
      req.user!.id,
      req.user!.role === 'system_admin',
      req.query as Record<string, unknown>,
    );
    res.json(successResponse(rows, meta));
  }),
);

// GET /fields/:fieldId
masterDataRouter.get(
  '/fields/:fieldId',
  requireAuth,
  requireFieldAccess('viewer'),
  h(async (req, res) => {
    const field = await fieldsService.getById(req.params['fieldId']!, req.user!.id);
    res.json(successResponse(field));
  }),
);

// POST /fields — only system_admin
masterDataRouter.post(
  '/fields',
  requireAuth,
  requireSystemRole('system_admin'),
  validate(CreateFieldSchema),
  h(async (req, res) => {
    const field = await fieldsService.create(req.body, req.user!.id);
    res.status(201).json(successResponse(field));
  }),
);

// PATCH /fields/:fieldId
masterDataRouter.patch(
  '/fields/:fieldId',
  requireAuth,
  requireSystemRole('system_admin'),
  validate(UpdateFieldSchema),
  h(async (req, res) => {
    const field = await fieldsService.update(req.params['fieldId']!, req.body);
    res.json(successResponse(field));
  }),
);

// POST /fields/:fieldId/users — assign user ke field
masterDataRouter.post(
  '/fields/:fieldId/users',
  requireAuth,
  requireFieldAccess('manager'),
  validate(AssignUserFieldSchema),
  h(async (req, res) => {
    await fieldsService.assignUser(req.params['fieldId']!, req.body, req.user!.id);
    res.json(successResponse({ message: 'Akses diberikan' }));
  }),
);

// DELETE /fields/:fieldId/users/:userId — revoke access
masterDataRouter.delete(
  '/fields/:fieldId/users/:userId',
  requireAuth,
  requireFieldAccess('manager'),
  h(async (req, res) => {
    await fieldsService.revokeUser(req.params['fieldId']!, req.params['userId']!);
    res.json(successResponse({ message: 'Akses dicabut' }));
  }),
);

// DELETE /fields/:fieldId
masterDataRouter.delete(
  '/fields/:fieldId',
  requireAuth,
  requireSystemRole('system_admin'),
  h(async (req, res) => {
    await fieldsService.delete(req.params['fieldId']!);
    res.json(successResponse({ message: 'Lahan berhasil dihapus' }));
  }),
);

// ===========================================================================
// SUB-BLOCKS  —  /fields/:fieldId/sub-blocks
// ===========================================================================

// GET /fields/:fieldId/sub-blocks
masterDataRouter.get(
  '/fields/:fieldId/sub-blocks',
  requireAuth,
  requireFieldAccess('viewer'),
  h(async (req, res) => {
    const rows = await subBlocksService.listByField(req.params['fieldId']!);
    res.json(successResponse(rows));
  }),
);

// POST /fields/:fieldId/sub-blocks
masterDataRouter.post(
  '/fields/:fieldId/sub-blocks',
  requireAuth,
  requireFieldAccess('manager'),
  validate(CreateSubBlockSchema),
  h(async (req, res) => {
    const sb = await subBlocksService.create(req.params['fieldId']!, req.body);
    res.status(201).json(successResponse(sb));
  }),
);

// POST /fields/:fieldId/sub-blocks/import-geojson — batch import dari GeoJSON file
masterDataRouter.post(
  '/fields/:fieldId/sub-blocks/import-geojson',
  requireAuth,
  requireFieldAccess('manager'),
  validate(ImportSubBlocksSchema),
  h(async (req, res) => {
    const result = await subBlocksService.importFromGeoJson(req.params['fieldId']!, req.body);
    res.status(201).json(successResponse(result));
  }),
);

// PATCH /sub-blocks/:id
masterDataRouter.patch(
  '/sub-blocks/:id',
  requireAuth,
  validate(UpdateSubBlockSchema),
  h(async (req, res) => {
    const sb = await subBlocksService.update(req.params['id']!, req.body);
    res.json(successResponse(sb));
  }),
);

// GET /sub-blocks/:id
masterDataRouter.get(
  '/sub-blocks/:id',
  requireAuth,
  h(async (req, res) => {
    const sb = await subBlocksService.getById(req.params['id']!);
    res.json(successResponse(sb));
  }),
);

// DELETE /sub-blocks/:id
masterDataRouter.delete(
  '/sub-blocks/:id',
  requireAuth,
  requireFieldAccess('manager'),
  h(async (req, res) => {
    await subBlocksService.delete(req.params['id']!);
    res.json(successResponse({ message: 'Petak berhasil dihapus' }));
  }),
);

// ===========================================================================
// DEVICES  —  /fields/:fieldId/devices
// ===========================================================================

// GET /fields/:fieldId/devices
masterDataRouter.get(
  '/fields/:fieldId/devices',
  requireAuth,
  requireFieldAccess('operator'),
  h(async (req, res) => {
    const rows = await devicesService.listByField(req.params['fieldId']!);
    res.json(successResponse(rows));
  }),
);

// POST /fields/:fieldId/devices
masterDataRouter.post(
  '/fields/:fieldId/devices',
  requireAuth,
  requireFieldAccess('manager'),
  validate(CreateDeviceSchema),
  h(async (req, res) => {
    const dev = await devicesService.create(req.params['fieldId']!, req.body);
    res.status(201).json(successResponse(dev));
  }),
);

// PATCH /devices/:id
masterDataRouter.patch(
  '/devices/:id',
  requireAuth,
  validate(UpdateDeviceSchema.partial()),
  h(async (req, res) => {
    const dev = await devicesService.update(req.params['id']!, req.body);
    res.json(successResponse(dev));
  }),
);

// GET /devices/:id
masterDataRouter.get(
  '/devices/:id',
  requireAuth,
  h(async (req, res) => {
    const dev = await devicesService.getById(req.params['id']!);
    res.json(successResponse(dev));
  }),
);

// DELETE /devices/:id
masterDataRouter.delete(
  '/devices/:id',
  requireAuth,
  requireFieldAccess('manager'),
  h(async (req, res) => {
    await devicesService.delete(req.params['id']!);
    res.json(successResponse({ message: 'Perangkat berhasil dihapus' }));
  }),
);

// POST /devices/:id/assign
masterDataRouter.post(
  '/devices/:id/assign',
  requireAuth,
  validate(AssignDeviceSchema),
  h(async (req, res) => {
    const dev = await devicesService.getById(req.params['id']!);
    await devicesService.assign(req.params['id']!, dev.fieldId, req.body, req.user!.id);
    res.json(successResponse({ message: 'Device berhasil di-assign' }));
  }),
);

// POST /devices/:id/unassign
masterDataRouter.post(
  '/devices/:id/unassign',
  requireAuth,
  h(async (req, res) => {
    await devicesService.unassign(req.params['id']!, req.user!.id);
    res.json(successResponse({ message: 'Device berhasil di-unassign' }));
  }),
);

// POST /devices/:id/calibrate
masterDataRouter.post(
  '/devices/:id/calibrate',
  requireAuth,
  validate(CalibrateDeviceSchema),
  h(async (req, res) => {
    const cal = await devicesService.calibrate(req.params['id']!, req.body, req.user!.id);
    res.status(201).json(successResponse(cal));
  }),
);

// ===========================================================================
// FLOW PATHS  —  /fields/:fieldId/flow-paths
// ===========================================================================

// GET /fields/:fieldId/flow-paths
masterDataRouter.get(
  '/fields/:fieldId/flow-paths',
  requireAuth,
  requireFieldAccess('viewer'),
  h(async (req, res) => {
    const rows = await flowPathsService.listByField(req.params['fieldId']!);
    res.json(successResponse(rows));
  }),
);

// POST /fields/:fieldId/flow-paths
masterDataRouter.post(
  '/fields/:fieldId/flow-paths',
  requireAuth,
  requireFieldAccess('manager'),
  validate(CreateFlowPathSchema),
  h(async (req, res) => {
    const fp = await flowPathsService.create(req.params['fieldId']!, req.body);
    res.status(201).json(successResponse(fp));
  }),
);

// DELETE /flow-paths/:id
masterDataRouter.delete(
  '/flow-paths/:id',
  requireAuth,
  h(async (req, res) => {
    await flowPathsService.delete(req.params['id']!);
    res.json(successResponse({ message: 'Flow path dihapus' }));
  }),
);

// ===========================================================================
// CROP CYCLES  —  /sub-blocks/:id/crop-cycles
// ===========================================================================

// GET /sub-blocks/:id/crop-cycles
masterDataRouter.get(
  '/sub-blocks/:id/crop-cycles',
  requireAuth,
  h(async (req, res) => {
    const rows = await cropCyclesService.listBySubBlock(req.params['id']!);
    res.json(successResponse(rows));
  }),
);

// POST /sub-blocks/:id/crop-cycles — mulai musim tanam baru
masterDataRouter.post(
  '/sub-blocks/:id/crop-cycles',
  requireAuth,
  validate(CreateCropCycleSchema),
  h(async (req, res) => {
    const sb = await subBlocksService.getById(req.params['id']!);
    const cc = await cropCyclesService.create(req.params['id']!, sb.fieldId, req.body);
    res.status(201).json(successResponse(cc));
  }),
);

// PATCH /crop-cycles/:id/phase — advance ke fase berikutnya
masterDataRouter.patch(
  '/crop-cycles/:id/phase',
  requireAuth,
  validate(UpdateCropCyclePhaseSchema),
  h(async (req, res) => {
    const cc = await cropCyclesService.advancePhase(req.params['id']!, req.body);
    res.json(successResponse(cc));
  }),
);

// POST /crop-cycles/:id/complete — tandai panen/selesai
masterDataRouter.post(
  '/crop-cycles/:id/complete',
  requireAuth,
  h(async (req, res) => {
    const cc = await cropCyclesService.complete(req.params['id']!, req.body.actual_harvest_date);
    res.json(successResponse(cc));
  }),
);

// GET /crop-cycles/:id
masterDataRouter.get(
  '/crop-cycles/:id',
  requireAuth,
  h(async (req, res) => {
    const cc = await cropCyclesService.getById(req.params['id']!);
    res.json(successResponse(cc));
  }),
);

// DELETE /crop-cycles/:id
masterDataRouter.delete(
  '/crop-cycles/:id',
  requireAuth,
  h(async (req, res) => {
    await cropCyclesService.delete(req.params['id']!);
    res.json(successResponse({ message: 'Siklus tanam dihapus' }));
  }),
);

// ===========================================================================
// RULE PROFILES  —  /rule-profiles
// ===========================================================================

// GET /rule-profiles
masterDataRouter.get(
  '/rule-profiles',
  requireAuth,
  h(async (req, res) => {
    const result = await ruleProfilesService.list(req.query as Record<string, unknown>);
    res.json(successResponse(result.rows, result.meta));
  }),
);

// POST /rule-profiles
masterDataRouter.post(
  '/rule-profiles',
  requireAuth,
  requireSystemRole('system_admin'),
  validate(CreateRuleProfileSchema),
  h(async (req, res) => {
    const profile = await ruleProfilesService.create(req.body, req.user!.id);
    res.status(201).json(successResponse(profile));
  }),
);

// GET /rule-profiles/:id
masterDataRouter.get(
  '/rule-profiles/:id',
  requireAuth,
  h(async (req, res) => {
    const profile = await ruleProfilesService.getById(req.params['id']!);
    res.json(successResponse(profile));
  }),
);

// PATCH /rule-profiles/:id
masterDataRouter.patch(
  '/rule-profiles/:id',
  requireAuth,
  requireSystemRole('system_admin'),
  validate(UpdateRuleProfileSchema),
  h(async (req, res) => {
    const profile = await ruleProfilesService.update(req.params['id']!, req.body);
    res.json(successResponse(profile));
  }),
);

// DELETE /rule-profiles/:id
masterDataRouter.delete(
  '/rule-profiles/:id',
  requireAuth,
  requireSystemRole('system_admin'),
  h(async (req, res) => {
    await ruleProfilesService.delete(req.params['id']!);
    res.json(successResponse({ message: 'Profil aturan dihapus' }));
  }),
);
