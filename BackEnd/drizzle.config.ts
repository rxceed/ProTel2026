import { defineConfig } from 'drizzle-kit';
import dotenv from 'dotenv';

dotenv.config();

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required for drizzle-kit');
}

export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './database/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  // Drizzle-kit menghasilkan file .sql ke database/migrations
  verbose: true,
  strict: true,
});
