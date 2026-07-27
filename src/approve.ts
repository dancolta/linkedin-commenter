import { markStatus, listPending } from './queue.js';
import { resolveIds } from './review-cache.js';

const arg = process.argv.slice(2).join(' ').trim();
if (!arg) {
  console.error('Usage: npm run approve -- <ids|all>   (e.g. "1,3,5" or "all")');
  process.exit(1);
}

// "all" resolves against the live 'pending' set in the queue, not the on-disk
// review-cache mapping — that cache is a point-in-time snapshot from the last
// `review` run and never drops IDs that were killed/skipped afterward, so
// trusting it here would silently re-approve drafts the user already killed.
const pageIds = arg.trim().toLowerCase() === 'all'
  ? (await listPending()).map(r => r.pageId)
  : resolveIds(arg);
if (pageIds.length === 0) {
  console.log('Nothing to approve.');
  process.exit(0);
}

let ok = 0, failed = 0;
for (const pageId of pageIds) {
  try {
    await markStatus(pageId, 'approved');
    ok++;
  } catch (err: any) {
    failed++;
    console.error(`Failed for ${pageId}: ${err?.message ?? err}`);
  }
}

console.log(`Approved ${ok}${failed ? `, failed ${failed}` : ''}.`);
