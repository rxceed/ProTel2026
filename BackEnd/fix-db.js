import { Client } from 'pg';
import { config } from 'dotenv';
config();

const client = new Client({
  connectionString: process.env.DATABASE_URL
});

async function main() {
  await client.connect();
  
  try {
    console.log("Fixing missing field_id column in trx.sub_block_states...");
    // Drop existing data to avoid NOT NULL constraints
    await client.query(`DELETE FROM trx.sub_block_states;`);
    
    // Add missing column
    await client.query(`
      ALTER TABLE trx.sub_block_states 
      ADD COLUMN IF NOT EXISTS field_id uuid;
    `);

    // We can't easily add NOT NULL if we don't have a default, but it's empty now so it's fine.
    // Also remove estimated_from_sub_block_ids as it's not in the Drizzle schema anymore
    await client.query(`
      ALTER TABLE trx.sub_block_states 
      DROP COLUMN IF EXISTS estimated_from_sub_block_ids;
    `);

    console.log("✅ Database fixed!");
  } catch (err) {
    console.error("Error fixing db:", err.message);
  } finally {
    await client.end();
  }
}

main();
