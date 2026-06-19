import { createHash, randomBytes } from 'crypto';

/**
 * Hash string menggunakan SHA-256
 * Dipakai untuk menyimpan refresh token ke DB (tidak pernah simpan raw token)
 */
export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Generate random token (URL-safe base64)
 * @param bytes - jumlah random bytes (default: 48 → 64 char base64url)
 */
export function generateToken(bytes = 48): string {
  return randomBytes(bytes).toString('base64url');
}
