/**
 * db:seed:dev — Seed data dummy untuk development/testing
 * Menambahkan: 2 field, sub-blocks, devices, recommendations, alerts, telemetry
 *
 * Idempotent: aman dijalankan berkali-kali
 * Usage: npm run db:seed:dev
 */
import 'dotenv/config';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function seedDev() {
  const client = await pool.connect();
  console.log('\n🧪 Smart AWD — Dev Dummy Data Seeding\n');

  try {
    // ── Admin user ───────────────────────────────────────────────────────────
    const devPassword = process.env.ADMIN_PASSWORD || 'DevPassword123!';
    const hash = await bcrypt.hash(devPassword, 12);
    const adminEmail = 'admin@smartawd.id';

    const adminRes = await client.query(`
      INSERT INTO mst.users (email, password_hash, full_name, system_role)
      VALUES ($1, $2, 'System Administrator', 'system_admin')
      ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
      RETURNING id
    `, [adminEmail, hash]);
    const adminId = adminRes.rows[0].id;
    console.log(`  → admin user: ${adminEmail}`);

    // ── Field 1: Demak ───────────────────────────────────────────────────────
    const fieldId1 = randomUUID();
    await client.query(`
      INSERT INTO mst.fields (id, name, adm4_code, water_source_type, area_hectares, operator_count_default)
      VALUES ($1, 'Lahan Sentral Demak', '332101', 'irrigated', 5.2, 2)
      ON CONFLICT DO NOTHING
    `, [fieldId1]);

    const sb1Id = randomUUID(), sb2Id = randomUUID();
    await client.query(`
      INSERT INTO mst.sub_blocks (id, field_id, name, code, polygon_geom, elevation_m, soil_type)
      VALUES
        ($1, $2, 'Blok Utara 1', 'BU-1',
         ST_SetSRID(ST_GeomFromGeoJSON('{"type":"Polygon","coordinates":[[[106.8,-6.2],[106.81,-6.2],[106.81,-6.21],[106.8,-6.21],[106.8,-6.2]]]}'), 4326),
         12.5, 'clay'),
        ($3, $2, 'Blok Selatan 2', 'BS-2',
         ST_SetSRID(ST_GeomFromGeoJSON('{"type":"Polygon","coordinates":[[[106.82,-6.22],[106.83,-6.22],[106.83,-6.23],[106.82,-6.23],[106.82,-6.22]]]}'), 4326),
         11.2, 'loam')
      ON CONFLICT DO NOTHING
    `, [sb1Id, fieldId1, sb2Id]);

    const dev1Id = randomUUID();
    const devN2Id = randomUUID();
    await client.query(`
      INSERT INTO mst.devices (id, field_id, device_code, device_type, connection_type, hardware_model, firmware_version)
      VALUES 
        ($1, $2, 'N1', 'awd_water_level', 'lorawan', 'SMART-AWD-V2', '2.1.0'),
        ($3, $2, 'N2', 'awd_water_level', 'lorawan', 'SMART-AWD-V2', '2.1.0')
      ON CONFLICT DO NOTHING
    `, [dev1Id, fieldId1, devN2Id]);
    await client.query(`
      INSERT INTO mst.device_assignments (device_id, sub_block_id, field_id)
      VALUES 
        ($1, $2, $4),
        ($3, $5, $4)
      ON CONFLICT DO NOTHING
    `, [dev1Id, sb1Id, devN2Id, fieldId1, sb2Id]);

    // ── Field 2: Subang ──────────────────────────────────────────────────────
    const fieldId2 = randomUUID();
    await client.query(`
      INSERT INTO mst.fields (id, name, adm4_code, water_source_type, area_hectares, operator_count_default)
      VALUES ($1, 'Lahan Percobaan Subang', '321301', 'rainfed', 3.5, 1)
      ON CONFLICT DO NOTHING
    `, [fieldId2]);

    const sb3Id = randomUUID(), sb4Id = randomUUID();
    await client.query(`
      INSERT INTO mst.sub_blocks (id, field_id, name, code, polygon_geom, elevation_m, soil_type)
      VALUES
        ($1, $2, 'Blok Barat A', 'BB-A',
         ST_SetSRID(ST_GeomFromGeoJSON('{"type":"Polygon","coordinates":[[[107.75,-6.35],[107.76,-6.35],[107.76,-6.36],[107.75,-6.36],[107.75,-6.35]]]}'), 4326),
         22.0, 'silt'),
        ($3, $2, 'Blok Timur B', 'BT-B',
         ST_SetSRID(ST_GeomFromGeoJSON('{"type":"Polygon","coordinates":[[[107.77,-6.37],[107.78,-6.37],[107.78,-6.38],[107.77,-6.38],[107.77,-6.37]]]}'), 4326),
         21.5, 'silt')
      ON CONFLICT DO NOTHING
    `, [sb3Id, fieldId2, sb4Id]);

    const dev2Id = randomUUID();
    await client.query(`
      INSERT INTO mst.devices (id, field_id, device_code, device_type, connection_type, hardware_model, firmware_version)
      VALUES ($1, $2, 'N3', 'awd_water_level', 'lorawan', 'SMART-AWD-V3', '3.0.1')
      ON CONFLICT DO NOTHING
    `, [dev2Id, fieldId2]);
    await client.query(`
      INSERT INTO mst.device_assignments (device_id, sub_block_id, field_id)
      VALUES ($1, $2, $3) ON CONFLICT DO NOTHING
    `, [dev2Id, sb3Id, fieldId2]);

    // ── Decision Jobs + Recommendations ─────────────────────────────────────
    for (const [fieldId, sbA, sbB] of [[fieldId1, sb1Id, sb2Id], [fieldId2, sb3Id, sb4Id]]) {
      const jobId = randomUUID();
      await client.query(`
        INSERT INTO sys.decision_jobs (id, field_id, status, engine_version, completed_at)
        VALUES ($1, $2, 'completed', 'v1.0.4', now()) ON CONFLICT DO NOTHING
      `, [jobId, fieldId]);

      await client.query(`
        INSERT INTO trx.irrigation_recommendations
          (id, field_id, sub_block_id, decision_job_id, generated_at, valid_until,
           recommendation_type, priority_rank, priority_score,
           command_template_code, command_text, reason_summary,
           confidence_level, water_level_cm_at_decision)
        VALUES
          ($1,$2,$3,$4,now(), now()+interval '24h', 'irrigate',1,'85.5','IRR_START',
           'Nyalakan Pompa Air selama 3 jam',
           'Elevasi air mencapai batas bawah -15cm, fase vegetatif memerlukan genangan 2cm.',
           'high','-15.2'),
          ($5,$2,$6,$4,now(), now()+interval '24h', 'observe',2,'40.0','MAINTAIN',
           'Pertahankan Kondisi Saat Ini',
           'Tingkat air (5cm) ideal untuk menghambat gulma.',
           'medium','5.0')
        ON CONFLICT DO NOTHING
      `, [randomUUID(), fieldId, sbA, jobId, randomUUID(), sbB]);
    }

    // ── Telemetry Records (24 jam tiap sub-block) ────────────────────────────
    console.log('  → telemetry records (24h per sub-block)...');
    const allSbs = [
      { id: sb1Id, devId: dev1Id, code: 'N1' },
      { id: sb2Id, devId: devN2Id, code: 'N2' },
      { id: sb3Id, devId: dev2Id, code: 'N3' },
      { id: sb4Id, devId: dev2Id, code: 'N3' },
    ];
    for (const sb of allSbs) {
      for (let i = 24; i >= 0; i--) {
        const ts = new Date(Date.now() - i * 3_600_000).toISOString();
        const wl = (Math.sin((24 - i) / 3) * 12).toFixed(2);
        const temp = (25 + Math.cos(i / 2) * 4).toFixed(2);
        const hum  = (70 + Math.sin(i / 4) * 20).toFixed(2);
        const bat  = Math.max(10, 100 - (24 - i) * 0.1).toFixed(2);
        await client.query(`
          INSERT INTO trx.telemetry_records
            (id, event_timestamp, device_id, device_code, sub_block_id,
             water_level_cm, temperature_c, humidity_pct, battery_pct, is_valid)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE)
          ON CONFLICT DO NOTHING
        `, [randomUUID(), ts, sb.devId, sb.code, sb.id, wl, temp, hum, bat]);
      }
    }

    // ── Telemetry Alerts ─────────────────────────────────────────────────────
    await client.query(`
      INSERT INTO trx.telemetry_alerts
        (id, field_id, alert_type, severity, alert_message, is_acknowledged, is_resolved)
      VALUES
        ($1,$2,'sensor_offline','warning','Sensor AWD-DEMAK-001 tidak mengirimkan data 3 jam.',FALSE,FALSE),
        ($3,$4,'threshold_violation','critical','Ketinggian air Blok Barat A melewati ambang kritis (+12cm)!',FALSE,FALSE)
      ON CONFLICT DO NOTHING
    `, [randomUUID(), fieldId1, randomUUID(), fieldId2]);

    console.log('\n✅ Dev dummy data selesai!\n');
    console.log('   Credentials admin:');
    console.log(`   Email   : ${adminEmail}`);
    console.log(`   Password: ${devPassword}\n`);

  } catch (err: any) {
    console.error('\n❌ Dev seed gagal:', err.message);
    if (err.detail) console.error('   Detail:', err.detail);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seedDev();
