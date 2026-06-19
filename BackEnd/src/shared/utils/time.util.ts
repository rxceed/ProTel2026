/**
 * Parse expiry string ke milliseconds
 * Contoh: '15m' → 900_000, '7d' → 604_800_000
 */
export function parseExpiryMs(expiry: string): number {
  const match = expiry.match(/^(\d+)([smhd])$/);
  if (!match) return 15 * 60 * 1_000; // default 15 menit

  const value = parseInt(match[1]!, 10);
  const units: Record<string, number> = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return value * (units[match[2]!] ?? 60_000);
}

/**
 * Parse expiry ke detik (untuk expires_in di OAuth2 response)
 */
export function parseExpirySec(expiry: string): number {
  return Math.floor(parseExpiryMs(expiry) / 1_000);
}
