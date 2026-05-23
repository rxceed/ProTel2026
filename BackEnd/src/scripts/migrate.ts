/**
 * db:migrate — Menjalankan migrasi Drizzle dari database/migrations
 * Usage: npm run db:migrate
 */
import 'dotenv/config';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import path from 'path';

async function runMigrate() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is missing in .env');
  }

  console.log('\n🚀 Smart AWD — Database Migration (Drizzle)\n');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1, // Batasi 1 koneksi khusus untuk migrasi
  });
  
  const db = drizzle(pool);

  try {
    console.log('📄 Membaca folder database/migrations...');
    const migrationsFolder = path.join(__dirname, '../../database/migrations');
    
    console.log('⚙️  Menjalankan migrasi secara incremental...');
    await migrate(db, { migrationsFolder });

    console.log('✅ Migration berhasil!\n');
    console.log('   Langkah selanjutnya:');
    console.log('   1. npm run db:seed       — seed data referensi');
    console.log('   2. ADMIN_PASSWORD=xxx npm run seed:admin — buat user admin\n');

  } catch (err: any) {
    console.error('\n❌ Migration gagal:', err.message, '\n');
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigrate();
