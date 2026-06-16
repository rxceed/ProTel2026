import { Client } from 'pg';
import { config } from 'dotenv';
config();

const client = new Client({ connectionString: process.env.DATABASE_URL });

async function main() {
  await client.connect();

  const tables = ['sub_block_states', 'sub_block_current_states'];
  for (const t of tables) {
    console.log(`\n--- trx.${t} ---`);
    const res = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'trx' AND table_name = $1
      ORDER BY ordinal_position;
    `, [t]);
    res.rows.forEach(r => console.log(`  ${r.column_name} [${r.data_type}] ${r.is_nullable === 'YES' ? 'nullable' : 'NOT NULL'}`));
  }

  console.log('\n--- Triggers on sub_block_states ---');
  const tr = await client.query(`
    SELECT trigger_name, event_manipulation, action_timing
    FROM information_schema.triggers
    WHERE event_object_schema = 'trx' AND event_object_table = 'sub_block_states';
  `);
  tr.rows.forEach(r => console.log(`  ${r.trigger_name}`));

  await client.end();
}

main().catch(console.error);
