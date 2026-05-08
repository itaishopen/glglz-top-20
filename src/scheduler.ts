import 'dotenv/config';
import cron from 'node-cron';
import { run } from './run';
import { log } from './logger';

const TAG = 'Scheduler';
// Every Thursday (4) at 22:00 Europe/Amsterdam
const CRON_EXPRESSION = '0 22 * * 4';
const TIMEZONE = 'Europe/Amsterdam';

log.info(TAG, `Playlist update scheduled: "${CRON_EXPRESSION}" (${TIMEZONE})`);
log.info(TAG, 'Process is running — waiting for next Thursday 22:00 Amsterdam time...');

cron.schedule(
  CRON_EXPRESSION,
  async () => {
    log.info(TAG, 'Cron triggered — starting update...');
    try {
      await run();
    } catch (err: any) {
      log.error(TAG, `Update failed: ${err.message}`);
      if (err.response) {
        log.error(TAG, `HTTP ${err.response.status}: ${JSON.stringify(err.response.data)}`);
      }
    }
  },
  { timezone: TIMEZONE },
);
