import { PaginationOptions, PaginationMeta } from '@/shared/types';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Zod schema untuk pagination query params
// ---------------------------------------------------------------------------
export const PaginationQuerySchema = z.object({
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ---------------------------------------------------------------------------
// Parse pagination dari query string
// ---------------------------------------------------------------------------
export function parsePagination(
  query: Record<string, unknown>,
  defaults = { page: 1, limit: 20 },
): PaginationOptions {
  const page  = Math.max(1, parseInt(String(query['page']  ?? defaults.page),  10) || defaults.page);
  const limit = Math.min(100, Math.max(1, parseInt(String(query['limit'] ?? defaults.limit), 10) || defaults.limit));
  return { page, limit, offset: (page - 1) * limit };
}

// ---------------------------------------------------------------------------
// Buat metadata pagination untuk response
// ---------------------------------------------------------------------------
export function buildPaginationMeta(
  opts: PaginationOptions,
  total: number,
): PaginationMeta {
  return {
    page:       opts.page,
    limit:      opts.limit,
    total,
    totalPages: Math.ceil(total / opts.limit),
  };
}
