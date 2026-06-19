import { testConnection } from './src/db/client';
import { dashboardService } from './src/modules/dashboard/dashboard.service';

async function test() {
  console.log('Testing connection...');
  await testConnection();
  try {
     console.log('Fetching summary...');
     const sum = await dashboardService.getSummary('random-uuid', true);
     console.log('Success:', sum);
  } catch(e: any) {
     console.log('ERROR IS:', e);
  }
  process.exit();
}
test();
