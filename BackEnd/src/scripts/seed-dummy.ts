import { db, testConnection } from '@/db/client';
import { 
  users, fields, subBlocks, devices, deviceAssignments,
  decisionJobs, irrigationRecommendations, telemetryAlerts 
} from '@/db/schema';
import { randomUUID } from 'crypto';

async function seed() {
  await testConnection();
  
  try {
    console.log('Seeding Dummy Data...');

    // 1. Dapatkan user admin
    const adminUsers = await db.select().from(users).limit(1);
    if (!adminUsers.length) {
      console.log('No user found, please run seed-admin.ts first!');
      return;
    }
    const adminId = adminUsers[0].id;

    // 2. Buat Field Dummy
    const fieldId = randomUUID();
    await db.insert(fields).values({
      id: fieldId,
      name: 'Lahan Sentral Demak',
      adm4Code: '332101',
      waterSourceType: 'irrigated',
      areaHectares: '5.2',
      operatorCountDefault: 2,
    }).onConflictDoNothing();

    // 3. Buat Sub-blocks (bypass postgis dengan inject manual via mentahan JSON string)
    // Karena polygon_geom di local DB ternyata bertipe text, kita simpan string raw aja tanpa ST_GeomFromGeoJSON
    const sb1Id = randomUUID();
    const sb2Id = randomUUID();
    
    // Kita jalankan raw query untuk bypass Drizzle's custom mapper
    await db.execute(`
      INSERT INTO mst.sub_blocks (id, field_id, name, code, polygon_geom, elevation_m, soil_type, is_active)
      VALUES 
      ('${sb1Id}', '${fieldId}', 'Blok Utara 1', 'BU-1', '{"type":"Polygon","coordinates":[[[106.8,-6.2],[106.81,-6.2],[106.81,-6.21],[106.8,-6.21],[106.8,-6.2]]]}', 12.5, 'clay', true)
      ON CONFLICT DO NOTHING;
    `);

    await db.execute(`
      INSERT INTO mst.sub_blocks (id, field_id, name, code, polygon_geom, elevation_m, soil_type, is_active)
      VALUES 
      ('${sb2Id}', '${fieldId}', 'Blok Selatan 2', 'BS-2', '{"type":"Polygon","coordinates":[[[106.82,-6.22],[106.83,-6.22],[106.83,-6.23],[106.82,-6.23],[106.82,-6.22]]]}', 11.2, 'loam', true)
      ON CONFLICT DO NOTHING;
    `);

    // 4. Buat Devices
    const dev1Id = randomUUID();
    await db.insert(devices).values({
      id: dev1Id,
      fieldId: fieldId,
      deviceCode: `AWD-DEMAK-${Math.floor(Math.random()*10000)}`,
      deviceType: 'awd_water_level',
      connectionType: 'nbiot',
      hardwareModel: 'SMART-AWD-V2',
      firmwareVersion: '2.1.0'
    }).onConflictDoNothing();

    await db.insert(deviceAssignments).values({
      deviceId: dev1Id,
      subBlockId: sb1Id,
      fieldId: fieldId,
    }).onConflictDoNothing();

    // 5. Buat Decision Job (Engine Cycle)
    const jobId = randomUUID();
    await db.insert(decisionJobs).values({
      id: jobId,
      fieldId: fieldId,
      status: 'completed',
      engineVersion: 'v1.0.4',
      completedAt: new Date()
    }).onConflictDoNothing();

    // 6. Buat Active Recommendations (Pending)
    const rec1Id = randomUUID();
    await db.insert(irrigationRecommendations).values({
      id: rec1Id,
      fieldId: fieldId,
      subBlockId: sb1Id,
      decisionJobId: jobId,
      generatedAt: new Date(),
      validUntil: new Date(Date.now() + 24 * 3600 * 1000), // besok
      recommendationType: 'irrigate',
      priorityRank: 1,
      priorityScore: '85.5',
      commandTemplateCode: 'IRR_START',
      commandText: 'Nyalakan Pompa Air selama 3 jam',
      reasonSummary: 'Elevasi air telah mencapai batas bawah -15cm, fase vegetatif memerlukan genangan 2cm.',
      confidenceLevel: 'high',
      waterLevelCmAtDecision: '-15.2',
      feedbackStatus: 'pending'
    }).onConflictDoNothing();

    const rec2Id = randomUUID();
    await db.insert(irrigationRecommendations).values({
      id: rec2Id,
      fieldId: fieldId,
      subBlockId: sb2Id,
      decisionJobId: jobId,
      generatedAt: new Date(),
      validUntil: new Date(Date.now() + 24 * 3600 * 1000),
      recommendationType: 'observe',
      priorityRank: 2,
      priorityScore: '40.0',
      commandTemplateCode: 'MAINTAIN',
      commandText: 'Pertahankan Kondisi Saat Ini (Tunggu Kering)',
      reasonSummary: 'Tingkat air saat ini (5cm) ideal untuk menghambat gulma tanpa pemborosan air.',
      confidenceLevel: 'medium',
      waterLevelCmAtDecision: '5.0',
      feedbackStatus: 'pending'
    }).onConflictDoNothing();

    // 7. Buat Historical Recommendations (Executed/Skipped)
    await db.insert(irrigationRecommendations).values([
      {
        id: randomUUID(),
        fieldId: fieldId,
        subBlockId: sb1Id,
        decisionJobId: jobId,
        generatedAt: new Date(Date.now() - 3 * 24 * 3600 * 1000), // 3 hari lalu
        validUntil: new Date(Date.now() - 2 * 24 * 3600 * 1000),
        recommendationType: 'drain',
        priorityRank: 1,
        priorityScore: '90.0',
        commandTemplateCode: 'DRAIN_START',
        commandText: 'Keringkan lahan persiapan pemupukan',
        reasonSummary: 'Sesuai jadwal pemupukan NPK besok',
        confidenceLevel: 'high',
        waterLevelCmAtDecision: '8.0',
        feedbackStatus: 'executed',
        feedbackBy: adminId,
        feedbackAt: new Date(Date.now() - 2.9 * 24 * 3600 * 1000)
      },
      {
        id: randomUUID(),
        fieldId: fieldId,
        subBlockId: sb2Id,
        decisionJobId: jobId,
        generatedAt: new Date(Date.now() - 5 * 24 * 3600 * 1000), 
        validUntil: new Date(Date.now() - 4 * 24 * 3600 * 1000),
        recommendationType: 'irrigate',
        priorityRank: 1,
        priorityScore: '75.0',
        commandTemplateCode: 'IRR_START',
        commandText: 'Nyalakan Pompa Air 1 jam',
        reasonSummary: 'Level air kritis -10cm',
        confidenceLevel: 'low',
        waterLevelCmAtDecision: '-10.5',
        feedbackStatus: 'skipped',
        feedbackBy: adminId,
        feedbackAt: new Date(Date.now() - 4.8 * 24 * 3600 * 1000)
      }
    ]).onConflictDoNothing();

    // 8. Buat Telemetry Alerts
    await db.insert(telemetryAlerts).values([
      {
        id: randomUUID(),
        fieldId: fieldId,
        alertType: 'sensor_offline',
        severity: 'warning',
        alertMessage: 'Sensor AWD-DEMAK-01 tidak mengirimkan data selama 3 jam terakhir.',
        triggeredAt: new Date(Date.now() - 3 * 3600 * 1000),
        isAcknowledged: false,
        isResolved: false
      },
      {
        id: randomUUID(),
        fieldId: fieldId,
        alertType: 'battery_low',
        severity: 'info',
        alertMessage: 'Baterai Weather Station (WS-02) tersisa 15%, mohon persiapkan penggantian.',
        triggeredAt: new Date(Date.now() - 12 * 3600 * 1000),
        isAcknowledged: true,
        isResolved: false,
        acknowledgedBy: adminId,
        acknowledgedAt: new Date(Date.now() - 11 * 3600 * 1000)
      }
    ]).onConflictDoNothing();

    console.log('Dummy Data Seeded Successfully!');
  } catch (err) {
    console.error('Failed to seed DB:', err);
  }
  process.exit(0);
}

seed();
