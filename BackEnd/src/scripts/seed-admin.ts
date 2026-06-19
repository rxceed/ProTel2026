/**
 * Seed script: buat user system_admin pertama
 *
 * Jalankan: npm run seed:admin
 * Env vars (opsional, ada default):
 *   ADMIN_EMAIL    = admin@smartawd.id
 *   ADMIN_PASSWORD = (wajib diisi, tidak ada default untuk keamanan)
 *   ADMIN_NAME     = System Administrator
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db, pool, testConnection } from '../db/client';
import { users } from '../db/schema/mst';

async function seedAdmin(): Promise<void> {
  await testConnection();

  const email    = process.env['ADMIN_EMAIL']    ?? 'admin@smartawd.id';
  const password = process.env['ADMIN_PASSWORD'];
  const fullName = process.env['ADMIN_NAME']     ?? 'System Administrator';

  if (!password) {
    console.error('\n❌ ADMIN_PASSWORD env var wajib diisi');
    console.error('   Contoh: ADMIN_PASSWORD=RahasiaKuat123! npm run seed:admin\n');
    process.exit(1);
  }

  // Cek apakah admin sudah ada
  const [existing] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);

  if (existing) {
    console.log(`\n✓ Admin sudah ada: ${existing.email}`);
    console.log('  Gunakan UI atau UPDATE SQL jika ingin reset password.\n');
    await pool.end();
    return;
  }

  // Hash password (cost 12 — aman untuk production)
  const passwordHash = await bcrypt.hash(password, 12);

  const [newUser] = await db
    .insert(users)
    .values({
      email:        email.toLowerCase(),
      passwordHash,
      fullName,
      systemRole:   'system_admin',
      isActive:     true,
    })
    .returning({ id: users.id, email: users.email });

  console.log('\n✓ Admin user berhasil dibuat:');
  console.log(`  ID:    ${newUser?.id}`);
  console.log(`  Email: ${newUser?.email}`);
  console.log(`  Name:  ${fullName}`);
  console.log('\n  ⚠️  Simpan password ini dengan aman — tidak bisa dilihat lagi!\n');

  await pool.end();
}

seedAdmin().catch((err: unknown) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
