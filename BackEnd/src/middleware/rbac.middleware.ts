import { Request, Response, NextFunction } from 'express';
import { eq, and } from 'drizzle-orm';
import { db } from '@/db/client';
import { userFields } from '@/db/schema/mst';
import { AppError } from '@/middleware/error.middleware';
import type { FieldRole, SystemRole } from '@/shared/types';

// ---------------------------------------------------------------------------
// requireFieldAccess — RBAC per field
//
// Factory middleware: cek apakah user punya field role yang cukup.
// system_admin selalu lolos. field_manager dan operator dibatasi per field.
//
// Cara pakai:
//   router.get('/:fieldId/...', requireAuth, requireFieldAccess('operator'), handler)
//
// Field ID diambil dari req.params.fieldId (atau req.params.id sebagai fallback).
// ---------------------------------------------------------------------------

const ROLE_ORDER: FieldRole[] = ['viewer', 'operator', 'manager'];

export function requireFieldAccess(minRole: FieldRole = 'viewer') {
  return async (
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const user = req.user;
      if (!user) {
        next(new AppError(401, 'UNAUTHORIZED', 'Autentikasi diperlukan'));
        return;
      }

      // system_admin punya akses penuh ke semua field
      if (user.role === 'system_admin') {
        req.fieldRole = 'manager';
        next();
        return;
      }

      const fieldId = req.params['fieldId'] ?? req.params['id'];
      if (!fieldId) {
        next(new AppError(400, 'FIELD_ID_REQUIRED', 'Field ID tidak ditemukan di request'));
        return;
      }

      const [access] = await db
        .select({ fieldRole: userFields.fieldRole })
        .from(userFields)
        .where(
          and(
            eq(userFields.userId, user.id),
            eq(userFields.fieldId, fieldId),
          ),
        )
        .limit(1);

      if (!access) {
        next(new AppError(403, 'FIELD_ACCESS_DENIED', 'Tidak ada akses ke field ini'));
        return;
      }

      const userRoleIdx = ROLE_ORDER.indexOf(access.fieldRole as FieldRole);
      const minRoleIdx  = ROLE_ORDER.indexOf(minRole);

      if (userRoleIdx < minRoleIdx) {
        next(
          new AppError(
            403,
            'INSUFFICIENT_ROLE',
            `Diperlukan setidaknya role '${minRole}' untuk aksi ini`,
          ),
        );
        return;
      }

      req.fieldRole = access.fieldRole as FieldRole;
      next();
    } catch (err) {
      next(err);
    }
  };
}

// ---------------------------------------------------------------------------
// requireSystemRole — cek system_role (system_admin / field_manager / operator)
//
// Dipakai untuk endpoint admin-only, tanpa field scope.
// Cara pakai:
//   router.post('/admin/users', requireAuth, requireSystemRole('system_admin'), handler)
// ---------------------------------------------------------------------------
export function requireSystemRole(...roles: SystemRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const user = req.user;
    if (!user) {
      next(new AppError(401, 'UNAUTHORIZED', 'Autentikasi diperlukan'));
      return;
    }

    if (!roles.includes(user.role)) {
      next(
        new AppError(
          403,
          'FORBIDDEN',
          `Aksi ini hanya untuk: ${roles.join(', ')}`,
        ),
      );
      return;
    }

    next();
  };
}
