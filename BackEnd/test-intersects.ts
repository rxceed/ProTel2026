import 'dotenv/config';
import { db } from '@/db/client';
import { subBlocks as subBlocksTable, embankments as embankmentsTable } from '@/db/schema/mst';
import { eq, and, sql } from 'drizzle-orm';

async function testQuery() {
  const fieldId = '7de78d0b-a659-42af-83a1-04ed1f0006ab';
  const geomJson = JSON.stringify({
    type: 'Point',
    coordinates: [106.8456, -6.2088]
  });

  console.log('Testing ST_Intersects queries...');
  try {
    // Test Embankments
    console.log('1. Querying embankments...');
    const intersectingEmbankments = await db.select({
      id: embankmentsTable.id,
      connectedSubBlocks: embankmentsTable.connectedSubBlocks,
    })
    .from(embankmentsTable)
    .where(and(
      eq(embankmentsTable.fieldId, fieldId),
      eq(embankmentsTable.isActive, true),
      sql`ST_Intersects(ST_SetSRID(ST_GeomFromGeoJSON(${embankmentsTable.polygonGeom}), 4326), ST_SetSRID(ST_GeomFromGeoJSON(${geomJson}), 4326))`
    ));
    console.log('Embankments query succeeded! Rows:', intersectingEmbankments.length);
    
    // Test Faulty Embankments Query
    console.log('2. Querying embankments (faulty)...');
    const faultyQuery = await db.select({
      id: embankmentsTable.id,
    })
    .from(embankmentsTable)
    .where(and(
      eq(embankmentsTable.fieldId, fieldId),
      eq(embankmentsTable.isActive, true),
      sql`ST_Intersects(${embankmentsTable.polygonGeom}, ST_SetSRID(ST_GeomFromGeoJSON(${geomJson}), 4326))`
    ));
    console.log('Faulty query succeeded! Rows:', faultyQuery.length);
  } catch (err: any) {
    console.error('Query failed with error:', err.message || err);
  }
}

testQuery().catch(console.error);
