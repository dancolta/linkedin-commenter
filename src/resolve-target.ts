import { listPending, listApproved, QueueRow } from './queue.js';
import { readCache } from './review-cache.js';

/**
 * Turn what Dan actually types into queue rows.
 *
 * He refers to drafts by author ("the Henry one"), not by index, and the
 * review-cache index drifts the moment anything else touches the queue. So a
 * name substring is the primary key here and the cached id is only honoured
 * when it still points at something active.
 *
 * Unmatched terms are returned rather than ignored: a removal that silently
 * matches nothing is the failure mode that once published a comment Dan had
 * asked to drop, so callers must treat a non-empty `unmatched` as a hard stop.
 */
export interface Resolution {
  targets: QueueRow[];
  unmatched: string[];
  active: QueueRow[];
}

export async function resolveTargets(arg: string): Promise<Resolution> {
  const active = [...await listApproved(), ...await listPending()];
  const terms = arg.split(',').map(s => s.trim()).filter(Boolean);

  if (terms.length === 1 && terms[0].toLowerCase() === 'all') {
    return { targets: [...active], unmatched: [], active };
  }

  const byId = readCache()?.mapping ?? {};
  const activeById = new Map(active.map(r => [r.pageId, r]));
  const targets = new Map<string, QueueRow>();
  const unmatched: string[] = [];

  for (const term of terms) {
    const viaId = byId[term] ? activeById.get(byId[term]) : undefined;
    if (viaId) { targets.set(viaId.pageId, viaId); continue; }

    const needle = term.toLowerCase();
    const matches = active.filter(r => r.author.toLowerCase().includes(needle));
    if (matches.length === 0) { unmatched.push(term); continue; }
    for (const m of matches) targets.set(m.pageId, m);
  }

  return { targets: [...targets.values()], unmatched, active };
}

/** Shared failure message so kill and redraft report a miss identically. */
export function reportUnmatched(unmatched: string[], active: QueueRow[]): void {
  console.error(`No active draft matches: ${unmatched.join(', ')}`);
  console.error(`Active authors right now: ${active.map(r => r.author).join(', ')}`);
  console.error('Nothing was changed — re-run with a name from that list.');
}
