import { markStatus } from './queue.js';
import { resolveIds } from './review-cache.js';

const arg = process.argv.slice(2).join(' ').trim();
if (!arg) {
  console.error('Usage: npm run kill -- <ids|all>   (e.g. "4" or "2,5")');
  process.exit(1);
}

const pageIds = resolveIds(arg);
if (pageIds.length === 0) {
  console.log('Nothing to kill.');
  process.exit(0);
}

let ok = 0, failed = 0;
for (const pageId of pageIds) {
  try {
    await markStatus(pageId, 'skipped', { reason: 'killed via review' });
    ok++;
  } catch (err: any) {
    failed++;
    console.error(`Failed for ${pageId}: ${err?.message ?? err}`);
  }
}

console.log(`Killed ${ok}${failed ? `, failed ${failed}` : ''}.`);
