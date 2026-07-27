import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { STATE_DIR } from '../config.js';
import { archivePage } from '../queue.js';

const trackingPath = join(STATE_DIR, 'video-fill-ids.json');

if (!existsSync(trackingPath)) {
  console.log('No tracking file. Nothing to clean up.');
  process.exit(0);
}

const ids: string[] = JSON.parse(readFileSync(trackingPath, 'utf8'));
console.log(`Archiving ${ids.length} row(s)...`);

let cleared = 0;
for (const id of ids) {
  try { await archivePage(id); cleared++; } catch { /* already gone */ }
}

unlinkSync(trackingPath);
console.log(`Done. Archived ${cleared}/${ids.length} row(s). Tracking file removed.`);
