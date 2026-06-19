/**
 * db:reset — Hapus semua schema lalu jalankan ulang migration
 * HANYA untuk development! Jangan dijalankan di production.
 * Usage: npm run db:reset
 */
import 'dotenv/config';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import path from 'path';

async function reset() {
  if (process.env.NODE_ENV === 'production') {
    console.error('❌ db:reset TIDAK BOLEH dijalankan di production!');
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is missing in .env');
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
  });
  
  const client = await pool.connect();
  const db = drizzle(pool);

  console.log('\n⚠️  Smart AWD — Database RESET (development only)\n');

  try {
    console.log('🗑️  Menghapus schemas...');
    await client.query(`
      DROP SCHEMA IF EXISTS mst  CASCADE;
      DROP SCHEMA IF EXISTS trx  CASCADE;
      DROP SCHEMA IF EXISTS sys  CASCADE;
      DROP SCHEMA IF EXISTS logs CASCADE;
      DROP SCHEMA IF EXISTS drizzle CASCADE;
      DROP TABLE  IF EXISTS public.schema_migrations;
    `);
    client.release();

    console.log('📄 Membaca folder database/migrations...');
    const migrationsFolder = path.join(__dirname, '../../database/migrations');

    console.log('⚙️  Menjalankan migrasi Drizzle dari awal...');
    await migrate(db, { migrationsFolder });

    console.log('✅ Reset & Migration berhasil! Database bersih dengan schema fresh.\n');
    console.log('   Langkah selanjutnya:');
    console.log('   npm run db:seed && ADMIN_PASSWORD=xxx npm run seed:admin\n');

  } catch (err: any) {
    console.error('\n❌ Reset gagal:', err.message, '\n');
    process.exit(1);
  } finally {
    await pool.end();
  }
}

reset();
