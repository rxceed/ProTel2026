import { eq } from 'drizzle-orm';
import { testConnection, db } from './src/db/client';
import { subBlocksService } from './src/modules/master-data/master-data.service';
import { fields, subBlocks as subBlocksTable } from './src/db/schema/mst';

async function test() {
  await testConnection();
  try {
     const f = await db.select().from(fields).limit(1);
     const fieldId = f[0].id;
     console.log('Testing Sub-blocks for field:', fieldId);
     const payload = {
        name: 'Blok Kiri',
        display_order: 0,
        polygon_geom: {
          type: 'Polygon',
          coordinates: [
            [
              [106.8100, -6.2100],
              [106.8110, -6.2100],
              [106.8110, -6.2110],
              [106.8100, -6.2110],
              [106.8100, -6.2100]
            ]
          ]
        }
    };
    const res = await subBlocksService.create(fieldId, payload as any);
    console.log('Inserted ID:', res.id);
    
    console.log('Deleting sub-block:', res.id);
    await subBlocksService.delete(res.id);
    
    const list = await subBlocksService.listByField(fieldId);
    const foundInList = list.some(sb => sb.id === res.id);
    console.log('Is still found in listByField:', foundInList);
    
    // Check direct query from DB to see if it persists
    const direct = await db.select().from(fields).limit(1); // just a placeholder
    const [dbRow] = await db.select().from(subBlocksTable).where(eq(subBlocksTable.id, res.id));
    console.log('Row in database after delete:', dbRow);
  } catch(e: any) {
     console.log('ERROR:', e);
  }
  process.exit(0);
}
test();
