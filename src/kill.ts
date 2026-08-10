// Explicit removal. When Dan says "drop the Henry one", it has to be gone —
// out of the queue, out of the vault, and impossible to resurrect on a later sync.
//
// Accepts, in order of preference:
//   npm run kill -- all              every active draft
//   npm run kill -- 2,5              review-cache IDs (from `npm run review`)
//   npm run kill -- henry, "james s" author substrings, matched case-insensitively
//
// Author matching exists because the review-cache mapping is a point-in-time
// snapshot and drifts the moment anything else touches the queue; a name is
// what Dan actually has in front of him. Anything that matches nothing is a hard
// error — a silent no-op here would read as "removed" when nothing was.

import { listPending, listApproved, markStatus, archivePage, QueueRow } from './queue.js';
import { readCache } from './review-cache.js';
import { removePublishedNote, syncVault } from './vault/sync.js';

const arg = process.argv.slice(2).join(' ').trim();
if (!arg) {
  console.error('Usage: npm run kill -- <ids|authors|all>   (e.g. "4", "2,5", "henry", "all")');
  process.exit(1);
}

const active: QueueRow[] = [...await listApproved(), ...await listPending()];
if (active.length === 0) {
  console.log('Queue is empty — nothing to remove.');
  process.exit(0);
}

const terms = arg.split(',').map(s => s.trim()).filter(Boolean);
const wantsAll = terms.length === 1 && terms[0].toLowerCase() === 'all';

const targets = new Map<string, QueueRow>();
const unmatched: string[] = [];

if (wantsAll) {
  for (const row of active) targets.set(row.pageId, row);
} else {
  const cache = readCache();
  const byId = cache?.mapping ?? {};
  const activeById = new Map(active.map(r => [r.pageId, r]));

  for (const term of terms) {
    // A review-cache ID only counts if it still points at something active.
    const viaId = byId[term] ? activeById.get(byId[term]) : undefined;
    if (viaId) { targets.set(viaId.pageId, viaId); continue; }

    const needle = term.toLowerCase();
    const matches = active.filter(r => r.author.toLowerCase().includes(needle));
    if (matches.length === 0) { unmatched.push(term); continue; }
    for (const m of matches) targets.set(m.pageId, m);
  }
}

if (unmatched.length) {
  console.error(`No active draft matches: ${unmatched.join(', ')}`);
  console.error(`Active authors right now: ${active.map(r => r.author).join(', ')}`);
  console.error('Nothing was removed — re-run with a name from that list.');
  process.exit(1);
}

let ok = 0;
const failures: string[] = [];

for (const row of targets.values()) {
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

console.log(`Removed ${ok} draft${ok === 1 ? '' : 's'}.`);
if (failures.length) {
  console.error(`Failed to remove ${failures.length}:`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
