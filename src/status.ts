import { countByStatus } from './notion/queue.js';
import { getDailyPublished, getFirstRunAt } from './cache/sqlite.js';
import { currentPhase } from './config.js';
import { isPaused } from './linkedin/safety-check.js';
import { existsSync, readFileSync } from 'node:fs';
import { PAUSED_FLAG } from './config.js';

async function main() {
  const phase = currentPhase(getFirstRunAt());
  const today = getDailyPublished();

  console.log('=== LinkedIn Commenter status ===');
  console.log(`First run: ${getFirstRunAt().toISOString()}`);
  console.log(`Phase: cap ${phase.dailyCap}/day, gap ${phase.minGapMs/60000}-${phase.maxGapMs/60000} min, scan ${phase.maxScan}`);
  console.log(`Published today (Madrid TZ): ${today}/${phase.dailyCap}`);
  console.log(`Paused: ${isPaused() ? 'YES' : 'no'}`);
  if (existsSync(PAUSED_FLAG)) {
    console.log('Paused reason:');
    console.log(readFileSync(PAUSED_FLAG, 'utf8').trim().split('\n').map(l => `  ${l}`).join('\n'));
  }

  console.log('\nNotion queue:');
  try {
    const counts = await countByStatus();
    if (Object.keys(counts).length === 0) console.log('  (empty)');
    for (const [status, n] of Object.entries(counts).sort()) {
      console.log(`  ${status}: ${n}`);
    }
  } catch (err) {
    console.error(`  Notion error: ${(err as Error).message}`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
