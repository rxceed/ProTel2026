import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

// ---------------------------------------------------------------------------
// Schema validasi env vars — dijalankan saat startup
// Jika ada yang kurang/salah, server TIDAK akan start
// ---------------------------------------------------------------------------
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  CORS_ORIGIN: z.string().default('*'),
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
    .default('info'),

  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL wajib diisi'),
  DB_POOL_MIN: z.coerce.number().int().nonnegative().default(2),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),

  // JWT
  JWT_SECRET: z.string().min(32, 'JWT_SECRET minimal 32 karakter'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  // Model service (Server 2)
  DECISION_ENGINE_URL: z.string().url().default('http://localhost:8000'),
  DECISION_ENGINE_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),

  // Cloudflare R2 (opsional saat development)
  R2_ENDPOINT: z.preprocess((val) => val === '' ? undefined : val, z.string().url().optional()),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_NAME: z.string().default('awd-orthomosaic'),
  R2_PUBLIC_URL: z.preprocess((val) => val === '' ? undefined : val, z.string().url().optional()),

  // GISPROC
  GISPROC_API_BASE_URI: z.preprocess((val) => val === '' ? undefined : val, z.string().url().default('http://localhost:8001')),

  // MQTT
  MQTT_URL: z.string().url().default('mqtt://localhost:1883'),
});

const _parsed = envSchema.safeParse(process.env);

if (!_parsed.success) {
  console.error('\n❌ Konfigurasi environment tidak valid:');
  const errors = _parsed.error.flatten().fieldErrors;
  Object.entries(errors).forEach(([key, msgs]) => {
    console.error(`   ${key}: ${msgs?.join(', ')}`);
  });
  console.error('\nPeriksa file .env kamu.\n');
  process.exit(1);
}

export const config = _parsed.data;
export type Config = typeof config;
