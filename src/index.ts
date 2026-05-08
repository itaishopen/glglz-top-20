import { run } from './run';

run().catch((err: Error & { response?: { status: number; data: unknown } }) => {
  console.error(`\n[FATAL] ${err.message}`);
  if (err.response) {
    console.error(`HTTP ${err.response.status}:`, JSON.stringify(err.response.data, null, 2));
  }
  process.exit(1);
});
