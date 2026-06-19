/**
 * db:seed — Seed data referensi wajib untuk sistem berjalan
 *
 * Includes:
 *   - rice_duration_buckets (4 bucket HST)
 *   - growth_phases (8 fase)
 *   - irrigation_rule_profiles (16 profil default)
 *   - sys.engine_configs
 *   - sys.integration_configs
 *
 * Idempotent: aman dijalankan berkali-kali (ON CONFLICT DO NOTHING)
 * Usage: npm run db:seed
 */
import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function seed() {
  const client = await pool.connect();
  console.log('\n🌱 Smart AWD — Database Seeding\n');

  try {
    // ── 1. Rice Duration Buckets ─────────────────────────────────────────────
    console.log('  → rice_duration_buckets...');
    await client.query(`
      INSERT INTO mst.rice_duration_buckets (bucket_code, label, hst_min, hst_max, sort_order) VALUES
        ('early',        'Early (70–80 HST)',         70,  80,  1),
        ('medium_early', 'Medium Early (90–100 HST)', 90,  100, 2),
        ('medium',       'Medium (110–120 HST)',       110, 120, 3),
        ('late',         'Late (120–140 HST)',          120, 140, 4)
      ON CONFLICT DO NOTHING;
    `);

    // ── 2. Growth Phases ─────────────────────────────────────────────────────
    console.log('  → growth_phases...');
    await client.query(`
      INSERT INTO mst.growth_phases (phase_code, label, phase_order, description, is_dss_active) VALUES
        ('land_prep',        'Persiapan Lahan', 1, 'Pengolahan tanah sebelum tanam.',              FALSE),
        ('nursery',          'Persemaian',       2, 'Fase pembibitan/persemaian.',                   FALSE),
        ('transplanting',    'Tanam / Tandur',   3, 'Transplanting bibit ke sawah.',                 FALSE),
        ('vegetative_early', 'Vegetatif Awal',   4, 'Fase awal pertumbuhan vegetatif. AWD aktif.',  TRUE),
        ('vegetative_late',  'Vegetatif Lanjut', 5, 'Fase lanjut pertumbuhan vegetatif.',           TRUE),
        ('reproductive',     'Reproduktif',      6, 'Fase pembungaan/primordia.',                   TRUE),
        ('ripening',         'Pemasakan',        7, 'Fase pengisian dan pematangan gabah.',         TRUE),
        ('harvested',        'Panen / Selesai',  8, 'Siklus tanam selesai. DSS tidak aktif.',      FALSE)
      ON CONFLICT DO NOTHING;
    `);

    // ── 3. Irrigation Rule Profiles ──────────────────────────────────────────
    console.log('  → irrigation_rule_profiles...');
    await client.query(`
      INSERT INTO mst.irrigation_rule_profiles
        (name, bucket_code, phase_code, awd_lower_threshold_cm, awd_upper_target_cm,
         min_saturation_days, drought_alert_cm, priority_weight, rain_delay_mm, target_confidence, is_default)
      VALUES
        ('Early - Vegetatif Awal',          'early','vegetative_early', -15.0,  5.0, 2, -25.0, 1.00, 10.0, 'high',   TRUE),
        ('Early - Vegetatif Lanjut',        'early','vegetative_late',  -15.0,  5.0, 2, -25.0, 1.00, 10.0, 'high',   TRUE),
        ('Early - Reproduktif',             'early','reproductive',      -5.0, 10.0, 3, -12.0, 1.20,  5.0, 'high',   TRUE),
        ('Early - Pemasakan',               'early','ripening',          -5.0,  5.0, 1, -10.0, 0.80, 15.0, 'medium', TRUE),
        ('Medium Early - Vegetatif Awal',   'medium_early','vegetative_early', -18.0,  5.0, 2, -28.0, 1.00, 10.0, 'high',   TRUE),
        ('Medium Early - Vegetatif Lanjut', 'medium_early','vegetative_late',  -18.0,  5.0, 2, -28.0, 1.00, 10.0, 'high',   TRUE),
        ('Medium Early - Reproduktif',      'medium_early','reproductive',      -5.0, 10.0, 3, -13.0, 1.20,  5.0, 'high',   TRUE),
        ('Medium Early - Pemasakan',        'medium_early','ripening',          -5.0,  5.0, 1, -12.0, 0.80, 15.0, 'medium', TRUE),
        ('Medium - Vegetatif Awal',         'medium','vegetative_early', -20.0,  5.0, 2, -30.0, 1.00, 10.0, 'high',   TRUE),
        ('Medium - Vegetatif Lanjut',       'medium','vegetative_late',  -20.0,  5.0, 2, -30.0, 1.00, 10.0, 'high',   TRUE),
        ('Medium - Reproduktif',            'medium','reproductive',      -5.0, 10.0, 3, -15.0, 1.20,  5.0, 'high',   TRUE),
        ('Medium - Pemasakan',              'medium','ripening',          -5.0,  5.0, 1, -12.0, 0.80, 15.0, 'medium', TRUE),
        ('Late - Vegetatif Awal',           'late','vegetative_early', -20.0,  5.0, 3, -35.0, 1.00, 10.0, 'high',   TRUE),
        ('Late - Vegetatif Lanjut',         'late','vegetative_late',  -20.0,  5.0, 3, -35.0, 1.00, 10.0, 'high',   TRUE),
        ('Late - Reproduktif',              'late','reproductive',      -5.0, 10.0, 3, -15.0, 1.20,  5.0, 'high',   TRUE),
        ('Late - Pemasakan',                'late','ripening',          -5.0,  5.0, 1, -12.0, 0.80, 15.0, 'medium', TRUE)
      ON CONFLICT DO NOTHING;
    `);

    // ── 4. Engine Configs ────────────────────────────────────────────────────
    console.log('  → engine_configs...');
    await client.query(`
      INSERT INTO sys.engine_configs (config_key, config_value, description) VALUES
        ('decision_cycle_normal_minutes',   '60',       'Interval decision cycle mode normal (menit)'),
        ('decision_cycle_siaga_minutes',    '30',       'Interval decision cycle mode siaga (menit)'),
        ('telemetry_stale_threshold_hours', '2',        'Telemetry lebih dari N jam dianggap stale'),
        ('bmkg_forecast_stale_hours',       '6',        'Data prakiraan BMKG lebih dari N jam dianggap stale'),
        ('recommendation_valid_hours',      '2',        'Masa berlaku rekomendasi DSS (jam)'),
        ('max_estimation_hops',             '1',        'Maksimal hop estimasi state dari tetangga'),
        ('min_confidence_for_irrigate',     '"medium"', 'Minimum confidence untuk command irrigate'),
        ('alert_battery_low_pct',           '20',       'Threshold baterai device dianggap low (%)'),
        ('alert_device_offline_hours',      '2',        'Device dianggap offline jika tidak ada data N jam')
      ON CONFLICT DO NOTHING;
    `);

    // ── 5. Integration Configs ───────────────────────────────────────────────
    console.log('  → integration_configs...');
    await client.query(`
      INSERT INTO sys.integration_configs (integration_name, is_enabled, base_url, sync_interval_minutes, config_json) VALUES
        ('bmkg',            TRUE, 'https://api.bmkg.go.id/publik', 180,  '{"rate_limit_per_minute":60,"forecast_days":3}'),
        ('cloudflare_r2',   TRUE, NULL,                             NULL, '{"max_upload_size_mb":400}'),
        ('decision_engine', TRUE, 'http://localhost:8000',          NULL, '{"timeout_seconds":30,"max_retries":2}')
      ON CONFLICT DO NOTHING;
    `);

    console.log('\n✅ Seeding selesai!\n');
    console.log('   Langkah selanjutnya:');
    console.log('   ADMIN_PASSWORD=RahasiaKuat123! npm run seed:admin\n');

  } catch (err: any) {
    console.error('\n❌ Seeding gagal:', err.message);
    if (err.detail) console.error('   Detail:', err.detail);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
