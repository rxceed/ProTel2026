import { db, testConnection } from '@/db/client';
import { 
  fields, subBlocks, devices, deviceAssignments,
  decisionJobs, irrigationRecommendations, telemetryRecords,
  subBlockCurrentStates, subBlockStates
} from '@/db/schema';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';

async function runSeeder() {
  await testConnection();
  console.log('🌱 Menjalankan Seeder Dummy Telemetry & DSS untuk Sub-blocks Anda...');

  try {
    // 1. Ambil semua sub-block aktif dari database
    const existingSubBlocks = await db
      .select()
      .from(subBlocks)
      .where(eq(subBlocks.isActive, true));

    if (existingSubBlocks.length === 0) {
      console.warn('⚠️ Tidak ditemukan petak sawah (sub-block) di database. Pastikan Anda sudah menggambar dan menyimpan kotak petak sawah di peta!');
      process.exit(0);
    }

    console.log(`📦 Ditemukan ${existingSubBlocks.length} kotak petak sawah. Mulai menyuntikkan data telemetri & DSS...`);

    // Skenario variasi data untuk tes Heatmap & DSS (Kritis Merah, Optimal Hijau, Banjir Biru, Warning Kuning)
    const skenarioList = [
      {
        wl: '-18.5',
        temp: '33.5',
        hum: '54.0',
        trend: 'falling',
        recType: 'irrigate',
        cmdText: '⚠️ BUKA PINTU AIR / NYALAKAN POMPA (Darurat Kering Kritis)',
        reason: 'Elevasi air melebihi batas kritis bawah (-15 cm). Potensi stres air pada tanaman padi.',
        score: '92.5',
        rank: 1
      },
      {
        wl: '2.5',
        temp: '28.5',
        hum: '76.0',
        trend: 'stable',
        recType: 'observe',
        cmdText: '✅ PERTAHANKAN KONDISI AIR IDEAL',
        reason: 'Tinggi air optimal dalam target AWD (-5 s.d. +5 cm). Tanaman aman, efisiensi air tercapai.',
        score: '45.0',
        rank: 3
      },
      {
        wl: '9.0',
        temp: '26.0',
        hum: '88.0',
        trend: 'rising',
        recType: 'drain',
        cmdText: 'ℹ️ TUTUP PINTU MASUK / BUANG LEBIHAN AIR (Tergenang Penuh)',
        reason: 'Elevasi air melebihi batas atas (+5 cm). Lakukan pengeringan berkala agar akar mendapat oksigen.',
        score: '60.0',
        rank: 2
      },
      {
        wl: '-11.0',
        temp: '31.0',
        hum: '62.0',
        trend: 'falling',
        recType: 'irrigate',
        cmdText: '⏳ JADWALKAN PENGAIRAN DALAM 12 JAM',
        reason: 'Elevasi air masuk zona peringatan kering (-15 s.d. -5 cm). Pantau penurunan muka air.',
        score: '75.0',
        rank: 2
      }
    ];

    // 2. Buat Decision Job untuk setiap field unik
    const uniqueFieldIds = Array.from(new Set(existingSubBlocks.map(s => s.fieldId)));
    const fieldJobMap = new Map<string, string>();

    for (const fid of uniqueFieldIds) {
      const jobId = randomUUID();
      fieldJobMap.set(fid, jobId);
      await db.insert(decisionJobs).values({
        id: jobId,
        fieldId: fid,
        status: 'completed',
        engineVersion: 'v2.0-DSS-LIVE',
        completedAt: new Date()
      }).onConflictDoNothing();
    }

    // 3. Loop untuk setiap sub-block
    for (let i = 0; i < existingSubBlocks.length; i++) {
      const sb = existingSubBlocks[i];
      const skenario = skenarioList[i % skenarioList.length];
      const devId = randomUUID();
      const now = new Date();
      const jobId = fieldJobMap.get(sb.fieldId)!;

      console.log(`\n🔹 Memproses Petak [${sb.name || sb.code}] (ID: ${sb.id})...`);
      console.log(`   -> Skenario: Water Level ${skenario.wl} cm | Suhu ${skenario.temp}°C | Kelembaban ${skenario.hum}%`);

      // 3a. Buat Dummy Device untuk petak ini
      await db.insert(devices).values({
        id: devId,
        fieldId: sb.fieldId,
        deviceCode: `SNSR-${sb.code || 'BOX'}-${Math.floor(1000 + Math.random() * 9000)}`,
        deviceType: 'awd_water_level',
        connectionType: 'lorawan',
        hardwareModel: 'PROTEL-AWD-PRO',
        firmwareVersion: '3.0.0'
      }).onConflictDoNothing();

      await db.insert(deviceAssignments).values({
        deviceId: devId,
        subBlockId: sb.id,
        fieldId: sb.fieldId
      }).onConflictDoNothing();

      // 3b. Inject ke Telemetry Records (Hypertable history)
      await db.insert(telemetryRecords).values({
        id: randomUUID(),
        eventTimestamp: now,
        deviceId: devId,
        deviceCode: `SNSR-${sb.code || 'BOX'}`,
        subBlockId: sb.id,
        waterLevelCm: skenario.wl,
        temperatureC: skenario.temp,
        humidityPct: skenario.hum,
        batteryPct: '94.5',
        signalRssi: -65,
        isValid: true
      });

      // 3c. Inject ke Sub-Block States (CQRS Table yang dibaca oleh Heatmap & Map)
      await db.insert(subBlockCurrentStates).values({
        subBlockId: sb.id,
        fieldId: sb.fieldId,
        stateTime: now,
        waterLevelCm: skenario.wl,
        waterLevelTrend: skenario.trend,
        stateSource: 'observed',
        freshnessStatus: 'fresh',
        lastObservationAt: now,
        sourceDeviceId: devId,
        interpolationConfidence: '0.99',
        updatedAt: now
      }).onConflictDoUpdate({
        target: subBlockCurrentStates.subBlockId,
        set: {
          stateTime: now,
          waterLevelCm: skenario.wl,
          waterLevelTrend: skenario.trend,
          lastObservationAt: now,
          updatedAt: now
        }
      });

      // 3d. Inject Rekomendasi DSS via Raw Query (Bypass Drizzle schema drift)
      await db.execute(`
        INSERT INTO trx.irrigation_recommendations
          (id, field_id, sub_block_id, decision_job_id, generated_at, valid_until,
           recommendation_type, priority_rank, priority_score,
           command_template_code, command_text, reason_summary,
           confidence_level, water_level_cm_at_decision, feedback_status)
        VALUES
          ('${randomUUID()}', '${sb.fieldId}', '${sb.id}', '${jobId}', now(), now() + interval '24 hours',
           '${skenario.recType}', ${skenario.rank}, '${skenario.score}',
           '${skenario.recType === 'irrigate' ? 'IRR_START' : 'OBSERVE'}',
           '${skenario.cmdText}', '${skenario.reason}',
           'high', '${skenario.wl}', 'pending')
        ON CONFLICT DO NOTHING;
      `);
    }

    console.log('\n✅ SEEDING BERHASIL! Data Dummy Telemetry Heatmap & DSS siap dipantau di UI.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Gagal menjalankan seeder:', err);
    process.exit(1);
  }
}

runSeeder();
