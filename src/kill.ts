// Explicit removal. When Dan says "drop the Henry one", it has to be gone —
// out of the queue, out of the vault, and impossible to resurrect on a later sync.
//
//   npm run kill -- all              every active draft
//   npm run kill -- henry, "james s" author substrings (preferred)
//   npm run kill -- 2,5              review-cache IDs, if they're still valid
//
// A term that matches nothing is a hard error that removes nothing, because a
// silent no-op here reads as "removed" right before a publish.

import { markStatus, archivePage } from './queue.js';
import { resolveTargets, reportUnmatched } from './resolve-target.js';
import { removePublishedNote, syncVault } from './vault/sync.js';

const arg = process.argv.slice(2).join(' ').trim();
if (!arg) {
  console.error('Usage: npm run kill -- <names|ids|all>   (e.g. "henry", "2,5", "all")');
  process.exit(1);
}

const { targets, unmatched, active } = await resolveTargets(arg);

if (active.length === 0) {
  console.log('Queue is empty — nothing to remove.');
  process.exit(0);
}
if (unmatched.length) {
  reportUnmatched(unmatched, active);
  process.exit(1);
}

let ok = 0;
const failures: string[] = [];

for (const row of targets) {
  try {
    // skipped drops it from every active view; archived puts it beyond the reach
    // of listApproved/listPending entirely, so no later sync can revive it.
    await markStatus(row.pageId, 'skipped', { reason: 'explicitly removed by Dan' });
    await archivePage(row.pageId);
    removePublishedNote({ pageId: row.pageId, postUrl: row.postUrl });
    console.log(`  ✗ Removed: ${row.author} — "${row.draft.slice(0, 55)}..."`);
    ok++;
  } catch (err: any) {
    failures.push(`${row.author}: ${err?.message ?? err}`);
  }
}

// Rebuild the folder from the surviving queue so the vault matches reality.
try {
  await syncVault();
} catch (err) {
  console.log(`Vault resync skipped: ${(err as Error).message}`);
}

console.log(`Removed ${ok} draft${ok === 1 ? '' : 's'}. ${active.length - ok} still queued.`);
if (failures.length) {
  console.error(`Failed to remove ${failures.length}:`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
