// ---------------------------------------------------------------------------
// Standard API response format
// Semua endpoint menggunakan format ini untuk konsistensi
// ---------------------------------------------------------------------------

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    [key: string]: unknown;
  };
}

/** Buat respons sukses */
export function successResponse<T>(
  data: T,
  meta?: ApiResponse<T>['meta'],
): ApiResponse<T> {
  return {
    success: true,
    data,
    ...(meta !== undefined && { meta }),
  };
}

/** Buat respons error */
export function errorResponse(
  code: string,
  message: string,
  details?: unknown,
): ApiResponse<never> {
  return {
    success: false,
    error: {
      code,
      message,
      ...(details !== undefined && { details }),
    },
  };
}
