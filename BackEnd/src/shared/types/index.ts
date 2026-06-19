// ---------------------------------------------------------------------------
// Shared TypeScript types & interfaces
// Digunakan lintas modul — jangan taruh business logic di sini
// ---------------------------------------------------------------------------

/** Payload JWT access token yang di-decode */
export interface JwtPayload {
  sub: string;        // user ID (UUID)
  role: SystemRole;   // system_role
  iat?: number;
  exp?: number;
}

/** System role — sesuai mst.users.system_role CHECK constraint */
export type SystemRole = 'system_admin' | 'field_manager' | 'operator';

/** Field role — sesuai mst.user_fields.field_role CHECK constraint */
export type FieldRole = 'manager' | 'operator' | 'viewer';

/** Extend Express Request untuk menyertakan data auth */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Populated oleh auth.middleware setelah JWT verify */
      user?: {
        id: string;
        role: SystemRole;
      };
      /** Populated oleh rbac.middleware untuk field-scoped request */
      fieldRole?: FieldRole;
    }
  }
}

/** Opsi pagination standar untuk query */
export interface PaginationOptions {
  page: number;
  limit: number;
  offset: number;
}

/** Metadata pagination untuk response */
export interface PaginationMeta {
  page:        number;
  limit:       number;
  total:       number;
  totalPages:  number;
  [key: string]: unknown; // required untuk kompatibilitas dengan ApiResponse['meta']
}
